/**
 * Environment configuration for the automation service.
 *
 * All operational inputs come from the environment (ROADMAP concern #8): the automation
 * keypair secret, the RPC endpoint, the USDC mint, the price-source selection (mock vs
 * Pyth) and its inputs (mock closes or per-ticker feed ids), the alert webhook, and which
 * tickers to run. `loadConfig` validates and parses these into a typed object; the CLI
 * entrypoints build the job dependencies from it.
 *
 * The exact env keys are documented here so F-10 can add them to `.env.example` (the file
 * itself is owned by F-10). See `ENV_KEYS` at the bottom.
 */

import BN from "bn.js";
import { PublicKey } from "@solana/web3.js";
import { Ticker, symbolToTicker, TICKER_SYMBOLS, PAYOFF_UNIT } from "@meridian/sdk";
import { loadKeypairFromEnv, AUTOMATION_KEYPAIR_ENV } from "./keypair";
import { dollarsToBaseUnits } from "./strikes";
import type { Keypair } from "@solana/web3.js";

/** Which previous-close price source the morning job uses. */
export enum PriceSourceKind {
  Mock = "mock",
  Pyth = "pyth",
}

type Env = NodeJS.ProcessEnv | Record<string, string | undefined>;

export interface AutomationConfig {
  keypair: Keypair;
  rpcUrl: string;
  usdcMint: PublicKey;
  /** Tickers to operate on (defaults to the full MAG7). */
  tickers: Ticker[];
  priceSourceKind: PriceSourceKind;
  /** Per-ticker Pyth feed ids (hex) — used when `priceSourceKind === Pyth`. */
  feedIds: Partial<Record<Ticker, string>>;
  /** Per-ticker mock closes in base units — used when `priceSourceKind === Mock`. */
  mockPrices: Partial<Record<Ticker, BN>>;
  /** Optional alert webhook URL; absent → log-only alerts. */
  alertWebhookUrl?: string;
  /** Optional Hermes endpoint override. */
  hermesUrl?: string;
  /** Include the rounded close as an at-the-money strike. Default false. */
  includeClose: boolean;
}

function required(env: Env, key: string): string {
  const v = env[key];
  if (v === undefined || v.trim().length === 0) {
    throw new Error(`${key} is required but not set.`);
  }
  return v.trim();
}

function parsePubkey(value: string, key: string): PublicKey {
  try {
    return new PublicKey(value);
  } catch {
    throw new Error(`${key} is not a valid base58 public key: ${value}`);
  }
}

/** Parse and validate the automation config from an environment map. */
export function loadConfig(env: Env = process.env): AutomationConfig {
  const keypair = loadKeypairFromEnv(env);
  const rpcUrl = required(env, "RPC_URL");
  const usdcMint = parsePubkey(required(env, "USDC_MINT"), "USDC_MINT");

  const tickers = parseTickers(env["TICKERS"]);

  const priceSourceKind =
    (env["PRICE_SOURCE"]?.trim().toLowerCase() as PriceSourceKind) ||
    PriceSourceKind.Mock;
  if (
    priceSourceKind !== PriceSourceKind.Mock &&
    priceSourceKind !== PriceSourceKind.Pyth
  ) {
    throw new Error(
      `PRICE_SOURCE must be "mock" or "pyth" (got "${env["PRICE_SOURCE"]}")`
    );
  }

  const feedIds: Partial<Record<Ticker, string>> = {};
  const mockPrices: Partial<Record<Ticker, BN>> = {};
  for (const sym of TICKER_SYMBOLS) {
    const ticker = symbolToTicker(sym);
    const feed = env[`FEED_${sym}`]?.trim();
    if (feed) feedIds[ticker] = feed;
    const mock = env[`MOCK_CLOSE_${sym}`]?.trim();
    if (mock) {
      const dollars = Number(mock);
      if (!Number.isFinite(dollars) || dollars <= 0) {
        throw new Error(`MOCK_CLOSE_${sym} must be a positive number (got "${mock}")`);
      }
      // Store the *exact* dollar value in base units (not snapped to $10 — the strike
      // rounding happens later in computeStrikes). $214.5 → 214_500000.
      mockPrices[ticker] = dollarsExactToBaseUnits(dollars);
    }
  }

  return {
    keypair,
    rpcUrl,
    usdcMint,
    tickers,
    priceSourceKind,
    feedIds,
    mockPrices,
    alertWebhookUrl: env["ALERT_WEBHOOK_URL"]?.trim() || undefined,
    hermesUrl: env["HERMES_URL"]?.trim() || undefined,
    includeClose: parseBool(env["INCLUDE_CLOSE"]),
  };
}

/** Parse a comma-separated TICKERS list (symbols) into ordinals; default = full MAG7. */
function parseTickers(value: string | undefined): Ticker[] {
  if (!value || value.trim().length === 0) {
    return TICKER_SYMBOLS.map((s) => symbolToTicker(s));
  }
  return value
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((s) => symbolToTicker(s)); // throws on an unknown symbol
}

function parseBool(value: string | undefined): boolean {
  if (!value) return false;
  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

/**
 * Exact dollars → USDC base units (6 dp) without the $10 strike snapping. Quantizes to the
 * smallest base unit via integer rounding. (Strike rounding to $10 is `computeStrikes`'s
 * job, applied to this value.)
 */
function dollarsExactToBaseUnits(dollars: number): BN {
  return new BN(Math.round(dollars * Number(PAYOFF_UNIT.toString())));
}

// Re-export so a consumer can snap a raw dollar value to the strike grid if needed.
export { dollarsToBaseUnits };

/**
 * The environment keys this service reads. Documented here so F-10 can populate
 * `.env.example` (which it owns). Required keys are marked.
 */
export const ENV_KEYS = {
  required: [
    `${AUTOMATION_KEYPAIR_ENV} (JSON byte array or base58 secret key — never commit)`,
    "RPC_URL (Solana RPC endpoint)",
    "USDC_MINT (collateral mint pubkey)",
  ],
  optional: [
    'PRICE_SOURCE ("mock" | "pyth"; default "mock")',
    "FEED_<SYMBOL> (Pyth hex feed id per ticker, e.g. FEED_META; required for pyth source)",
    "MOCK_CLOSE_<SYMBOL> (mock previous close in dollars, e.g. MOCK_CLOSE_META=680)",
    "TICKERS (comma list of symbols to run; default all MAG7)",
    "ALERT_WEBHOOK_URL (failure alerts POST here; default log-only)",
    "HERMES_URL (Pyth Hermes endpoint override)",
    "INCLUDE_CLOSE (1/true to add the at-the-money strike)",
  ],
} as const;
