/**
 * The shared runtime context the tools close over.
 *
 * A bot's tools all need the same handful of things — the chain client, the resolved
 * collateral mint, the on-chain Config (for per-ticker oracle feed ids), the environment
 * (history/Hermes URLs, dry-run flag), and the logger. Rather than thread these through
 * every tool, we build one {@link BotContext} per bot and bind it into the tools.
 *
 * This module also owns the small bits of read logic more than one tool relies on:
 * discovering the open markets and resolving a ticker's Hermes feed id from Config.
 */

import { PublicKey } from "@solana/web3.js";
import {
  Ticker,
  tickerFromArg,
  symbolToTicker,
  tickerToSymbol,
  type ConfigAccount,
  type MeridianProgram,
} from "@meridian/sdk";
import type BN from "bn.js";
import type { BotChain } from "./chain";
import type { Environment } from "./config";
import type { Logger } from "./logger";

export interface BotContext {
  chain: BotChain;
  usdcMint: PublicKey;
  config: ConfigAccount;
  env: Environment;
  log: Logger;
}

/** An open market the bot can trade, with the fields the tools and runner display. */
export interface OpenMarket {
  address: PublicKey;
  ticker: Ticker;
  symbol: string;
  strike: BN;
  tradingDay: BN;
}

interface RawMarketAll {
  publicKey: PublicKey;
  account: {
    ticker: Record<string, unknown>;
    strike: BN;
    tradingDay: BN;
    state: Record<string, unknown>;
  };
}

/** Raw `getProgramAccounts` market scan + normalize to open markets (uncached). */
async function scanOpenMarkets(
  program: MeridianProgram
): Promise<OpenMarket[]> {
  const raw = (await program.account.market.all()) as unknown as RawMarketAll[];
  const open: OpenMarket[] = [];
  for (const r of raw) {
    const state = Object.keys(r.account.state)[0] ?? "";
    if (state === "settled") continue;
    const ticker = tickerFromArg(r.account.ticker);
    open.push({
      address: r.publicKey,
      ticker,
      symbol: tickerToSymbol(ticker),
      strike: r.account.strike,
      tradingDay: r.account.tradingDay,
    });
  }
  // Stable order: by symbol, then strike.
  open.sort(
    (a, b) => a.symbol.localeCompare(b.symbol) || a.strike.cmp(b.strike)
  );
  return open;
}

/** How long a market-list scan stays fresh. Markets are created ~once/day, so a short TTL
 * is safe and collapses the many per-tick lookups (every read tool + place_order calls this)
 * into a single `getProgramAccounts` — the chief source of the RPC 429s on shared endpoints. */
export const MARKETS_TTL_MS = 30_000;

interface CacheEntry {
  at: number;
  inflight?: Promise<OpenMarket[]>;
  value?: OpenMarket[];
}
// Keyed by the program instance (one per bot), so bots don't share each other's cache.
const marketsCache = new WeakMap<MeridianProgram, CacheEntry>();

/**
 * Discover every *open* market (settled ones are filtered out — you can't open new positions
 * on them). Cached per program for {@link MARKETS_TTL_MS}: concurrent callers within a tick
 * share one in-flight scan, and repeat calls within the TTL reuse the result, so a tick's
 * many lookups cost a single `getProgramAccounts`. Mirrors the web app's discovery, fresh code.
 */
export async function discoverOpenMarkets(
  program: MeridianProgram,
  opts: { force?: boolean } = {}
): Promise<OpenMarket[]> {
  const now = Date.now();
  const entry = marketsCache.get(program);
  if (!opts.force && entry) {
    if (entry.inflight) return entry.inflight; // coalesce concurrent scans
    if (entry.value && now - entry.at < MARKETS_TTL_MS) return entry.value;
  }
  const inflight = scanOpenMarkets(program);
  marketsCache.set(program, { at: now, inflight });
  try {
    const value = await inflight;
    marketsCache.set(program, { at: Date.now(), value });
    return value;
  } catch (err) {
    marketsCache.delete(program); // don't cache a failure
    throw err;
  }
}

/**
 * The 32-byte Pyth feed id for a ticker, as a hex string Hermes accepts, read from the
 * on-chain Config. Returns null if the ticker has no feed configured (a mock-only setup).
 */
export function feedIdHex(
  config: ConfigAccount,
  ticker: Ticker
): string | null {
  const entry = config.tickers.find((t) => t.ticker === ticker);
  if (!entry || entry.feedId.length !== 32) return null;
  // All-zero feed id means "unset" (mock close used instead of a real oracle).
  if (entry.feedId.every((b) => b === 0)) return null;
  return Buffer.from(entry.feedId).toString("hex");
}

/** Resolve a user-supplied symbol string (e.g. "META") to a {@link Ticker}; throws if unknown. */
export function resolveSymbol(symbol: string): Ticker {
  return symbolToTicker(symbol);
}

/**
 * Normalize an *optional* symbol filter to either an uppercase symbol or `undefined`
 * (meaning "no filter — all symbols").
 *
 * LLMs frequently fill an optional field with the literal strings `"null"`, `"undefined"`,
 * `"none"`, `"all"`, `""` (or whitespace) instead of omitting it. Treating those as a real
 * ticker filters out every market and makes the tool look like nothing is open — which is
 * exactly what stalled one bot. Map all those sentinels to `undefined` so the tool lists
 * everything, as intended.
 */
export function normalizeSymbolFilter(
  symbol: string | null | undefined
): string | undefined {
  if (symbol == null) return undefined;
  const trimmed = symbol.trim();
  if (trimmed === "") return undefined;
  const lower = trimmed.toLowerCase();
  if (
    lower === "null" ||
    lower === "undefined" ||
    lower === "none" ||
    lower === "all"
  ) {
    return undefined;
  }
  return trimmed.toUpperCase();
}
