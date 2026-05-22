#!/usr/bin/env node
/**
 * CLI: ensure a USDC mint + initialized Config exist on the deployed program, then refresh
 * the deploy manifest with the USDC mint + Config PDA. Reads the program id from the manifest
 * (written by `deploy`); if no manifest exists it falls back to the canonical program id so
 * `bootstrap` can run standalone against an already-deployed program. Idempotent.
 */

import { PublicKey } from "@solana/web3.js";
import { configPda, PROGRAM_ID } from "@meridian/sdk";
import { loadOpsEnv } from "../env";
import { createConsoleLog } from "../log";
import { bootstrap } from "../bootstrap";
import { readManifest, writeManifest } from "../manifest";

async function main(): Promise<void> {
  const env = loadOpsEnv();
  const log = createConsoleLog();
  log.section(`Bootstrap (${env.cluster})`);

  const prev = readManifest();
  const programId =
    prev && prev.programId ? new PublicKey(prev.programId) : PROGRAM_ID;

  const { usdcMint, programData, configAlreadyExisted } = await bootstrap({
    rpcUrl: env.rpcUrl,
    deployer: env.deployer,
    programId,
    usdcMint: env.usdcMint,
    feedIdsHex: env.feedIdsHex,
    log,
  });

  const path = writeManifest({
    cluster: env.cluster,
    rpcUrl: env.rpcUrl,
    programId: programId.toBase58(),
    programData: programData.toBase58(),
    usdcMint: usdcMint.toBase58(),
    config: configPda().toBase58(),
    admin: env.deployer.publicKey.toBase58(),
  });
  log.detail("manifest", path);
  log.detail("usdcMint", usdcMint.toBase58());
  log.ok(
    configAlreadyExisted
      ? "Bootstrap complete (config already existed)"
      : "Bootstrap complete"
  );
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(
    `bootstrap failed: ${err instanceof Error ? err.message : err}`
  );
  process.exit(1);
});
