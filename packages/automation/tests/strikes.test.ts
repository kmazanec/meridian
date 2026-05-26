/**
 * Strike-algorithm tests. The algorithm (ARCHITECTURE §9 / Daily Lifecycle):
 *   - take the previous close,
 *   - offset by ±3/6/9%,
 *   - round each to the nearest $10,
 *   - always include the rounded close itself (the at-the-money strike),
 *   - deduplicate.
 * Output strikes are integers in USDC base units (6 dp) — the on-chain `Market.strike`
 * scale — so the values line up with `settlement_price` for the >= comparison, with no
 * floats anywhere in the serialized result. The at-the-money strike is mandatory, not a
 * toggle: it keeps the ladder centered when the rounded close doesn't fall on a ±% leg.
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

/** computeStrikes → plain dollar numbers, for readable assertions. */
function strikesInDollars(prevCloseDollars: number): number[] {
  return computeStrikes(usd(prevCloseDollars)).map((s) =>
    s.div(PAYOFF_UNIT).toNumber()
  );
}

describe("computeStrikes", () => {
  it("produces the META $680 example: ±3/6/9% + the rounded close", () => {
    // 680 ± {3,6,9}% = {618.8, 639.2, 659.6} and {700.4, 720.8, 741.2} round to
    // 620, 640, 660, 700, 720, 740; the close (680) sits in the middle.
    expect(strikesInDollars(680)).to.deep.equal([
      620, 640, 660, 680, 700, 720, 740,
    ]);
  });

  it("includes an at-the-money strike that is NOT one of the ±% legs (AAPL $308)", () => {
    // The case that motivated making the close mandatory. AAPL prev close $308:
    //   -3% = 298.76 → 300, -6% = 289.52 → 290, -9% = 280.28 → 280
    //   +3% = 317.24 → 320, +6% = 326.48 → 330, +9% = 335.72 → 340
    //   close 308 → 310  (between the 300 and 320 legs — not produced by any offset)
    // Without the close the ladder is an even 6 with a hole at the money; with it, 7 and
    // centered on $310, the nearest $10 to the close.
    expect(strikesInDollars(308)).to.deep.equal([
      280, 290, 300, 310, 320, 330, 340,
    ]);
  });

  it("produces the AAPL $230 example: 5 unique strikes (legs collapse, close fills)", () => {
    // AAPL prev close $230:
    //   -3% = 223.1 → 220, -6% = 216.2 → 220, -9% = 209.3 → 210   (down legs collapse 220,220 → 220)
    //   +3% = 236.9 → 240, +6% = 243.8 → 240, +9% = 250.7 → 250   (up legs collapse 240,240 → 240)
    //   close 230 → 230
    // The ± legs alone would yield only 4 ({210,220,240,250}); the rounded close fills the
    // at-the-money gap to give 5: {210,220,230,240,250}.
    expect(strikesInDollars(230)).to.deep.equal([210, 220, 230, 240, 250]);
  });

  it("collapses a very low price where every leg AND the close round together", () => {
    // $30 ± {3,6,9}% = {27.3, 28.2, 29.1} / {30.9, 31.8, 32.7}. Rounded to $10 every leg
    // becomes 30, and the close (30) is also 30 → a single strike.
    expect(strikesInDollars(30)).to.deep.equal([30]);
  });

  it("returns ascending, unique, positive strikes", () => {
    const strikes = computeStrikes(usd(214));
    const nums = strikes.map((s) => s.toString());
    for (let i = 1; i < strikes.length; i++) {
      expect(strikes[i].gt(strikes[i - 1]), `strike[${i}] > strike[${i - 1}]`)
        .to.be.true;
    }
    expect(new Set(nums).size).to.equal(nums.length);
    for (const s of strikes) expect(s.gtn(0)).to.be.true;
  });

  it("always includes the rounded close as a strike", () => {
    for (const close of [308, 230, 680, 214, 421, 117]) {
      const rounded = dollarsToStrikeUnits(close);
      const has = computeStrikes(usd(close)).some((s) => s.eq(rounded));
      expect(has, `close ${close} (→ ${rounded.toString()}) present`).to.be
        .true;
    }
  });

  it("never emits a non-positive strike for a tiny price", () => {
    // A price so small that a -9% rounded-to-$10 leg would be 0 must be dropped, not
    // emitted as a 0 strike (a $0 strike is meaningless and the program forbids it).
    const strikes = computeStrikes(usd(4));
    for (const s of strikes)
      expect(s.gtn(0), "no zero/negative strike").to.be.true;
  });

  it("rejects a non-positive previous close", () => {
    expect(() => computeStrikes(new BN(0))).to.throw();
    expect(() => computeStrikes(usd(-5))).to.throw();
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
    const strikes = computeStrikes(usd(680));
    const tenDollars = new BN(10).mul(PAYOFF_UNIT);
    for (const s of strikes) {
      expect(s.mod(tenDollars).isZero(), `${s} is a $10 multiple`).to.be.true;
    }
  });
});
