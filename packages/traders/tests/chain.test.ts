import { expect } from "chai";
import { rateLimitBackoffMs } from "../src/chain";

const MIN = 10_000;
const MAX = 30_000;

/** The ceiling the helper uses internally for a given attempt (mirror of its formula). */
function ceilingFor(attempt: number): number {
  return Math.min(MAX, MIN + (MAX - MIN) * (attempt * 0.25 + 0.25));
}

describe("rateLimitBackoffMs", () => {
  it("never returns less than the floor", () => {
    for (let attempt = 0; attempt < 6; attempt++) {
      for (let i = 0; i < 200; i++) {
        expect(rateLimitBackoffMs(attempt, MIN, MAX)).to.be.at.least(MIN);
      }
    }
  });

  it("never exceeds that attempt's widening ceiling (and so never the max)", () => {
    for (let attempt = 0; attempt < 6; attempt++) {
      const ceiling = ceilingFor(attempt);
      for (let i = 0; i < 200; i++) {
        const d = rateLimitBackoffMs(attempt, MIN, MAX);
        expect(d).to.be.at.most(ceiling);
        expect(d).to.be.at.most(MAX);
      }
    }
  });

  it("widens the window on later attempts (more spread, larger possible delays)", () => {
    const sampleMax = (attempt: number) =>
      Math.max(
        ...Array.from({ length: 500 }, () =>
          rateLimitBackoffMs(attempt, MIN, MAX)
        )
      );
    // The largest delay we see on attempt 3 should exceed what attempt 0 can reach, because
    // the ceiling grows with the attempt number.
    expect(sampleMax(3)).to.be.greaterThan(sampleMax(0));
  });

  it("is jittered — successive calls differ (de-synchronizes the fleet)", () => {
    const values = new Set(
      Array.from({ length: 50 }, () => rateLimitBackoffMs(1, MIN, MAX))
    );
    // With a continuous random window, 50 draws should almost never collapse to one value.
    expect(values.size).to.be.greaterThan(10);
  });

  it("tolerates min/max passed in either order", () => {
    const d = rateLimitBackoffMs(0, MAX, MIN); // swapped on purpose
    expect(d).to.be.at.least(MIN);
    expect(d).to.be.at.most(MAX);
  });
});
