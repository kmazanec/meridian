#!/usr/bin/env node
/**
 * CLI: bring up the full local dev stack against an **already-running** local validator
 * (the Makefile starts the validator and funds the deployer first). Runs deploy → bootstrap
 * → create-markets → seed demo wallet, then writes `packages/web/.env.local` so the frontend
 * talks to the local stack. Local-only (it airdrops + mints mock USDC); refuses a non-local
 * RPC to avoid accidentally seeding devnet/mainnet.
 *
 * Idempotent where the underlying steps are (deploy upgrades, bootstrap no-ops if Config
 * exists); the demo seeding always creates fresh demo markets/wallet for a clean session.
 */

import { configPda } from "@meridian/sdk";
import { loadOpsEnv } from "../env";
import { createConsoleLog } from "../log";
import { deployProgram, solanaCliAvailable } from "../deploy";
import { bootstrap } from "../bootstrap";
import { createMarkets } from "../createMarkets";
import { seedDevStack } from "../devStack";
import { writeManifest } from "../manifest";

async function main(): Promise<void> {
  const env = loadOpsEnv();
  const log = createConsoleLog();
  log.section("Dev stack up (localnet)");

  if (env.cluster !== "localnet") {
    throw new Error(
      `dev-up is local-only (it airdrops + mints mock USDC). RPC_URL "${env.rpcUrl}" ` +
        `resolves to cluster "${env.cluster}". For devnet use the deploy/bootstrap/` +
        `create-markets/lifecycle steps directly (see docs/devnet-deployment.md).`
    );
  }
  if (!solanaCliAvailable()) {
    throw new Error(
      "The `solana` CLI is not callable (install it or set SOLANA_BIN)."
    );
  }

  // 1) deploy + bootstrap
  const { programId, programData } = await deployProgram({
    rpcUrl: env.rpcUrl,
    deployer: env.deployer,
    log,
  });
  const { usdcMint } = await bootstrap({
    rpcUrl: env.rpcUrl,
    deployer: env.deployer,
    programId,
    usdcMint: env.usdcMint,
    feedIdsHex: env.feedIdsHex,
    log,
  });
  writeManifest({
    cluster: env.cluster,
    rpcUrl: env.rpcUrl,
    programId: programId.toBase58(),
    programData: programData.toBase58(),
    usdcMint: usdcMint.toBase58(),
    config: configPda().toBase58(),
    admin: env.deployer.publicKey.toBase58(),
  });

  // 2) the day's markets (from MOCK_CLOSE_<SYMBOL>; defaults provided by the Makefile)
  await createMarkets({
    rpcUrl: env.rpcUrl,
    deployer: env.deployer,
    usdcMint,
    tickers: env.tickers,
    mockCloses: env.mockCloses,
    includeClose: env.includeClose,
    tradingDay: Math.floor(Date.now() / 1000) + 2 * 3600,
    log,
  });

  // 3) seed a browser demo wallet + write the web env
  const info = await seedDevStack({
    rpcUrl: env.rpcUrl,
    deployer: env.deployer,
    usdcMint,
    programId,
    log,
  });

  log.section("Dev stack ready");
  log.detail("RPC", info.rpcUrl);
  log.detail("program", info.programId);
  log.detail("USDC mint", info.usdcMint);
  log.detail("demo wallet", info.walletPubkey);
  for (const m of info.markets) {
    log.detail(`market ${m.symbol}`, `${m.address} (${m.state})`);
  }
  log.ok(
    "Local stack is up. Start the frontend with: yarn workspace @meridian/web dev"
  );
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(`dev-up failed: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
});
