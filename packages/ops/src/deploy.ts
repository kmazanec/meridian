/**
 * Deploy the compiled program to whatever cluster `RPC_URL` points at.
 *
 * Uses the Solana CLI's `program deploy` with the **canonical program keypair**
 * (`target/deploy/meridian-keypair.json`) so the program id is reproducible across clones
 * and clusters, and deploys **upgradeably** with the ops deployer as the upgrade authority —
 * `initialize_config` requires a ProgramData account whose upgrade authority is the admin.
 * This is the same invocation the F-09 e2e harness uses (`localValidator.ts`), generalized
 * to an arbitrary `RPC_URL` and an explicit deployer keypair file.
 *
 * Idempotent by construction: `solana program deploy --program-id <kp>` *upgrades* an
 * already-deployed program when the signer is its upgrade authority, and deploys it fresh
 * otherwise. Re-running is therefore safe (it re-uploads the current `.so`).
 *
 * The `.so` path honors `MERIDIAN_SO` / `MERIDIAN_PROGRAM_KEYPAIR` (set by the e2e harness),
 * which is essential in a git worktree whose `target/` is empty: point at a `.so` built in
 * the main checkout for the same program source.
 */

import { execFileSync, execFile } from "node:child_process";
import { existsSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { programSoPath, programKeypairPath } from "@meridian/e2e";
import type { ConsoleLog } from "./log";

const execFileAsync = promisify(execFile);

/** The on-chain upgradeable BPF loader; ProgramData is a PDA of [programId] under it. */
export const BPF_LOADER_UPGRADEABLE = new PublicKey(
  "BPFLoaderUpgradeab1e11111111111111111111111"
);

/** Resolve the `solana` binary (env override for non-standard installs). */
export function solanaBin(): string {
  return process.env.SOLANA_BIN ?? "solana";
}

/** Derive the ProgramData PDA for a program id under the upgradeable loader. */
export function programDataAddress(programId: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [programId.toBuffer()],
    BPF_LOADER_UPGRADEABLE
  )[0];
}

/** Read a Solana CLI keypair file (JSON byte array) and return its public key. */
export function programIdFromKeypairFile(path: string): PublicKey {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { readFileSync } = require("node:fs");
  const bytes = JSON.parse(readFileSync(path, "utf8")) as number[];
  return Keypair.fromSecretKey(Uint8Array.from(bytes)).publicKey;
}

/**
 * Build the `solana program deploy` argv (excluding the binary name). Pure so the exact
 * invocation can be asserted in a contract test without spawning the CLI. `--keypair` /
 * `--url` are GLOBAL flags (before the subcommand) and set the default signer; the deployer
 * is *also* passed explicitly as the fee payer and upgrade authority — the latter is what
 * `initialize_config` checks against.
 */
export function deployArgv(opts: {
  rpcUrl: string;
  deployerPath: string;
  soPath: string;
  programKeypairPath: string;
}): string[] {
  return [
    "--keypair",
    opts.deployerPath,
    "--url",
    opts.rpcUrl,
    "program",
    "deploy",
    opts.soPath,
    "--program-id",
    opts.programKeypairPath,
    "--fee-payer",
    opts.deployerPath,
    "--upgrade-authority",
    opts.deployerPath,
  ];
}

export interface DeployResult {
  programId: PublicKey;
  programData: PublicKey;
  /** True if the program account already existed before this deploy (an upgrade). */
  wasAlreadyDeployed: boolean;
}

export interface DeployOptions {
  rpcUrl: string;
  deployer: Keypair;
  log?: ConsoleLog;
  /** Override the `.so` path (defaults to `programSoPath()` / `MERIDIAN_SO`). */
  soPath?: string;
  /** Override the program keypair path (defaults to `programKeypairPath()`). */
  keypairPath?: string;
}

/**
 * Deploy (or upgrade) the program to `rpcUrl`, signed by `deployer`. Writes the deployer's
 * secret to a short-lived temp file (the CLI reads a keypair *file*), removed in a `finally`.
 * Returns the program id + ProgramData PDA.
 */
export async function deployProgram(
  opts: DeployOptions
): Promise<DeployResult> {
  const soPath = opts.soPath ?? programSoPath();
  const keypairPath = opts.keypairPath ?? programKeypairPath();

  if (!existsSync(soPath)) {
    throw new Error(
      `Program binary missing at ${soPath}. Run \`anchor build\` from the repo root, ` +
        `or set MERIDIAN_SO to a .so built for the same program source.`
    );
  }
  if (!existsSync(keypairPath)) {
    throw new Error(
      `Program keypair missing at ${keypairPath}. Set MERIDIAN_PROGRAM_KEYPAIR if your ` +
        `target/ is not populated (e.g. in a worktree).`
    );
  }

  const programId = programIdFromKeypairFile(keypairPath);
  const programData = programDataAddress(programId);
  const connection = new Connection(opts.rpcUrl, "confirmed");

  // Idempotency signal (also drives the log message): was the program already on-chain?
  const wasAlreadyDeployed =
    (await connection.getAccountInfo(programId)) !== null;

  const work = mkdtempSync(resolve(tmpdir(), "meridian-ops-deploy-"));
  const deployerPath = resolve(work, "deployer.json");
  writeFileSync(
    deployerPath,
    JSON.stringify(Array.from(opts.deployer.secretKey))
  );
  try {
    opts.log?.step(
      wasAlreadyDeployed
        ? `Upgrading program ${programId.toBase58()} on ${opts.rpcUrl}`
        : `Deploying program ${programId.toBase58()} to ${opts.rpcUrl}`
    );
    await execFileAsync(
      solanaBin(),
      deployArgv({
        rpcUrl: opts.rpcUrl,
        deployerPath,
        soPath,
        programKeypairPath: keypairPath,
      }),
      { maxBuffer: 16 * 1024 * 1024 }
    );
    opts.log?.ok(wasAlreadyDeployed ? "Program upgraded" : "Program deployed");
    return { programId, programData, wasAlreadyDeployed };
  } finally {
    try {
      rmSync(work, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  }
}

/** Whether the `solana` CLI is callable (used to fail-fast with a clear message). */
export function solanaCliAvailable(): boolean {
  try {
    execFileSync(solanaBin(), ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}
