import BN from "bn.js";
import {
  dualBook,
  Outcome,
  type BookView,
  type OrderBookAccount,
  type Ticker,
} from "@meridian/sdk";
import { priceFromBook, impliedComplement, midPrice } from "./market-math";
import type { DiscoveredMarket } from "./discovery";

/**
 * Pure derivations for the Markets page. Everything here operates on already-fetched
 * data (discovered markets + a map of their order books) and returns plain view-models
 * — no RPC, no React, no formatting. It is unit-tested directly with hand-built shapes.
 *
 * The book map is keyed by the *order book account address* (base58); discovery carries
 * each market's `orderBook` back-reference, so the join is a single lookup per strike.
 */

/** A book keyed by its OrderBook account address, as `useAllBooks` produces. */
export type BookMap = Map<string, OrderBookAccount>;

/** Summary stats for one book view (one perspective of one market). */
export interface BookStats {
  bestBid: BN | null;
  bestAsk: BN | null;
  /** bestAsk − bestBid, or null if either side is empty. */
  spread: BN | null;
  /** Total resting size across both sides (token base units). */
  restingSize: BN;
}

/** Best bid/ask, spread, and total resting size for a single book perspective. */
export function bookStats(view: BookView): BookStats {
  const bestBid = view.bids[0]?.price ?? null;
  const bestAsk = view.asks[0]?.price ?? null;
  const spread = bestBid && bestAsk ? bestAsk.sub(bestBid) : null;
  let restingSize = new BN(0);
  for (const lvl of view.bids) restingSize = restingSize.add(lvl.size);
  for (const lvl of view.asks) restingSize = restingSize.add(lvl.size);
  return { bestBid, bestAsk, spread, restingSize };
}

/** One strike's row in the per-ticker ladder. */
export interface StrikeRow {
  address: string;
  strike: BN;
  state: "open" | "settled";
  outcome: Outcome;
  /** Live Yes price (mid, with bid/ask/50-50 fallbacks). */
  yesPrice: BN;
  /** Implied No price (the complement). */
  noPrice: BN;
  /** bestAsk − bestBid on the Yes book, or null if a side is empty. */
  spread: BN | null;
  /** Total resting size across the Yes book (token base units). */
  restingSize: BN;
  /** Yes-perspective depth for the mini visualization (best-first). */
  depth: BookView;
  settlementPrice: BN | null;
}

/** The Yes view of a market's book (empty book if none was fetched). */
function yesView(market: DiscoveredMarket, books: BookMap): BookView {
  const book = books.get(market.orderBook.toBase58());
  if (!book) return { bids: [], asks: [] };
  return dualBook(book).yes;
}

/** Build a ladder row for one discovered market, joined to its book. */
export function strikeRow(market: DiscoveredMarket, books: BookMap): StrikeRow {
  const view = yesView(market, books);
  const stats = bookStats(view);
  const yesPrice = priceFromBook(view);
  return {
    address: market.address.toBase58(),
    strike: market.strike,
    state: market.state,
    outcome: market.outcome,
    yesPrice,
    noPrice: impliedComplement(yesPrice),
    spread: stats.spread,
    restingSize: stats.restingSize,
    depth: view,
    settlementPrice: market.settlementPrice,
  };
}

/**
 * All ladder rows for a ticker's markets, sorted by strike ascending (open before
 * settled at the same strike, so the active book leads).
 */
export function strikeLadderRows(
  markets: DiscoveredMarket[],
  books: BookMap
): StrikeRow[] {
  return markets
    .map((m) => strikeRow(m, books))
    .sort(
      (a, b) =>
        a.strike.cmp(b.strike) ||
        Number(a.state === "settled") - Number(b.state === "settled")
    );
}

/** Per-ticker rollups shown on the collapsed card and the ladder header. */
export interface TickerAggregate {
  openCount: number;
  /** Σ resting size across every book for the ticker (token base units). */
  totalRestingSize: BN;
  /** Σ pairs minted across the ticker's markets (open interest, token base units). */
  totalPairsMinted: BN;
  /**
   * Collateral locked, in USDC base units. Each minted pair locks exactly $1, and
   * token/USDC share the same 6-decimal scale, so the locked dollars equal
   * `totalPairsMinted` numerically — formatted as USDC rather than tokens. Exact by
   * construction (no vault-balance RPC needed).
   */
  totalCollateral: BN;
}

/** Roll up a ticker's markets into liquidity/open-interest totals. */
export function tickerAggregate(
  markets: DiscoveredMarket[],
  books: BookMap
): TickerAggregate {
  let openCount = 0;
  let totalRestingSize = new BN(0);
  let totalPairsMinted = new BN(0);
  for (const m of markets) {
    if (m.state === "open") openCount += 1;
    totalPairsMinted = totalPairsMinted.add(m.pairsMinted);
    totalRestingSize = totalRestingSize.add(
      bookStats(yesView(m, books)).restingSize
    );
  }
  return {
    openCount,
    totalRestingSize,
    totalPairsMinted,
    totalCollateral: totalPairsMinted.clone(),
  };
}

/**
 * The representative open market for a ticker: the median-strike open market (a liquidity
 * proxy), or null if none are open. Mirrors `representativeMarkets` selection in
 * {@link useTickerPrices}, but reuses already-fetched books rather than re-fetching.
 */
export function representativeMarket(
  markets: DiscoveredMarket[]
): DiscoveredMarket | null {
  const open = markets
    .filter((m) => m.state === "open")
    .sort((a, b) => a.strike.cmp(b.strike));
  if (open.length === 0) return null;
  return open[Math.floor((open.length - 1) / 2)];
}

/** Representative Yes price for the collapsed card (or null with no open markets). */
export function representativeYesPrice(
  markets: DiscoveredMarket[],
  books: BookMap
): BN | null {
  const rep = representativeMarket(markets);
  return rep ? priceFromBook(yesView(rep, books)) : null;
}

/** Representative mid price (or null) — used for the spread chip. */
export function representativeMid(
  markets: DiscoveredMarket[],
  books: BookMap
): BN | null {
  const rep = representativeMarket(markets);
  return rep ? midPrice(yesView(rep, books)) : null;
}

// --- Per-ticker view-model (what the Markets page passes to MarketCard) ---

/** One trading day's close (from the price-history endpoint). Re-exported for callers. */
export interface ClosePoint {
  date: string;
  close: number;
}

/**
 * Everything one ticker's card needs, derived once upstream so the components stay
 * presentational (no hooks, no RPC, no BN math beyond formatting).
 */
export interface TickerView {
  ticker: Ticker;
  symbol: string;
  /** The representative open market's settlement instant, for the countdown (or null). */
  tradingDay: BN | null;
  activeCount: number;
  /** Representative Yes price for the collapsed summary (or null with no open markets). */
  repYesPrice: BN | null;
  totalRestingSize: BN;
  totalPairsMinted: BN;
  totalCollateral: BN;
  /** Every strike's ladder row, strike-ascending. */
  rows: StrikeRow[];
  /** Last-N-days closes for the sparkline (null until/if loaded). */
  history: ClosePoint[] | null;
}

/** Assemble a ticker's full view-model from its markets, books, and price history. */
export function buildTickerView(opts: {
  ticker: Ticker;
  symbol: string;
  markets: DiscoveredMarket[];
  books: BookMap;
  history: ClosePoint[] | null;
}): TickerView {
  const { ticker, symbol, markets, books, history } = opts;
  const agg = tickerAggregate(markets, books);
  const rep = representativeMarket(markets);
  return {
    ticker,
    symbol,
    tradingDay: rep?.tradingDay ?? null,
    activeCount: agg.openCount,
    repYesPrice: rep ? priceFromBook(yesView(rep, books)) : null,
    totalRestingSize: agg.totalRestingSize,
    totalPairsMinted: agg.totalPairsMinted,
    totalCollateral: agg.totalCollateral,
    rows: strikeLadderRows(markets, books),
    history,
  };
}
