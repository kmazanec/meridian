import BN from "bn.js";
import { PublicKey } from "@solana/web3.js";
import {
  OrderSide,
  PAYOFF_UNIT,
  PRICE_SCALE,
  TradeAction,
  MAX_BUY_NO_MINT_PAIRS,
} from "@meridian/sdk";

/**
 * Trade-panel form helpers. The panel collects an action + a price (in the action's own
 * perspective: Yes price for Yes actions, No price for No actions) + a size, and must:
 *  (a) compute the *Yes-book* side and price the action reduces to, so it can find the
 *      maker accounts to cross (the intent layer is book-agnostic), and
 *  (b) validate the inputs the way the program/SDK will, to fail fast with clear text.
 *
 * The actual instruction assembly stays in the SDK's `buildTradeIntent` — this never
 * re-implements the four-button mapping, it only mirrors *which Yes side/price* an
 * action lands on so the caller can compute crossings.
 */

/** The Yes-book side an action rests/crosses on. (Buy Yes / Sell No → bid; others → ask.) */
export function yesSideFor(action: TradeAction): OrderSide {
  switch (action) {
    case TradeAction.BuyYes:
    case TradeAction.SellNo:
      return OrderSide.Bid;
    case TradeAction.SellYes:
    case TradeAction.BuyNo:
      return OrderSide.Ask;
  }
}

/** True for the No-side actions, whose price is given as a No price and reflected. */
export function isNoAction(action: TradeAction): boolean {
  return action === TradeAction.BuyNo || action === TradeAction.SellNo;
}

/** The Yes price an action lands on: the No price reflected for No actions. */
export function yesPriceFor(action: TradeAction, price: BN): BN {
  return isNoAction(action) ? PRICE_SCALE.sub(price) : price;
}

export interface ValidationResult {
  ok: boolean;
  error?: string;
}

/**
 * Validate a trade form before building. Mirrors the SDK/program preconditions so the
 * user sees the problem immediately rather than after a round-trip:
 *  - size > 0;
 *  - a limit price (in the action's own perspective) within `[1, PRICE_SCALE]`;
 *  - BUY_NO size a whole-token multiple of `PAYOFF_UNIT`, capped at the per-tx mint limit.
 */
export function validateTradeForm(opts: {
  action: TradeAction;
  price: BN;
  size: BN;
  isMarket: boolean;
}): ValidationResult {
  const { action, price, size, isMarket } = opts;

  if (size.lten(0))
    return { ok: false, error: "Size must be greater than zero." };

  if (!isMarket) {
    if (price.lten(0) || price.gt(PRICE_SCALE)) {
      return {
        ok: false,
        error: `Price must be between $0.01 and $1.00.`,
      };
    }
  }

  if (action === TradeAction.BuyNo) {
    if (!size.mod(PAYOFF_UNIT).isZero()) {
      return {
        ok: false,
        error: "Buy No size must be a whole number of tokens.",
      };
    }
    const pairs = size.div(PAYOFF_UNIT).toNumber();
    if (pairs > MAX_BUY_NO_MINT_PAIRS) {
      return {
        ok: false,
        error: `Buy No is capped at ${MAX_BUY_NO_MINT_PAIRS} tokens per transaction; split it up.`,
      };
    }
  }

  return { ok: true };
}

/** Parse a decimal dollar string (e.g. "0.65") into integer price-scale base units. */
export function parsePrice(input: string): BN | null {
  // `Number("")` and `Number("  ")` are 0, not NaN — reject blank input explicitly so
  // an empty field doesn't silently parse to a $0.00 price.
  if (input.trim() === "") return null;
  const n = Number(input);
  if (!Number.isFinite(n) || n < 0) return null;
  return new BN(Math.round(n * PRICE_SCALE.toNumber()));
}

/** Parse a decimal token-count string (e.g. "1.5") into 6dp base units. */
export function parseSize(input: string): BN | null {
  if (input.trim() === "") return null;
  const n = Number(input);
  if (!Number.isFinite(n) || n <= 0) return null;
  return new BN(Math.round(n * PAYOFF_UNIT.toNumber()));
}
