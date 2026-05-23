import BN from "bn.js";
import {
  dualBook,
  Outcome,
  PRICE_SCALE,
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
 * proxy), or null if none are open. A coin-flip-ish strike is usually the most liquid, so
 * its book is the best single "price of the stock" for the grid/strip.
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

/** A live Yes price per ticker, keyed by ticker ordinal. */
export type LivePrices = Partial<Record<Ticker, BN>>;

/**
 * Derive a live Yes price per ticker from the already-fetched shared markets + books — the
 * Landing/strip price source. Each ticker's price is its representative open market's price
 * (or omitted if it has no open market). This reuses the shared `allBooks` map, so the
 * Landing page makes **no** RPC calls of its own (this replaced the old per-ticker price
 * hook, which fired one `fetchOrderBook` per ticker every 30s).
 */
export function livePricesByTicker(
  markets: DiscoveredMarket[],
  books: BookMap
): LivePrices {
  const prices: LivePrices = {};
  const byTicker = new Map<Ticker, DiscoveredMarket[]>();
  for (const m of markets) {
    const list = byTicker.get(m.ticker);
    if (list) list.push(m);
    else byTicker.set(m.ticker, [m]);
  }
  for (const [ticker, list] of byTicker) {
    const price = representativeYesPrice(list, books);
    if (price) prices[ticker] = price;
  }
  return prices;
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

// --- Home page: "today's closest calls" + activity summary ---

/** Strike is in USDC base units (6dp); a spot close is plain dollars. */
const STRIKE_SCALE = 1_000_000;

/**
 * The open strike nearest a spot price — the genuine coin-flip for that stock, and the most
 * engaging single bet to feature ("could go either way today"). Returns null when the ticker
 * has no open strike or no spot to anchor on. Ties (spot exactly between two strikes) resolve
 * to the lower strike, which reads as the slightly-more-likely "Yes".
 */
export function nearestTheMoneyRow(
  view: TickerView,
  spot: number | null
): StrikeRow | null {
  if (spot == null) return null;
  const open = view.rows.filter((r) => r.state === "open");
  if (open.length === 0) return null;
  let best = open[0];
  let bestDist = Infinity;
  for (const r of open) {
    const dist = Math.abs(r.strike.toNumber() / STRIKE_SCALE - spot);
    if (dist < bestDist) {
      bestDist = dist;
      best = r;
    }
  }
  return best;
}

/** One featured bet on the home page: a concrete, nearest-the-money question + its market. */
export interface FeaturedCall {
  ticker: Ticker;
  symbol: string;
  /** Strike in USDC base units (6dp). */
  strike: BN;
  /** Live Yes price (integer price scale) for the featured strike. */
  yesPrice: BN;
  /** Last close (dollars) and day-over-day change, for context on the card. */
  spot: number;
  changePct: number | null;
  /** Open interest for the whole ticker (USDC base units). */
  openInterest: BN;
  /** Settlement instant (unix seconds, BN) for the per-card countdown. */
  tradingDay: BN | null;
}

/** Distance of a Yes price from a true 50/50 (PRICE_SCALE/2), as an integer. */
function distanceFromCoinFlip(yesPrice: BN): number {
  return Math.abs(yesPrice.sub(PRICE_SCALE.divn(2)).toNumber());
}

/**
 * The home page's "today's closest calls": for each ticker that has an open market and a spot,
 * feature its nearest-the-money strike, then take the `count` whose Yes price is closest to a
 * coin flip (the most interesting bets). Ties broken by open interest (the more active bet
 * wins). Returns fewer than `count` when the board is sparse — the caller renders what's there.
 *
 * `spots` maps a ticker ordinal to its last close (dollars); pass `usePriceHistory` results.
 */
export function featuredCalls(
  views: TickerView[],
  spots: Partial<Record<Ticker, { close: number; changePct: number | null }>>,
  count = 3
): FeaturedCall[] {
  const calls: FeaturedCall[] = [];
  for (const view of views) {
    const spot = spots[view.ticker] ?? null;
    const row = nearestTheMoneyRow(view, spot?.close ?? null);
    if (!row || !spot) continue;
    calls.push({
      ticker: view.ticker,
      symbol: view.symbol,
      strike: row.strike,
      yesPrice: row.yesPrice,
      spot: spot.close,
      changePct: spot.changePct,
      openInterest: view.totalCollateral,
      tradingDay: view.tradingDay,
    });
  }
  calls.sort(
    (a, b) =>
      distanceFromCoinFlip(a.yesPrice) - distanceFromCoinFlip(b.yesPrice) ||
      b.openInterest.cmp(a.openInterest)
  );
  return calls.slice(0, count);
}

/** Board-wide activity totals for the home page's live stats bar. */
export interface ActivitySummary {
  /** Σ open interest across all tickers (USDC base units). */
  openInterest: BN;
  /** Count of open markets (strike levels) across the whole board. */
  openMarkets: number;
  /** Number of stocks with at least one open market today. */
  stockCount: number;
  /** A representative settlement instant for the board countdown (unix seconds, BN) or null. */
  tradingDay: BN | null;
}

/** Roll the per-ticker views up into the board-wide activity summary. */
export function activitySummary(views: TickerView[]): ActivitySummary {
  let openInterest = new BN(0);
  let openMarkets = 0;
  let stockCount = 0;
  let tradingDay: BN | null = null;
  for (const view of views) {
    openInterest = openInterest.add(view.totalCollateral);
    openMarkets += view.activeCount;
    if (view.activeCount > 0) {
      stockCount += 1;
      // All of today's markets share the same 4:00 PM close, so any open ticker's works.
      if (!tradingDay && view.tradingDay) tradingDay = view.tradingDay;
    }
  }
  return { openInterest, openMarkets, stockCount, tradingDay };
}
