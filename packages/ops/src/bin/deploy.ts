#!/usr/bin/env node
/**
 * CLI: deploy (or upgrade) the program to `RPC_URL`, then write/refresh the deploy manifest
 * with the program id + ProgramData (USDC/Config are filled in by `bootstrap`). Reads all
 * inputs from the environment (see `env.ts`). Exits non-zero on any failure so a scheduler
 * or `make` target detects it.
 */

import { loadOpsEnv } from "../env";
import { createConsoleLog } from "../log";
import { deployProgram, solanaCliAvailable } from "../deploy";
import { configPda } from "@meridian/sdk";
import { readManifest, writeManifest } from "../manifest";

async function main(): Promise<void> {
  const env = loadOpsEnv();
  const log = createConsoleLog();
  log.section(`Deploy (${env.cluster})`);

  if (!solanaCliAvailable()) {
    throw new Error(
      "The `solana` CLI is not callable. Install the Solana tool suite (or set SOLANA_BIN)."
    );
  }

  const { programId, programData } = await deployProgram({
    rpcUrl: env.rpcUrl,
    deployer: env.deployer,
    log,
  });

  // Carry forward any USDC/Config already in the manifest (a re-deploy shouldn't drop them);
  // bootstrap will set/refresh them.
  const prev = readManifest();
  const path = writeManifest({
    cluster: env.cluster,
    rpcUrl: env.rpcUrl,
    programId: programId.toBase58(),
    programData: programData.toBase58(),
    usdcMint: prev?.usdcMint ?? "",
    config: prev?.config ?? configPda().toBase58(),
    admin: env.deployer.publicKey.toBase58(),
  });
  log.detail("manifest", path);
  log.ok("Deploy complete");
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(`deploy failed: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
});
