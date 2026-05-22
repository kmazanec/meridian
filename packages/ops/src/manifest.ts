/**
 * The deploy manifest: a small JSON record of what the deploy + bootstrap produced, so the
 * later steps (create-markets, lifecycle) and the operator can read the program id, USDC
 * mint, Config PDA, RPC, and cluster without re-deriving or guessing. Written next to the
 * repo root by default (`deploy-manifest.json`, gitignored), overridable via `OPS_MANIFEST`.
 *
 * It contains **no secrets** — only public addresses and the (public) RPC endpoint — so it
 * is safe to write to disk and inspect. Keypairs are never recorded here.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

export interface DeployManifest {
  /** Cluster label (localnet/devnet/...). */
  cluster: string;
  /** RPC endpoint the deploy targeted. */
  rpcUrl: string;
  /** The deployed program id (base58). */
  programId: string;
  /** The program's ProgramData PDA (base58). */
  programData: string;
  /** The collateral USDC mint (base58). */
  usdcMint: string;
  /** The singleton Config PDA (base58). */
  config: string;
  /** The admin / deployer public key (base58) — public, not a secret. */
  admin: string;
  /** ISO timestamp of the write. */
  writtenAt: string;
}

/** Default manifest path: `<repoRoot>/deploy-manifest.json`, overridable via `OPS_MANIFEST`. */
export function manifestPath(): string {
  if (process.env.OPS_MANIFEST) return resolve(process.env.OPS_MANIFEST);
  // packages/ops/src -> packages/ops -> packages -> repo root
  return resolve(__dirname, "..", "..", "..", "deploy-manifest.json");
}

/** Write the manifest (pretty JSON). Returns the path written. */
export function writeManifest(
  m: Omit<DeployManifest, "writtenAt">,
  path = manifestPath()
): string {
  const full: DeployManifest = { ...m, writtenAt: new Date().toISOString() };
  writeFileSync(path, JSON.stringify(full, null, 2) + "\n");
  return path;
}

/** Read the manifest, or null if absent. */
export function readManifest(path = manifestPath()): DeployManifest | null {
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8")) as DeployManifest;
}

/** Read the manifest or throw a clear, actionable error if it's missing. */
export function requireManifest(path = manifestPath()): DeployManifest {
  const m = readManifest(path);
  if (!m) {
    throw new Error(
      `No deploy manifest at ${path}. Run the deploy + bootstrap steps first ` +
        `(e.g. \`make deploy bootstrap\` or the meridian-deploy / meridian-bootstrap bins).`
    );
  }
  return m;
}
