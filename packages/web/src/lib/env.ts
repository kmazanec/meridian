import { PublicKey } from "@solana/web3.js";

/**
 * Client-visible configuration, sourced from `NEXT_PUBLIC_*` env vars so the same
 * build runs against localnet, devnet, or mainnet without code changes. Secrets never
 * live here — the frontend holds no keys; the user's wallet signs everything.
 */

/** RPC endpoint the read hooks and wallet adapter talk to. */
export const RPC_URL =
  process.env.NEXT_PUBLIC_RPC_URL ?? "http://127.0.0.1:8899";

/**
 * The USDC mint used as collateral (from the program's `Config`). The frontend needs
 * it to build mint/redeem/order instructions and to read USDC balances. We read it
 * from `Config` on-chain where possible; this env var is the bootstrap/default so the
 * app can render before a config fetch resolves (and for local validators where the
 * mint is created by a setup script).
 */
const USDC_MINT_RAW = process.env.NEXT_PUBLIC_USDC_MINT ?? "";

/** Parse the configured USDC mint, or null if unset/invalid (use Config instead). */
export function configuredUsdcMint(): PublicKey | null {
  if (!USDC_MINT_RAW) return null;
  try {
    return new PublicKey(USDC_MINT_RAW);
  } catch {
    return null;
  }
}

/** Cluster label for display only (e.g. the header badge). */
export const CLUSTER_LABEL = process.env.NEXT_PUBLIC_CLUSTER ?? "localnet";
