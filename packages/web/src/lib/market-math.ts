import BN from "bn.js";
import {
  PRICE_SCALE,
  Outcome,
  complementPrice,
  type BookView,
  type MarketAccount,
  type UserPosition,
} from "@meridian/sdk";

/**
 * Pure market math: deriving a displayable "price" from a book, and position P&L.
 * Integer base units throughout (no floats) — formatting to dollars happens in
 * `format.ts`. These are unit-tested directly with hand-built book/market shapes.
 */

/** The mid price of a book view, or null if a side is empty. Integer, in price scale. */
export function midPrice(view: BookView): BN | null {
  const bestBid = view.bids[0]?.price ?? null;
  const bestAsk = view.asks[0]?.price ?? null;
  if (bestBid && bestAsk) {
    return bestBid.add(bestAsk).divn(2);
  }
  return null;
}

/**
 * A single "live price" for a book view, used on Landing/Markets/Trade. Prefers the
 * mid; falls back to the best bid or best ask alone; and, when the book is entirely
 * empty, to the strike-implied 50/50 (`PRICE_SCALE / 2`) so the UI always shows a
 * sensible probability rather than a blank.
 */
export function priceFromBook(view: BookView): BN {
  const mid = midPrice(view);
  if (mid) return mid;
  const bestBid = view.bids[0]?.price;
  const bestAsk = view.asks[0]?.price;
  if (bestBid) return bestBid;
  if (bestAsk) return bestAsk;
  return PRICE_SCALE.divn(2);
}

/** The complement of a price within the scale: the No price for a Yes price. */
export function impliedComplement(price: BN): BN {
  return complementPrice(price);
}

/**
 * Mark-to-market value of a holding of `tokens` (6dp) of one side, at `markPrice`
 * (integer price scale). Value = tokens × markPrice / PRICE_SCALE, in USDC base units.
 * (A token worth $1.00 at settlement is worth `markPrice` of a dollar while trading.)
 */
export function markValue(tokens: BN, markPrice: BN): BN {
  return tokens.mul(markPrice).div(PRICE_SCALE);
}

export interface PositionPnl {
  /** Current mark-to-market value of the holding in USDC base units. */
  value: BN;
  /** Cost basis in USDC base units (entry price × size). */
  cost: BN;
  /** value − cost, signed. */
  pnl: BN;
}

/**
 * P&L for one side of a position given an entry price and the current mark.
 * `entryPrice`/`markPrice` are integer price-scale; `tokens` is 6dp base units.
 */
export function positionPnl(
  tokens: BN,
  entryPrice: BN,
  markPrice: BN
): PositionPnl {
  const value = markValue(tokens, markPrice);
  const cost = markValue(tokens, entryPrice);
  return { value, cost, pnl: value.sub(cost) };
}

/**
 * Settled payout for a holding: the winning side's tokens redeem 1:1 for USDC base
 * units (a winning token = `PRICE_SCALE` = $1.00), the losing side pays $0. Mirrors
 * the SDK's `payoutFor` but operates on already-fetched amounts for both sides.
 */
export function settledPayout(
  market: Pick<MarketAccount, "outcome">,
  side: "yes" | "no",
  tokens: BN
): BN {
  const wins =
    (side === "yes" && market.outcome === Outcome.YesWins) ||
    (side === "no" && market.outcome === Outcome.NoWins);
  return wins ? tokens.clone() : new BN(0);
}

/** Whether a user holds *both* Yes and No for a strike (the constraint guardrail). */
export function holdsBothSides(pos: UserPosition): boolean {
  return pos.yes.gtn(0) && pos.no.gtn(0);
}
