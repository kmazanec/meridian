/**
 * Strike computation for the morning job.
 *
 * From a stock's previous close, the service derives the day's strikes:
 *   - offset the close by ±3/6/9%,
 *   - round each offset to the nearest $10,
 *   - optionally include the close itself (rounded),
 *   - deduplicate and sort ascending.
 *
 * Everything is integer math on USDC base units (6 dp) — the on-chain `Market.strike`
 * scale (constants.rs `USDC_DECIMALS`). No floats appear in any serialized strike value,
 * per the units contract (ROADMAP concern #2). The only `number` use is the `$10`
 * rounding granularity and the percentage basis points, both applied via integer
 * arithmetic on BNs.
 */

import BN from "bn.js";
import { PAYOFF_UNIT } from "@meridian/sdk";

/** The strike offsets from the previous close, in basis points: ±3%, ±6%, ±9%. */
export const STRIKE_OFFSET_BPS: readonly number[] = [300, 600, 900];

/** Rounding granularity for strikes: $10. */
export const STRIKE_ROUND_DOLLARS = 10;

const BPS_DENOMINATOR = new BN(10_000);
/** $10 expressed in USDC base units — the rounding step. */
const ROUND_STEP = new BN(STRIKE_ROUND_DOLLARS).mul(PAYOFF_UNIT);
const TWO = new BN(2);

export interface ComputeStrikesOptions {
  /** Also emit the (rounded) previous close as an at-the-money strike. Default false. */
  includeClose?: boolean;
}

/**
 * Compute the day's strikes for a previous close expressed in USDC base units (6 dp).
 *
 * Returns ascending, unique, strictly-positive strikes (any leg that rounds to $0 — only
 * possible for a near-zero price — is dropped, since a $0 strike is meaningless and the
 * program forbids settling against it). Throws if `prevClose` is not positive.
 */
export function computeStrikes(
  prevClose: BN,
  opts: ComputeStrikesOptions = {}
): BN[] {
  if (prevClose.lten(0)) {
    throw new Error(
      `previous close must be positive (got ${prevClose.toString()})`
    );
  }

  const raw: BN[] = [];
  for (const bps of STRIKE_OFFSET_BPS) {
    const delta = prevClose.mul(new BN(bps)).div(BPS_DENOMINATOR);
    raw.push(roundToStep(prevClose.sub(delta))); // down leg
    raw.push(roundToStep(prevClose.add(delta))); // up leg
  }
  if (opts.includeClose) {
    raw.push(roundToStep(prevClose));
  }

  // Drop non-positive, dedupe, sort ascending.
  const seen = new Set<string>();
  const out: BN[] = [];
  for (const s of raw) {
    if (s.lten(0)) continue;
    const key = s.toString();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  out.sort((a, b) => a.cmp(b));
  return out;
}

/**
 * Round a base-units value to the nearest $10 (in base units), with the $5 midpoint
 * rounding up. Pure integer arithmetic: `round(v / step) * step` computed as
 * `((v + step/2) / step) * step` with truncating BN division.
 */
export function roundToStep(valueBaseUnits: BN): BN {
  const half = ROUND_STEP.div(TWO);
  return valueBaseUnits.add(half).div(ROUND_STEP).mul(ROUND_STEP);
}

/**
 * Convert a dollar amount to USDC base units (6 dp), rounded to the nearest $10.
 *
 * Accepts a plain dollar `number` (e.g. a price read from an off-chain source) and
 * snaps it to the strike grid. The cents are carried through as integer base units
 * before rounding so a value like `614.99` rounds correctly without float error in the
 * *result* (the input is the only float, and it is immediately quantized to base units).
 */
export function dollarsToBaseUnits(dollars: number): BN {
  if (!Number.isFinite(dollars)) {
    throw new Error(`dollars must be a finite number (got ${dollars})`);
  }
  // Quantize to 6-dp base units first (Math.round on the smallest unit), then snap to $10.
  const baseUnits = new BN(Math.round(dollars * Number(PAYOFF_UNIT.toString())));
  return roundToStep(baseUnits);
}
