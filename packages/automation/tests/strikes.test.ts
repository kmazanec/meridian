/**
 * Strike-algorithm tests. The algorithm (ARCHITECTURE §9 / Daily Lifecycle):
 *   - take the previous close,
 *   - offset by ±3/6/9%,
 *   - round each to the nearest $10,
 *   - optionally include the rounded close itself,
 *   - deduplicate.
 * Output strikes are integers in USDC base units (6 dp) — the on-chain `Market.strike`
 * scale — so the values line up with `settlement_price` for the >= comparison, with no
 * floats anywhere in the serialized result.
 */

import { expect } from "chai";
import BN from "bn.js";
import { PAYOFF_UNIT } from "@meridian/sdk";
import {
  computeStrikes,
  dollarsToStrikeUnits,
  STRIKE_OFFSET_BPS,
} from "../src/strikes";

/** $X.00 in USDC base units (6 dp). */
function usd(dollars: number): BN {
  return new BN(dollars).mul(PAYOFF_UNIT);
}

describe("computeStrikes", () => {
  it("produces the META $680 example: ±3/6/9% rounded to $10", () => {
    // 680 ± {3,6,9}% = {618.8, 639.2, 659.6} and {700.4, 720.8, 741.2}
    // rounded to nearest $10 → 620, 640, 660, 700, 720, 740.
    const strikes = computeStrikes(usd(680), { includeClose: false });
    const dollars = strikes.map((s) => s.div(PAYOFF_UNIT).toNumber());
    expect(dollars).to.deep.equal([620, 640, 660, 700, 720, 740]);
  });

  it("optionally includes the rounded close, sorted and deduped", () => {
    const strikes = computeStrikes(usd(680), { includeClose: true });
    const dollars = strikes.map((s) => s.div(PAYOFF_UNIT).toNumber());
    // close 680 rounds to 680, inserted in order between the down/up legs.
    expect(dollars).to.deep.equal([620, 640, 660, 680, 700, 720, 740]);
  });

  it("collapses an AAPL-style low price to fewer unique strikes", () => {
    // $30 ± {3,6,9}% = {27.3, 28.2, 29.1} / {30.9, 31.8, 32.7}.
    // Rounded to $10 the down-legs all become 30 and up-legs all become 30 too →
    // every offset collapses to 30. With includeClose 30 is also 30 → a single strike.
    const strikes = computeStrikes(usd(30), { includeClose: true });
    const dollars = strikes.map((s) => s.div(PAYOFF_UNIT).toNumber());
    expect(dollars).to.deep.equal([30]);
  });

  it("returns ascending, unique, positive strikes", () => {
    const strikes = computeStrikes(usd(214), { includeClose: true });
    const nums = strikes.map((s) => s.toString());
    // strictly ascending
    for (let i = 1; i < strikes.length; i++) {
      expect(strikes[i].gt(strikes[i - 1]), `strike[${i}] > strike[${i - 1}]`)
        .to.be.true;
    }
    // unique
    expect(new Set(nums).size).to.equal(nums.length);
    // positive
    for (const s of strikes) expect(s.gtn(0)).to.be.true;
  });

  it("never emits a non-positive strike for a tiny price", () => {
    // A price so small that a -9% rounded-to-$10 leg would be 0 must be dropped, not
    // emitted as a 0 strike (a $0 strike is meaningless and the program forbids it).
    const strikes = computeStrikes(usd(4), { includeClose: true });
    for (const s of strikes)
      expect(s.gtn(0), "no zero/negative strike").to.be.true;
  });

  it("rejects a non-positive previous close", () => {
    expect(() => computeStrikes(new BN(0), { includeClose: true })).to.throw();
    expect(() => computeStrikes(usd(-5), { includeClose: true })).to.throw();
  });

  it("exposes the offset basis points it uses (±3/6/9%)", () => {
    expect(STRIKE_OFFSET_BPS).to.deep.equal([300, 600, 900]);
  });

  it("rounds to the nearest $10 with .5 rounding up at the $5 midpoint", () => {
    // 615 → nearest $10 is 620 (615 is the midpoint, rounds up).
    expect(dollarsToStrikeUnits(615).eq(usd(620))).to.be.true;
    // 614.99 → 610
    expect(dollarsToStrikeUnits(614.99).eq(usd(610))).to.be.true;
  });

  it("does no floating-point on the serialized strike values", () => {
    // Output is BN base units; assert the values are exact $10 multiples in base units.
    const strikes = computeStrikes(usd(680), { includeClose: true });
    const tenDollars = new BN(10).mul(PAYOFF_UNIT);
    for (const s of strikes) {
      expect(s.mod(tenDollars).isZero(), `${s} is a $10 multiple`).to.be.true;
    }
  });
});
