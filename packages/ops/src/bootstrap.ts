/**
 * Bootstrap the on-chain world after a deploy: ensure a USDC collateral mint exists and the
 * singleton `Config` is initialized (admin = deployer, the seven MAG7 oracle feed ids).
 *
 * Idempotent: if `Config` already exists it is left untouched (a second `initialize_config`
 * would fail on the program's re-init guard). The USDC mint is either an existing one passed
 * via `USDC_MINT` (e.g. a known devnet USDC) or a fresh mock mint created here with the
 * deployer as mint authority (the local/demo default — the program treats any SPL mint as
 * collateral; the mint identity is recorded in `Config.usdc_mint`).
 *
 * Feed ids: for a local validator the demo uses the same deterministic test pattern as the
 * F-09 harness (`ticker i -> [i+1; 32]`), since no real Pyth Receiver is deployed and
 * settlement is driven by the admin override. For devnet the operator supplies real per-
 * ticker hex feed ids via `FEED_<SYMBOL>` so the on-chain `WrongFeed` check lines up with
 * the live pull-oracle path; any ticker without a configured feed falls back to the test
 * pattern (harmless for the admin-override demo, and clearly logged).
 */

import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { createMint } from "@solana/spl-token";
import {
  getProgram,
  initializeConfig,
  fetchConfig,
  NUM_TICKERS,
  TICKER_SYMBOLS,
  Ticker,
  type TickerConfigInput,
} from "@meridian/sdk";
import { sendTx } from "@meridian/e2e";
import { programDataAddress } from "./deploy";
import type { ConsoleLog } from "./log";

/** USDC has 6 decimals; the mock mint mirrors that so $1 == 1_000000 base units. */
const USDC_DECIMALS = 6;

export interface BootstrapOptions {
  rpcUrl: string;
  deployer: Keypair;
  programId: PublicKey;
  /** Existing collateral mint; omit to create a fresh mock USDC mint. */
  usdcMint?: PublicKey;
  /** Per-ticker hex feed ids (devnet). Tickers absent here use the deterministic test id. */
  feedIdsHex?: Partial<Record<(typeof TICKER_SYMBOLS)[number], string>>;
  log?: ConsoleLog;
}

export interface BootstrapResult {
  usdcMint: PublicKey;
  programData: PublicKey;
  /** True if Config already existed (bootstrap was a no-op for config). */
  configAlreadyExisted: boolean;
}

/**
 * Convert a 32-byte feed id (hex, optional `0x`) to a `number[32]`. Throws on a wrong-length
 * or non-hex value so a typo'd devnet feed id fails here, not at settlement.
 */
export function feedIdHexToBytes(hex: string): number[] {
  const h = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (!/^[0-9a-fA-F]{64}$/.test(h)) {
    throw new Error(
      `feed id must be 32 bytes (64 hex chars, optional 0x prefix); got "${hex}"`
    );
  }
  const out: number[] = [];
  for (let i = 0; i < 64; i += 2) out.push(parseInt(h.slice(i, i + 2), 16));
  return out;
}

/** The deterministic local/test feed id for a ticker ordinal: `[i+1; 32]`. */
export function testFeedId(ticker: Ticker): number[] {
  return new Array(32).fill((ticker as number) + 1);
}

/** Build the full 7-entry ticker config, preferring a configured hex feed id per ticker. */
export function buildTickerConfig(
  feedIdsHex: BootstrapOptions["feedIdsHex"] = {}
): TickerConfigInput[] {
  return Array.from({ length: NUM_TICKERS }, (_, i) => {
    const sym = TICKER_SYMBOLS[i];
    const hex = feedIdsHex[sym];
    return {
      ticker: i as Ticker,
      feedId: hex ? feedIdHexToBytes(hex) : testFeedId(i as Ticker),
    };
  });
}

/** Ensure a USDC mint + initialized Config exist. Idempotent. */
export async function bootstrap(
  opts: BootstrapOptions
): Promise<BootstrapResult> {
  const connection = new Connection(opts.rpcUrl, "confirmed");
  const program = getProgram({
    connection,
    publicKey: opts.deployer.publicKey,
  } as never);
  const programData = programDataAddress(opts.programId);

  const existing = await fetchConfig(program);
  if (existing) {
    // Fail fast on a misleading config: if the operator passed USDC_MINT but Config already
    // pins a *different* collateral mint, leaving it untouched would let them believe markets
    // use their mint while everything actually uses the old one. Surface it instead of
    // silently diverging. (Config is immutable here; re-pointing means a fresh deployment.)
    if (opts.usdcMint && !opts.usdcMint.equals(existing.usdcMint)) {
      throw new Error(
        `USDC_MINT=${opts.usdcMint.toBase58()} but Config is already initialized with a ` +
          `different mint (${existing.usdcMint.toBase58()}). Config's USDC mint is immutable; ` +
          `unset USDC_MINT to use the existing mint, or deploy a fresh program to use a new one.`
      );
    }
    opts.log?.warn(
      `Config already initialized (admin ${existing.admin.toBase58()}, ` +
        `USDC ${existing.usdcMint.toBase58()}) — leaving it untouched.`
    );
    return {
      usdcMint: existing.usdcMint,
      programData,
      configAlreadyExisted: true,
    };
  }

  // USDC mint: reuse the configured one, or create a fresh mock mint.
  let usdcMint: PublicKey;
  if (opts.usdcMint) {
    opts.log?.step(`Using configured USDC mint ${opts.usdcMint.toBase58()}`);
    usdcMint = opts.usdcMint;
  } else {
    opts.log?.step("Creating a mock USDC mint (6 decimals)");
    usdcMint = await createMint(
      connection,
      opts.deployer,
      opts.deployer.publicKey,
      null,
      USDC_DECIMALS
    );
    opts.log?.detail("usdcMint", usdcMint.toBase58());
  }

  const tickers = buildTickerConfig(opts.feedIdsHex);
  opts.log?.step("Initializing Config (admin = deployer)");
  await sendTx(
    connection,
    opts.deployer,
    [
      await initializeConfig(program, {
        admin: opts.deployer.publicKey,
        programData,
        usdcMint,
        tickers,
      }),
    ],
    [opts.deployer]
  );
  opts.log?.ok("Config initialized");

  return { usdcMint, programData, configAlreadyExisted: false };
}
