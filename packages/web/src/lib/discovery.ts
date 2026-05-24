import BN from "bn.js";
import { PublicKey } from "@solana/web3.js";
import {
  Outcome,
  Ticker,
  tickerFromArg,
  marketPda,
  type MeridianProgram,
} from "@meridian/sdk";
import { tradingDayKey } from "./format";

/**
 * Market discovery. There is no on-chain index of all markets, so the frontend
 * discovers them with `getProgramAccounts` — Anchor's `program.account.market.all()`
 * filters by the `Market` account discriminator and decodes each. Discovery is a
 * frontend concern; if a shared helper is wanted later it can be lifted into the SDK.
 */

/** A discovered market: its address plus the fields the UI lists/sorts on. */
export interface DiscoveredMarket {
  address: PublicKey;
  ticker: Ticker;
  strike: BN;
  tradingDay: BN;
  state: "open" | "settled";
  outcome: Outcome;
  /** Back-reference to this market's OrderBook account (the join key for books). */
  orderBook: PublicKey;
  /** Yes/No pairs minted; each pair locks exactly $1 of collateral (open interest). */
  pairsMinted: BN;
  /** Closing price written at settlement (USDC base units); null while open. */
  settlementPrice: BN | null;
}

/** Shape of a raw decoded `Market` account from Anchor's `.all()`. */
interface RawMarketAccount {
  publicKey: PublicKey;
  account: {
    ticker: Record<string, unknown>;
    strike: BN;
    tradingDay: BN;
    state: Record<string, unknown>;
    outcome: Record<string, unknown>;
    // The three below ride along in the same decoded account — no extra RPC.
    orderBook: PublicKey;
    pairsMinted: BN;
    settlementPrice: BN | null;
  };
}

function enumKey(e: Record<string, unknown>): string {
  return Object.keys(e)[0] ?? "";
}

function normalizeOutcome(e: Record<string, unknown>): Outcome {
  switch (enumKey(e)) {
    case "yesWins":
      return Outcome.YesWins;
    case "noWins":
      return Outcome.NoWins;
    default:
      return Outcome.Unsettled;
  }
}

/** Decode + normalize one raw Anchor market account into a {@link DiscoveredMarket}. */
export function normalizeDiscovered(raw: RawMarketAccount): DiscoveredMarket {
  return {
    address: raw.publicKey,
    ticker: tickerFromArg(raw.account.ticker),
    strike: raw.account.strike,
    tradingDay: raw.account.tradingDay,
    state: enumKey(raw.account.state) === "settled" ? "settled" : "open",
    outcome: normalizeOutcome(raw.account.outcome),
    orderBook: raw.account.orderBook,
    pairsMinted: raw.account.pairsMinted,
    settlementPrice: raw.account.settlementPrice ?? null,
  };
}

/**
 * Discover every market via `getProgramAccounts`, decoded and normalized. Sorted by
 * ticker, then strike, then trading day — a stable order for lists.
 */
export async function discoverMarkets(
  program: MeridianProgram
): Promise<DiscoveredMarket[]> {
  const raw =
    (await program.account.market.all()) as unknown as RawMarketAccount[];
  const markets = raw.map(normalizeDiscovered);
  markets.sort(
    (a, b) =>
      a.ticker - b.ticker ||
      a.strike.cmp(b.strike) ||
      a.tradingDay.cmp(b.tradingDay)
  );
  return markets;
}

/** Group discovered markets by ticker (for the Markets page's per-stock counts). */
export function groupByTicker(
  markets: DiscoveredMarket[]
): Map<Ticker, DiscoveredMarket[]> {
  const byTicker = new Map<Ticker, DiscoveredMarket[]>();
  for (const m of markets) {
    const list = byTicker.get(m.ticker);
    if (list) list.push(m);
    else byTicker.set(m.ticker, [m]);
  }
  return byTicker;
}

/** Count of *open* (still-trading) markets for a ticker. */
export function activeCount(markets: DiscoveredMarket[]): number {
  return markets.filter((m) => m.state === "open").length;
}

/** One trading day's markets, with the day's stable ET key and the raw trading-day instant. */
export interface MarketDayGroup {
  /** ET date key, e.g. `2026-05-23` (sortable). */
  dayKey: string;
  /** The trading-day instant (unix seconds) — for labelling/formatting. */
  tradingDay: BN;
  markets: DiscoveredMarket[];
}

/**
 * Group markets by trading day (newest day first), each day's markets sorted by ticker then
 * strike. Keys on the ET date (via tradingDayKey) so the grouping is stable regardless of the
 * viewer's timezone. Pure — unit-tested directly.
 */
export function groupByTradingDay(
  markets: DiscoveredMarket[]
): MarketDayGroup[] {
  const byDay = new Map<string, MarketDayGroup>();
  for (const m of markets) {
    const dayKey = tradingDayKey(m.tradingDay);
    const group = byDay.get(dayKey);
    if (group) group.markets.push(m);
    else byDay.set(dayKey, { dayKey, tradingDay: m.tradingDay, markets: [m] });
  }
  const groups = [...byDay.values()];
  groups.sort((a, b) => b.dayKey.localeCompare(a.dayKey)); // newest day first
  for (const g of groups) {
    g.markets.sort(
      (a, b) => a.ticker - b.ticker || a.strike.cmp(b.strike)
    );
  }
  return groups;
}

/** Re-derive a market's PDA from its identity (sanity/round-trip helper). */
export function addressFor(m: DiscoveredMarket): PublicKey {
  return marketPda(m.ticker, m.strike, m.tradingDay);
}
