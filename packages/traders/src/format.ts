/**
 * Unit conversions between the chain's integer base units and the human-facing decimals
 * the LLM reasons in.
 *
 * The program uses 6-decimal base units throughout (ARCHITECTURE / SDK constants):
 *   - USDC and the Yes/No tokens are 6dp, so 1.0 token / $1.00 = 1_000_000 base units.
 *   - Order *prices* are in `[0, PRICE_SCALE]` where PRICE_SCALE = 1_000_000 maps to
 *     $1.00 per Yes token — i.e. the price IS the market-implied probability in [0, 1].
 *
 * We deliberately speak dollars and probabilities to the model (it reasons far better
 * about "$0.62" and "65% implied" than "620000 base units"), and convert at the boundary.
 */

import BN from "bn.js";
import { PRICE_SCALE, PAYOFF_UNIT } from "@meridian/sdk";

/** 6dp base-unit scale shared by tokens, USDC, and prices. */
const SCALE = 1_000_000;

/** Token/USDC base units → a human decimal number (e.g. 1_500_000 → 1.5). */
export function unitsToAmount(units: BN | number | string): number {
  const bn = BN.isBN(units) ? units : new BN(units);
  return bn.toNumber() / SCALE;
}

/**
 * A human token/USDC amount → integer base units (BN), rounded to the nearest unit.
 * Throws on a negative amount.
 */
export function amountToUnits(amount: number): BN {
  if (amount < 0) throw new Error(`Amount must be non-negative: ${amount}`);
  return new BN(Math.round(amount * SCALE));
}

/** A price in `[0, PRICE_SCALE]` → a probability/dollar value in [0, 1] (e.g. 620000 → 0.62). */
export function priceToProb(price: BN | number | string): number {
  const bn = BN.isBN(price) ? price : new BN(price);
  return bn.toNumber() / PRICE_SCALE.toNumber();
}

/**
 * A probability/dollar value in [0, 1] → an integer order price in `[0, PRICE_SCALE]`.
 * Clamps to the valid range and rounds, so the model can't produce an out-of-range price.
 */
export function probToPrice(prob: number): BN {
  const clamped = Math.max(0, Math.min(1, prob));
  return new BN(Math.round(clamped * PRICE_SCALE.toNumber()));
}

/** Round a number to `n` decimal places for tidy log/JSON output. */
export function round(n: number, places = 4): number {
  const f = 10 ** places;
  return Math.round(n * f) / f;
}

export { PAYOFF_UNIT };
