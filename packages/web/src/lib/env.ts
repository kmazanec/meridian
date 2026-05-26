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
 * WebSocket endpoint for the wallet adapter's `ConnectionProvider`. web3.js uses this for
 * `signatureSubscribe` (tx confirmation) and account subscriptions.
 *
 * Two different conventions, so we can't use one rule for both:
 *  - **Hosted RPCs** (Alchemy/QuickNode/…) serve WSS at the *same host and path* as HTTPS,
 *    only the scheme differs:
 *    `https://solana-devnet.g.alchemy.com/v2/KEY` → `wss://…/v2/KEY`.
 *    web3.js's built-in derivation gets this wrong (it also bumps the port), producing a
 *    dead URL and a flood of `-32601 signatureSubscribe not found`. So we override with a
 *    scheme-only swap.
 *  - **The local `solana-test-validator`** serves its WS on `rpc-port + 1` (8899→8900).
 *    That's exactly what web3.js's default derivation produces, so for localhost we return
 *    `undefined` and let web3.js derive it (a scheme-only swap would wrongly target 8899).
 */
export const WS_URL: string | undefined = deriveWsEndpoint(RPC_URL);

/**
 * The WS endpoint for an RPC URL, or `undefined` to let web3.js derive it. Returns
 * `undefined` for loopback (the local validator, where web3.js's port+1 default is correct)
 * and a scheme-only swap (`https→wss`, `http→ws`) otherwise (hosted providers). Exported so
 * the wallet adapter can derive a matching WS for a custom/overridden endpoint too.
 */
export function deriveWsEndpoint(url: string): string | undefined {
  return isLocalRpc(url) ? undefined : url.replace(/^http/, "ws");
}

/** True for loopback RPC endpoints (the local test validator), where web3.js's default WS derivation is correct. */
function isLocalRpc(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return host === "127.0.0.1" || host === "localhost" || host === "::1";
  } catch {
    return false;
  }
}

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
