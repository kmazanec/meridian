import BN from "bn.js";
import {
  dualBook,
  Outcome,
  PRICE_SCALE,
  tickerToSymbol,
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

/**
 * The Yes mark for valuing OPEN positions: the book mid, or null when a side is empty.
 * Unlike {@link strikeRow}'s `yesPrice` (which falls back to 50/50 for display), this returns
 * null so callers can treat an unmarkable position as *unpriceable* rather than guessing.
 */
export function yesMarkFor(
  market: DiscoveredMarket,
  books: BookMap
): BN | null {
  return midPrice(yesView(market, books));
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
  /** Day's opening price; omitted if the feed didn't report a finite value. */
  open?: number;
}

/**
 * Everything one ticker needs for the Markets board (and the trade-page header), derived once
 * upstream so the components stay presentational (no hooks, no RPC, no BN math beyond
 * formatting). {@link buildBoardRow} joins this with a live price into a {@link MarketsBoardRow}.
 */
export interface TickerView {
  ticker: Ticker;
  symbol: string;
  /** The representative open market's settlement instant, for the countdown (or null). */
  tradingDay: BN | null;
  activeCount: number;
  /** Representative Yes price for the collapsed summary (or null with no open markets). */
  repYesPrice: BN | null;
  /**
   * The representative open market's strike in *dollars* (or null with no open markets) —
   * the strike `repYesPrice` is quoted on. Used to deep-link the card straight to that
   * strike's trade page (`?strike=<dollars>`), so clicking a card opens the same bet it shows.
   */
  repStrikeDollars: number | null;
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
    repStrikeDollars: rep ? rep.strike.toNumber() / STRIKE_SCALE : null,
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

// --- Home page: "recent wins" — the settled-market results feed ---

/**
 * One settled market's result, as the home page's "recent wins" feed shows it: the question
 * that was decided, the price it settled at, which side won, and how much collateral was at
 * stake. Pure view-model — derived from already-discovered markets, no extra RPC.
 */
export interface RecentWin {
  /** The settled market's address (stable React key + deep link). */
  address: string;
  symbol: string;
  /** Strike the question was set at (USDC base units, 6dp). */
  strike: BN;
  /** The official closing price the market settled to (USDC base units), or null if absent. */
  settlementPrice: BN | null;
  /** Which side paid out. Always Yes/No here (Unsettled markets are filtered out). */
  outcome: Outcome;
  /** Collateral that was locked = $ paid out to the winning side (USDC base units). */
  payout: BN;
  /** Settlement instant (unix seconds, BN) — the day this was decided, for ordering/labels. */
  tradingDay: BN;
}

/**
 * The home page's "recent wins": every settled market, newest day first, as a results feed —
 * "NVDA closed $1,182, Yes won". Reuses the same discovered markets as the rest of the page
 * (the `useMarkets` poll already returns settled markets, which persist on-chain), so this
 * costs **no** extra RPC. Markets with no minted pairs (nothing was ever at stake) are dropped
 * — they're not a "win" anyone cared about. Ties on the same day break to the bigger payout.
 *
 * Returns up to `count` results; fewer when the board has settled less than that.
 */
export function recentWins(
  markets: DiscoveredMarket[],
  count = 6
): RecentWin[] {
  const wins: RecentWin[] = [];
  for (const m of markets) {
    if (m.state !== "settled") continue;
    if (m.outcome === Outcome.Unsettled) continue;
    if (m.pairsMinted.isZero()) continue;
    wins.push({
      address: m.address.toBase58(),
      symbol: tickerToSymbol(m.ticker),
      strike: m.strike,
      settlementPrice: m.settlementPrice,
      outcome: m.outcome,
      payout: m.pairsMinted,
      tradingDay: m.tradingDay,
    });
  }
  wins.sort((a, b) => b.tradingDay.cmp(a.tradingDay) || b.payout.cmp(a.payout));
  return wins.slice(0, count);
}

// --- Markets board: one sortable row per stock, with the live price joined in ---

/**
 * One stock's row on the Markets board. Combines the ticker's derived view with its *live*
 * underlying price (from `/api/price`) so the board leads with real-time signals rather than
 * the prior session's close. The featured bet is the nearest-the-money open strike — the
 * genuine coin-flip — carried whole so the row can deep-link and the expander can highlight it.
 */
export interface MarketsBoardRow {
  ticker: Ticker;
  symbol: string;
  /**
   * The price to show in the PRICE column, in dollars, or null if unknown. Open stocks: the
   * live underlying price. Closed stocks: the price it settled (closed) at — so a closed row
   * shows a real number, never a dash.
   */
  displayPrice: number | null;
  /**
   * The move to show in the TODAY column (0.012 = +1.2%), or null. Open: % from today's open.
   * Closed: the settled day's open→close move (from history), so the column isn't blank.
   */
  changePct: number | null;
  /** Live underlying price in dollars, or null when no live quote is available. */
  livePrice: number | null;
  /** Fractional move from today's open (0.012 = +1.2%), or null. */
  pctFromOpen: number | null;
  /** True when the stock has at least one open (tradable) strike today. */
  open: boolean;
  /** The nearest-the-money open strike (the featured bet), or null when none is open. */
  atmRow: StrikeRow | null;
  /** Σ resting size across the ticker's books (token base units) — the liquidity signal. */
  liquidity: BN;
  /** Settlement instant (unix seconds, BN) for the countdown, or null. */
  tradingDay: BN | null;
  /** The day's settlement (close) price once settled, in USDC base units, or null. */
  settlementPrice: BN | null;
  /** The settled outcome (Yes/No won) when closed. */
  outcome: Outcome;
  /** Every strike row (strike-ascending) for the inline expander. */
  rows: StrikeRow[];
  /** Recent closes for the row sparkline (null until loaded). */
  history: ClosePoint[] | null;
}

/** Build a board row from a ticker view + its live price (dollars) and move-from-open. */
export function buildBoardRow(
  view: TickerView,
  live: { price: number | null; pctFromOpen: number | null }
): MarketsBoardRow {
  const open = view.activeCount > 0;
  const atmRow = nearestTheMoneyRow(view, live.price);
  // A settled ticker shares one outcome/close across its strikes — read it off any settled row.
  const settledRow = view.rows.find((r) => r.state === "settled");
  const settlementPrice = settledRow?.settlementPrice ?? null;

  // The PRICE / TODAY columns read the same whether open or closed: open stocks use the live
  // quote; closed stocks use the price they settled at and the settled day's open→close move
  // (from the latest history point) — so a closed row never shows a bare dash.
  const settledClose = settlementPrice
    ? settlementPrice.toNumber() / STRIKE_SCALE
    : null;
  const lastDay = view.history?.[view.history.length - 1] ?? null;
  const settledChange =
    settledClose != null && lastDay?.open != null && lastDay.open !== 0
      ? settledClose / lastDay.open - 1
      : null;

  return {
    ticker: view.ticker,
    symbol: view.symbol,
    displayPrice: open ? live.price : settledClose,
    changePct: open ? live.pctFromOpen : settledChange,
    livePrice: live.price,
    pctFromOpen: live.pctFromOpen,
    open,
    atmRow,
    liquidity: view.totalRestingSize,
    tradingDay: view.tradingDay,
    settlementPrice,
    outcome: settledRow?.outcome ?? Outcome.Unsettled,
    rows: view.rows,
    history: view.history,
  };
}

/** Columns the board can sort by. */
export type BoardSort = "action" | "mover" | "price" | "symbol";

/** How close the featured bet is to a coin flip (0 = exactly 50/50; larger = more decided). */
function atmCoinFlipDistance(row: MarketsBoardRow): number {
  if (!row.atmRow) return Number.POSITIVE_INFINITY;
  return Math.abs(row.atmRow.yesPrice.sub(PRICE_SCALE.divn(2)).toNumber());
}

/**
 * Sort board rows for the chosen key. Open stocks always rank above closed ones (you can only
 * trade what's open), then the key orders within each group:
 *  - `action`  : nearest a coin-flip first, ties broken by deeper liquidity — "where the action is".
 *  - `mover`   : biggest absolute move from open first.
 *  - `price`   : highest live price first.
 *  - `symbol`  : A→Z.
 * Returns a new array; the input is not mutated.
 */
export function sortBoardRows(
  rows: MarketsBoardRow[],
  key: BoardSort
): MarketsBoardRow[] {
  const within = (a: MarketsBoardRow, b: MarketsBoardRow): number => {
    switch (key) {
      case "action":
        return (
          atmCoinFlipDistance(a) - atmCoinFlipDistance(b) ||
          b.liquidity.cmp(a.liquidity)
        );
      case "mover":
        return Math.abs(b.pctFromOpen ?? 0) - Math.abs(a.pctFromOpen ?? 0);
      case "price":
        return (b.livePrice ?? 0) - (a.livePrice ?? 0);
      case "symbol":
        return a.symbol.localeCompare(b.symbol);
    }
  };
  return [...rows].sort(
    (a, b) => Number(b.open) - Number(a.open) || within(a, b)
  );
}
