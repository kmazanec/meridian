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
