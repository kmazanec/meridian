import BN from "bn.js";
import {
  Outcome,
  OrderSide,
  PRICE_SCALE,
  type OrderBookAccount,
} from "@meridian/sdk";
import { settledPayout, markValue } from "./market-math";
import type { DiscoveredMarket } from "./discovery";
import type { BookMap } from "./marketStats";

/**
 * Market-wide trader leaderboard — pure accounting (no RPC, no React).
 *
 * Ranks every discovered trader by **current net worth**, not PnL: an arbitrary on-chain
 * wallet's starting capital is unknown, so "PnL vs start" can't be computed honestly. Net
 * worth is the sum of three things a wallet controls:
 *   1. wallet USDC (free cash),
 *   2. outcome-token value (settled → 1:1 winning-side payout; open → mark-to-market),
 *   3. collateral escrowed in resting orders (place_order moves it OUT of the wallet, so it
 *      must be credited back or a trader with open orders looks poorer than it is — the same
 *      correction scripts/bot-results.mjs makes for the demo bots).
 *
 * The page fetches the inputs (holdings, USDC balances, books) and this folds them into
 * ranked rows, so the math is unit-tested directly — mirrors portfolio.ts / market-math.ts.
 *
 * NOTE: the escrow/payout math here is duplicated with scripts/bot-results.mjs (Node/ops vs.
 * browser/TS). A shared @meridian/sdk helper is a future extraction, deliberately not in scope.
 */

/** A wallet's holding in one market, discovered via top-N token holders. */
export interface MarketHolding {
  market: string; // base58 market address
  side: "yes" | "no";
  /** Token base units held (6dp). */
  amount: BN;
}

/** One trader's position line in a row (for the drilldown / row detail). */
export interface LeaderboardPosition {
  market: string;
  side: "yes" | "no";
  amount: BN;
  /** USDC value credited for this holding (0 if unpriceable). */
  value: BN;
  /** True when an open market has no derivable mark — value omitted, not guessed. */
  unpriceable: boolean;
}

export interface LeaderboardRow {
  owner: string; // base58
  usdc: BN;
  tokenValue: BN;
  escrowValue: BN;
  net: BN;
  openOrders: number;
  positions: LeaderboardPosition[];
  /** Count of holdings on open markets we couldn't mark (excluded from net). */
  unpriceableCount: number;
}

export interface LeaderboardInputs {
  markets: DiscoveredMarket[];
  books: BookMap;
  /** owner base58 -> wallet USDC balance (base units). */
  ownerUsdc: Map<string, BN>;
  /** Every discovered outcome-token holding, keyed by owner base58. */
  holdingsByOwner: Map<string, MarketHolding[]>;
  /**
   * Yes-mark per market (price scale, 0..PRICE_SCALE) for valuing OPEN positions, keyed by
   * market base58. Absent/null → that market's open holdings are unpriceable. (Settled
   * markets ignore this — they use the on-chain outcome.)
   */
  yesMarkByMarket: Map<string, BN | null>;
}

const ZERO = new BN(0);

/** The mark for a side: the Yes mark for yes, its complement (PRICE_SCALE − yes) for no. */
function sideMark(side: "yes" | "no", yesMark: BN): BN {
  return side === "yes" ? yesMark : PRICE_SCALE.sub(yesMark);
}

/**
 * USDC value of a token holding. Settled → winning side pays 1:1 (settledPayout); open →
 * mark-to-market at the side's mark. Returns `null` when an open market has no mark (caller
 * treats as unpriceable, excluded from net — never silently valued).
 */
export function valueOfHolding(
  market: DiscoveredMarket,
  side: "yes" | "no",
  amount: BN,
  yesMark: BN | null
): BN | null {
  if (amount.lten(0)) return ZERO;
  if (market.state === "settled" && market.outcome !== Outcome.Unsettled) {
    return settledPayout(market, side, amount);
  }
  if (yesMark === null) return null; // open, no mark → unpriceable
  return markValue(amount, sideMark(side, yesMark));
}

/**
 * Escrowed collateral for one resting order, valued in USDC base units, plus whether it was
 * unpriceable (an open ask with no mark). Bids escrow USDC = ceil(price*size/PRICE_SCALE);
 * asks escrow `size` Yes tokens, valued like a Yes holding.
 */
function orderEscrowValue(
  order: { side: OrderSide; price: BN; size: BN },
  market: DiscoveredMarket,
  yesMark: BN | null
): { value: BN; unpriceable: boolean } {
  if (order.side === OrderSide.Bid) {
    // ceil(price * size / PRICE_SCALE)
    const numer = order.price.mul(order.size);
    const value = numer.add(PRICE_SCALE.subn(1)).div(PRICE_SCALE);
    return { value, unpriceable: false };
  }
  // Ask: escrowed Yes tokens worth their Yes-side value.
  const v = valueOfHolding(market, "yes", order.size, yesMark);
  return v === null ? { value: ZERO, unpriceable: true } : { value: v, unpriceable: false };
}

/**
 * Fold all inputs into ranked leaderboard rows (highest net worth first). Owners appearing in
 * multiple markets fold into one row.
 */
export function foldLeaderboard(inputs: LeaderboardInputs): LeaderboardRow[] {
  const { markets, books, ownerUsdc, holdingsByOwner, yesMarkByMarket } = inputs;
  const marketByAddr = new Map(markets.map((m) => [m.address.toBase58(), m]));

  // owner -> accumulating row
  const rows = new Map<string, LeaderboardRow>();
  const rowFor = (owner: string): LeaderboardRow => {
    let r = rows.get(owner);
    if (!r) {
      r = {
        owner,
        usdc: ownerUsdc.get(owner) ?? ZERO,
        tokenValue: ZERO,
        escrowValue: ZERO,
        net: ZERO,
        openOrders: 0,
        positions: [],
        unpriceableCount: 0,
      };
      rows.set(owner, r);
    }
    return r;
  };

  // Seed rows for every owner with USDC (so a pure-cash wallet still appears).
  for (const owner of ownerUsdc.keys()) rowFor(owner);

  // Token holdings.
  for (const [owner, holdings] of holdingsByOwner) {
    const r = rowFor(owner);
    for (const h of holdings) {
      const market = marketByAddr.get(h.market);
      if (!market) continue;
      const yesMark = yesMarkByMarket.get(h.market) ?? null;
      const v = valueOfHolding(market, h.side, h.amount, yesMark);
      const unpriceable = v === null;
      if (unpriceable) r.unpriceableCount += 1;
      else r.tokenValue = r.tokenValue.add(v);
      r.positions.push({
        market: h.market,
        side: h.side,
        amount: h.amount,
        value: v ?? ZERO,
        unpriceable,
      });
    }
  }

  // Escrowed collateral in resting orders (credited back to the order owner).
  for (const market of markets) {
    const book = books.get(market.orderBook.toBase58());
    if (!book) continue;
    const yesMark = yesMarkByMarket.get(market.address.toBase58()) ?? null;
    for (const order of [...book.bids, ...book.asks] as OrderBookAccount["bids"]) {
      const owner = order.owner.toBase58();
      const r = rowFor(owner);
      const { value, unpriceable } = orderEscrowValue(order, market, yesMark);
      if (unpriceable) r.unpriceableCount += 1;
      else r.escrowValue = r.escrowValue.add(value);
      r.openOrders += 1;
    }
  }

  for (const r of rows.values()) {
    r.net = r.usdc.add(r.tokenValue).add(r.escrowValue);
  }

  return [...rows.values()].sort((a, b) => b.net.cmp(a.net));
}

// --- Per-market drilldown ---

/** One holder's stake in a single market (for the drilldown). */
export interface MarketHolderRow {
  owner: string;
  side: "yes" | "no";
  amount: BN;
  /** USDC value of this stake (settled payout or mark; 0 if unpriceable). */
  value: BN;
  unpriceable: boolean;
}

export interface MarketDrilldownView {
  /** Holders ranked by stake value, then size. */
  holders: MarketHolderRow[];
  /** Book depth (best bid/ask in yes-perspective price scale; null if a side is empty). */
  bestBid: BN | null;
  bestAsk: BN | null;
  /** Total resting token size across both sides. */
  restingSize: BN;
}

/**
 * Fold one market's holders + book into a drilldown view. Holders come from top-N discovery;
 * book stats are passed in (derived from the cached BookMap, no extra RPC). Pure.
 */
export function foldMarketDrilldown(
  market: DiscoveredMarket,
  holders: { owner: PublicKeyLike; side: "yes" | "no"; amount: BN }[],
  yesMark: BN | null,
  book: { bestBid: BN | null; bestAsk: BN | null; restingSize: BN }
): MarketDrilldownView {
  const rows: MarketHolderRow[] = [];
  for (const h of holders) {
    if (h.amount.lten(0)) continue;
    const v = valueOfHolding(market, h.side, h.amount, yesMark);
    rows.push({
      owner: typeof h.owner === "string" ? h.owner : h.owner.toBase58(),
      side: h.side,
      amount: h.amount,
      value: v ?? ZERO,
      unpriceable: v === null,
    });
  }
  rows.sort((a, b) => b.value.cmp(a.value) || b.amount.cmp(a.amount));
  return {
    holders: rows,
    bestBid: book.bestBid,
    bestAsk: book.bestAsk,
    restingSize: book.restingSize,
  };
}

/** Minimal shape for an owner key — a base58 string or anything with toBase58(). */
type PublicKeyLike = string | { toBase58: () => string };
