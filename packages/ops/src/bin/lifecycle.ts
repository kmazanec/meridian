#!/usr/bin/env node
/**
 * CLI: run the end-to-end demo lifecycle (create → mint → trade → settle → redeem) against
 * the deployed + bootstrapped program, asserting the on-chain invariants at each phase and
 * printing a transcript. Reads the program + USDC mint from the deploy manifest. Creates its
 * own past-dated market so `admin_settle` is callable immediately — independent of any
 * markets created for trading by `create-markets`.
 *
 * Exits non-zero if any phase or invariant assertion fails (a green run is the reproducibility
 * proof). Safe to re-run: each invocation creates a fresh demo market.
 */

import { PublicKey } from "@solana/web3.js";
import { loadOpsEnv } from "../env";
import { createConsoleLog } from "../log";
import { runLifecycle } from "../lifecycle";
import { requireManifest } from "../manifest";

async function main(): Promise<void> {
  const env = loadOpsEnv();
  const log = createConsoleLog();
  log.section(`Lifecycle demo (${env.cluster})`);

  const manifest = requireManifest();
  if (!manifest.usdcMint) {
    throw new Error(
      "Deploy manifest has no USDC mint — run the bootstrap step first."
    );
  }

  await runLifecycle({
    rpcUrl: env.rpcUrl,
    deployer: env.deployer,
    usdcMint: new PublicKey(manifest.usdcMint),
    log,
  });
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(
    `lifecycle failed: ${err instanceof Error ? err.message : err}`
  );
  process.exit(1);
});
