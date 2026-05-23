/**
 * Resolve per-ticker *previous close* prices from the live price-history API, for seeding
 * realistic strike ladders in `create-markets`.
 *
 * Why this exists: the strike ladder is computed from a previous-close price. When that
 * close comes from stale `MOCK_CLOSE_*` envars but the bots read live spot from Pyth, every
 * strike sits far from spot and the agents bid one-directionally. Seeding strikes from the
 * *real* most-recent close puts the ladder back around where the stock actually trades.
 *
 * Source: the dashboard's `GET {WEB_BASE_URL}/api/history?symbol=<SYM>` Cloudflare Pages
 * Function, which returns ascending daily closes `[{ date, close }]` from Yahoo Finance.
 * The last element is the most recent close. This is the same data the History page shows,
 * works 24/7 (unlike Pyth equity feeds, which only update during US market hours), and needs
 * no feed-id configuration.
 *
 * Resilience: each ticker is fetched independently; a failure for one symbol resolves to
 * `undefined` for that symbol (the caller falls back to its `MOCK_CLOSE_*`), so a flaky
 * endpoint never aborts market creation.
 */

import BN from "bn.js";
import { PAYOFF_UNIT, TICKER_SYMBOLS, type TickerSymbol } from "@meridian/sdk";
import type { ConsoleLog } from "./log";

/** Convert a dollar amount to USDC base units (6 dp), rounded. */
function dollarsToBaseUnits(dollars: number): BN {
  return new BN(Math.round(dollars * Number(PAYOFF_UNIT.toString())));
}

/**
 * Last-resort hardcoded previous closes (USD), so market creation always has a number to
 * derive strikes from even with no live endpoint and no MOCK_CLOSE_* set (e.g. a fully
 * offline `make dev`). These drift from reality over time — they are the floor of the
 * fallback chain (live → envar → these), not a source of truth. Refresh occasionally.
 */
export const DEFAULT_CLOSES: Record<TickerSymbol, number> = {
  AAPL: 230,
  MSFT: 420,
  GOOGL: 175,
  AMZN: 230,
  NVDA: 180,
  META: 720,
  TSLA: 420,
};

/** Pull the most recent close (USD) for one symbol from /api/history, or null on any failure. */
async function fetchLastClose(
  baseUrl: string,
  symbol: TickerSymbol
): Promise<number | null> {
  const url = `${baseUrl.replace(
    /\/$/,
    ""
  )}/api/history?symbol=${encodeURIComponent(symbol)}`;
  try {
    const res = await fetch(url, { headers: { accept: "application/json" } });
    if (!res.ok) return null;
    const body: unknown = await res.json();
    if (!Array.isArray(body) || body.length === 0) return null;
    // Ascending by date — the last row is the most recent close.
    const last = body[body.length - 1] as { close?: unknown };
    const close = Number(last?.close);
    return Number.isFinite(close) && close > 0 ? close : null;
  } catch {
    return null;
  }
}

/**
 * Fetch live previous-close prices (USDC base units) for the given symbols from the history
 * API. Returns a partial map: symbols whose fetch failed are simply absent (caller falls
 * back to mock closes). Symbols are fetched concurrently.
 */
export async function fetchLiveCloses(
  baseUrl: string,
  symbols: readonly TickerSymbol[] = TICKER_SYMBOLS,
  log?: ConsoleLog
): Promise<Partial<Record<TickerSymbol, BN>>> {
  log?.step(`Fetching live previous closes from ${baseUrl}/api/history`);
  const out: Partial<Record<TickerSymbol, BN>> = {};
  await Promise.all(
    symbols.map(async (sym) => {
      const close = await fetchLastClose(baseUrl, sym);
      if (close === null) {
        log?.detail(`  ${sym}`, "no live close — will fall back to MOCK_CLOSE");
        return;
      }
      out[sym] = dollarsToBaseUnits(close);
      log?.detail(`  ${sym}`, `live close $${close}`);
    })
  );
  return out;
}

/**
 * Resolve the per-ticker previous closes that drive the strike ladder, via a three-tier
 * fallback so market creation always has a sensible number:
 *
 *   1. live close from {@link fetchLiveCloses} (when `live` + `webBaseUrl` are set),
 *   2. else the envar `MOCK_CLOSE_*` value (passed in `mockCloses`),
 *   3. else the hardcoded {@link DEFAULT_CLOSES} floor.
 *
 * Later tiers fill only the gaps the earlier ones left, per symbol — so a flaky endpoint or a
 * single missing envar degrades gracefully instead of dropping that ticker's markets.
 */
export async function resolveCloses(opts: {
  symbols: readonly TickerSymbol[];
  mockCloses: Partial<Record<TickerSymbol, BN>>;
  live: boolean;
  webBaseUrl?: string;
  log?: ConsoleLog;
}): Promise<Record<TickerSymbol, BN>> {
  const { symbols, mockCloses, live, webBaseUrl, log } = opts;

  // Tier 3 (floor): hardcoded defaults for every requested symbol.
  const resolved: Partial<Record<TickerSymbol, BN>> = {};
  for (const sym of symbols) {
    resolved[sym] = dollarsToBaseUnits(DEFAULT_CLOSES[sym]);
  }
  // Tier 2: envar mock closes override the floor.
  Object.assign(resolved, mockCloses);
  // Tier 1: live closes override everything (only the symbols that fetched cleanly).
  if (live && webBaseUrl) {
    const liveCloses = await fetchLiveCloses(webBaseUrl, symbols, log);
    Object.assign(resolved, liveCloses);
  } else if (live && !webBaseUrl) {
    log?.warn(
      "LIVE_CLOSES set but WEB_BASE_URL is not — using MOCK_CLOSE_* / defaults."
    );
  }
  return resolved as Record<TickerSymbol, BN>;
}
