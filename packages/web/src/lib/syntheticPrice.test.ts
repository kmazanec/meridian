import { describe, it, expect } from "vitest";
import {
  sessionProgress,
  interpolateCurve,
  curveIndexForDay,
  syntheticPrice,
  type CurvePoint,
} from "../../functions/api/_synthetic-price";

const curve: CurvePoint[] = [
  { t: 0, d: 0 },
  { t: 0.5, d: 0.02 }, // +2% from open at mid-session
  { t: 1, d: -0.01 }, // -1% from open at close
];

describe("sessionProgress", () => {
  const tradingDay = 1_000_000; // arbitrary unix seconds
  const synthDay = 5400;
  const tick = 5;

  it("is 0 at/before the session start and 1 at/after the close", () => {
    expect(
      sessionProgress(tradingDay - synthDay, tradingDay, synthDay, tick)
    ).to.equal(0);
    expect(
      sessionProgress(tradingDay - synthDay - 999, tradingDay, synthDay, tick)
    ).to.equal(0);
    expect(sessionProgress(tradingDay, tradingDay, synthDay, tick)).to.equal(1);
    expect(
      sessionProgress(tradingDay + 999, tradingDay, synthDay, tick)
    ).to.equal(1);
  });

  it("is ~0.5 halfway through the window", () => {
    const mid = tradingDay - synthDay / 2;
    expect(sessionProgress(mid, tradingDay, synthDay, tick)).to.be.closeTo(
      0.5,
      1e-9
    );
  });

  it("quantizes to the tick bucket so nearby calls agree exactly", () => {
    const base = tradingDay - synthDay / 2; // a multiple-of-5 instant
    const a = sessionProgress(base + 1, tradingDay, synthDay, tick);
    const b = sessionProgress(base + 4, tradingDay, synthDay, tick);
    expect(a).to.equal(b); // same 5s bucket → identical progress
    const next = sessionProgress(base + 6, tradingDay, synthDay, tick);
    expect(next).to.not.equal(a); // crossed into the next bucket
  });
});

describe("interpolateCurve", () => {
  it("returns endpoints at and beyond the bounds", () => {
    expect(interpolateCurve(curve, 0)).to.equal(0);
    expect(interpolateCurve(curve, -1)).to.equal(0);
    expect(interpolateCurve(curve, 1)).to.equal(-0.01);
    expect(interpolateCurve(curve, 2)).to.equal(-0.01);
  });

  it("linearly interpolates between points", () => {
    expect(interpolateCurve(curve, 0.25)).to.be.closeTo(0.01, 1e-9); // halfway 0 → 0.02
    expect(interpolateCurve(curve, 0.75)).to.be.closeTo(0.005, 1e-9); // halfway 0.02 → -0.01
  });

  it("handles an empty curve", () => {
    expect(interpolateCurve([], 0.5)).to.equal(0);
  });
});

describe("curveIndexForDay", () => {
  it("is stable for a given trading day and wraps over the day count", () => {
    const d = 1_700_000_000;
    expect(curveIndexForDay(d, 6)).to.equal(curveIndexForDay(d, 6));
    expect(curveIndexForDay(d, 6)).to.be.within(0, 5);
    // Different days generally land on different indices (not asserting which).
    expect(curveIndexForDay(d, 1)).to.equal(0);
  });
});

describe("syntheticPrice", () => {
  it("applies the interpolated %-from-open to the open price", () => {
    // mid-session (+2%) on a $200 open → $204
    expect(syntheticPrice(200, curve, 0.5)).to.be.closeTo(204, 1e-9);
    // close (-1%) on a $200 open → $198
    expect(syntheticPrice(200, curve, 1)).to.be.closeTo(198, 1e-9);
  });
});
