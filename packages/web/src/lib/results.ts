import BN from "bn.js";
import { Outcome, Ticker, TICKER_SYMBOLS } from "@meridian/sdk";
import type { FillRecord, Side } from "./tradeStore";

/**
 * Per-trading-day results analytics, derived purely from the user's local fills joined to the
 * on-chain settled-market outcomes. Fills carry what the user *paid* (cost basis the chain
 * doesn't record); the market's `outcome` says whether each side won. From those two we get
 * the day's wagered / earned / lost / net P&L and a per-stock breakdown.
 *
 * Why fills (not current holdings) drive this: a position vanishes from holdings the moment
 * it's redeemed, but fills persist in localStorage — so this still reflects the day after the
 * user redeems. The honesty caveat: it only sees fills made *in this browser*, so we report a
 * `coverage` flag (and unmatched count) the UI uses to qualify the numbers.
 *
 * Everything here is a pure function over plain inputs — unit-tested directly.
 */

const PRICE_SCALE = new BN(1_000_000); // price units per $1.00
const PRICE_SCALE_NUM = 1_000_000;

/** What a settled market tells us, looked up by market address (base58). */
export interface SettledMarketInfo {
  ticker: Ticker;
  /** Settlement instant (unix seconds) — the trading day. */
  tradingDay: BN;
  outcome: Outcome;
}

/** A stock's slice of the day. */
export interface StockResult {
  ticker: Ticker;
  symbol: string;
  /** USDC paid to enter (Σ size × price). */
  wagered: BN;
  /** USDC the winning positions pay out (Σ winning size × $1). */
  earned: BN;
  /** earned − wagered. */
  net: BN;
  wonCount: number;
  lostCount: number;
}

/** The whole day's recap. */
export interface DailyResults {
  tradingDay: BN;
  wagered: BN;
  earned: BN;
  /** Cost sunk into losing positions (Σ losing wagered). */
  lost: BN;
  /** earned − wagered (positive = up on the day). */
  netPnl: BN;
  wonCount: number;
  lostCount: number;
  /** Settled positions counted (won + lost). */
  positionCount: number;
  /** Win rate as a fraction 0..1, or null when there are no settled positions. */
  winRate: number | null;
  /** Per-stock breakdown, biggest stake first. */
  byStock: StockResult[];
  /**
   * True when every fill on a today-settled market also had its market outcome available —
   * i.e. the numbers are complete for what's in this browser. (Always true today, but kept
   * explicit so the UI can flag partial data if a market outcome is ever missing.)
   */
  complete: boolean;
}

/** cost of a fill = size × price / PRICE_SCALE, in USDC base units. */
function fillCost(f: FillRecord): BN {
  return new BN(f.size).mul(new BN(f.price)).div(PRICE_SCALE);
}

/** Did this side win, given the market outcome? */
function sideWon(side: Side, outcome: Outcome): boolean {
  return (
    (side === "yes" && outcome === Outcome.YesWins) ||
    (side === "no" && outcome === Outcome.NoWins)
  );
}

/**
 * Compute the day's results for `tradingDay` from the user's `fills` and a lookup of settled
 * markets (by base58 address). Only fills whose market is settled *on that trading day* count;
 * open or other-day markets are ignored. A winning position earns size × $1; a losing one
 * earns $0. Wagered is the actual cost paid (from the fills).
 */
export function dailyResults(
  fills: FillRecord[],
  settledMarkets: Map<string, SettledMarketInfo>,
  tradingDay: BN
): DailyResults {
  // Aggregate fills by market+side: total size acquired and total cost paid.
  const byPos = new Map<
    string,
    { market: string; side: Side; size: BN; cost: BN }
  >();
  for (const f of fills) {
    const info = settledMarkets.get(f.market);
    if (!info) continue; // not a settled market we know about
    if (!info.tradingDay.eq(tradingDay)) continue; // a different day
    if (info.outcome === Outcome.Unsettled) continue; // not actually decided
    const key = `${f.market}:${f.side}`;
    const prev = byPos.get(key);
    const cost = fillCost(f);
    if (prev) {
      prev.size = prev.size.add(new BN(f.size));
      prev.cost = prev.cost.add(cost);
    } else {
      byPos.set(key, {
        market: f.market,
        side: f.side,
        size: new BN(f.size),
        cost,
      });
    }
  }

  // Fold positions into per-stock buckets and the day totals.
  const stocks = new Map<Ticker, StockResult>();
  let wagered = new BN(0);
  let earned = new BN(0);
  let lost = new BN(0);
  let wonCount = 0;
  let lostCount = 0;

  for (const pos of byPos.values()) {
    const info = settledMarkets.get(pos.market)!;
    const won = sideWon(pos.side, info.outcome);
    const positionEarned = won ? pos.size.clone() : new BN(0); // winner: size × $1

    wagered = wagered.add(pos.cost);
    earned = earned.add(positionEarned);
    if (won) wonCount += 1;
    else {
      lost = lost.add(pos.cost);
      lostCount += 1;
    }

    let s = stocks.get(info.ticker);
    if (!s) {
      s = {
        ticker: info.ticker,
        symbol: TICKER_SYMBOLS[info.ticker],
        wagered: new BN(0),
        earned: new BN(0),
        net: new BN(0),
        wonCount: 0,
        lostCount: 0,
      };
      stocks.set(info.ticker, s);
    }
    s.wagered = s.wagered.add(pos.cost);
    s.earned = s.earned.add(positionEarned);
    if (won) s.wonCount += 1;
    else s.lostCount += 1;
  }

  const byStock = [...stocks.values()]
    .map((s) => ({ ...s, net: s.earned.sub(s.wagered) }))
    .sort((a, b) => b.wagered.cmp(a.wagered));

  const positionCount = wonCount + lostCount;
  return {
    tradingDay,
    wagered,
    earned,
    lost,
    netPnl: earned.sub(wagered),
    wonCount,
    lostCount,
    positionCount,
    winRate: positionCount > 0 ? wonCount / positionCount : null,
    byStock,
    complete: true,
  };
}

/** The most recent trading day among a set of settled markets (unix seconds BN), or null. */
export function latestTradingDay(
  settledMarkets: Map<string, SettledMarketInfo>
): BN | null {
  let latest: BN | null = null;
  for (const info of settledMarkets.values()) {
    if (info.outcome === Outcome.Unsettled) continue;
    if (!latest || info.tradingDay.gt(latest)) latest = info.tradingDay;
  }
  return latest;
}

/** Win rate as a rounded whole-percent string (e.g. "61%"), or "—" when N/A. */
export function formatWinRate(winRate: number | null): string {
  if (winRate === null) return "—";
  return `${Math.round(winRate * 100)}%`;
}

export { PRICE_SCALE_NUM };
