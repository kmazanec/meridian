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
import {
  Ticker,
  symbolToTicker,
  TICKER_SYMBOLS,
  dollarsToBaseUnits,
} from "@meridian/sdk";
import { loadKeypairFromEnv, AUTOMATION_KEYPAIR_ENV } from "./keypair";
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
    if (feed) feedIds[ticker] = normalizeFeedId(feed, sym);
    const mock = env[`MOCK_CLOSE_${sym}`]?.trim();
    if (mock) {
      const dollars = Number(mock);
      if (!Number.isFinite(dollars) || dollars <= 0) {
        throw new Error(
          `MOCK_CLOSE_${sym} must be a positive number (got "${mock}")`
        );
      }
      // Store the *exact* dollar value in base units (not snapped to $10 — the strike
      // rounding happens later in computeStrikes). $214.5 → 214_500000.
      mockPrices[ticker] = dollarsToBaseUnits(dollars);
    }
  }

  // Fail fast if a Pyth run has no feeds for the tickers it will operate on — otherwise the
  // service would emit one runtime "no feed id" alert per ticker instead of one clear config
  // error up front. (The mock source needs no feeds.)
  if (priceSourceKind === PriceSourceKind.Pyth) {
    const missing = tickers
      .filter((t) => !feedIds[t])
      .map((t) => TICKER_SYMBOLS[t]);
    if (missing.length > 0) {
      throw new Error(
        `PRICE_SOURCE=pyth but no feed id configured for: ${missing.join(
          ", "
        )} ` +
          `(set FEED_<SYMBOL> for each, matching Config.tickers[].feed_id).`
      );
    }
  }

  const alertWebhookUrl = env["ALERT_WEBHOOK_URL"]?.trim() || undefined;
  if (alertWebhookUrl) assertSafeWebhookUrl(alertWebhookUrl);

  return {
    keypair,
    rpcUrl,
    usdcMint,
    tickers,
    priceSourceKind,
    feedIds,
    mockPrices,
    alertWebhookUrl,
    hermesUrl: env["HERMES_URL"]?.trim() || undefined,
    // The at-the-money (rounded previous close) strike is on by default — it's the
    // most-traded level and guarantees an odd strike count even when ±% legs collide
    // by rounding (e.g. AAPL @ $230). Set INCLUDE_CLOSE=0 to drop it.
    includeClose: parseBool(env["INCLUDE_CLOSE"], true),
  };
}

/**
 * Validate + normalize a Pyth feed id: a 32-byte (64 hex char) value, optional `0x` prefix.
 * Catches transposed/garbage ids at config load rather than wasting an on-chain round-trip
 * (settlement) or silently reading the wrong stock's price (the morning prev-close, which
 * the on-chain WrongFeed check does *not* protect). Returns the id with its original prefix
 * preserved (the SDK's Hermes helper accepts either form).
 */
function normalizeFeedId(value: string, sym: string): string {
  const hex = value.startsWith("0x") ? value.slice(2) : value;
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error(
      `FEED_${sym} must be a 32-byte hex feed id (64 hex chars, optional 0x prefix); got "${value}"`
    );
  }
  return value;
}

/**
 * Reject an obviously-unsafe alert webhook URL. The URL is operator-supplied (trusted), so
 * this is hardening, not a hard security boundary: require http(s) and refuse loopback /
 * link-local / cloud-metadata hosts so a misconfigured env can't turn the alerter into an
 * SSRF vector against internal services.
 */
function assertSafeWebhookUrl(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`ALERT_WEBHOOK_URL is not a valid URL: ${url}`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(
      `ALERT_WEBHOOK_URL must be http(s) (got "${parsed.protocol}")`
    );
  }
  const host = parsed.hostname.toLowerCase();
  const blocked =
    host === "localhost" ||
    host === "0.0.0.0" ||
    host === "169.254.169.254" || // cloud instance metadata
    host.startsWith("127.") ||
    host.startsWith("10.") ||
    host.startsWith("192.168.") ||
    host.startsWith("169.254.") ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host); // 172.16/12 private range
  if (blocked) {
    throw new Error(
      `ALERT_WEBHOOK_URL points at a private/loopback/metadata host ("${host}"); refusing to avoid SSRF.`
    );
  }
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

function parseBool(value: string | undefined, defaultValue = false): boolean {
  if (value === undefined || value.trim() === "") return defaultValue;
  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

/**
 * The environment keys this service reads, the single source of truth for
 * populating `.env.example`. Required keys are marked.
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
    "INCLUDE_CLOSE (add the at-the-money rounded-close strike; default on, set 0 to drop)",
  ],
} as const;
