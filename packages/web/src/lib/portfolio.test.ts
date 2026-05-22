import { describe, it, expect } from "vitest";
import BN from "bn.js";
import { Outcome, Ticker } from "@meridian/sdk";
import { buildPortfolio, type Holding } from "./portfolio";
import { basisKey, type CostBasis } from "./tradeStore";

function holding(over: Partial<Holding>): Holding {
  return {
    market: "MKT",
    ticker: Ticker.Meta,
    strike: new BN(680_000_000),
    side: "yes",
    amount: new BN(1_000_000),
    state: "open",
    outcome: Outcome.Unsettled,
    yesMark: new BN(600_000),
    ...over,
  };
}

describe("buildPortfolio", () => {
  it("computes P&L for an open position with a known entry", () => {
    const basis = new Map<string, CostBasis>([
      [
        basisKey("MKT", "yes"),
        { size: new BN(1_000_000), avgPrice: new BN(500_000) },
      ],
    ]);
    const [row] = buildPortfolio([holding({})], basis);
    expect(row.kind).toBe("open");
    if (row.kind !== "open") throw new Error("expected open");
    expect(row.markPrice.toNumber()).toBe(600_000);
    expect(row.entryPrice!.toNumber()).toBe(500_000);
    // 1.0 token: value $0.60, cost $0.50 → +$0.10.
    expect(row.value.toNumber()).toBe(600_000);
    expect(row.pnl!.toNumber()).toBe(100_000);
  });

  it("marks a No position at 1 − Yes", () => {
    const [row] = buildPortfolio(
      [holding({ side: "no", yesMark: new BN(600_000) })],
      new Map()
    );
    if (row.kind !== "open") throw new Error("expected open");
    expect(row.markPrice.toNumber()).toBe(400_000); // 1 − 0.60
    expect(row.pnl).toBeNull(); // no basis recorded
  });

  it("reports payout and redeemable for a settled winner", () => {
    const [row] = buildPortfolio(
      [
        holding({
          state: "settled",
          outcome: Outcome.YesWins,
          side: "yes",
          amount: new BN(3_000_000),
        }),
      ],
      new Map()
    );
    expect(row.kind).toBe("settled");
    if (row.kind !== "settled") throw new Error("expected settled");
    expect(row.payout.toNumber()).toBe(3_000_000); // winner 1:1
    expect(row.redeemable).toBe(true);
  });

  it("a settled loser has zero payout and is not redeemable", () => {
    const [row] = buildPortfolio(
      [
        holding({
          state: "settled",
          outcome: Outcome.NoWins,
          side: "yes",
          amount: new BN(2_000_000),
        }),
      ],
      new Map()
    );
    if (row.kind !== "settled") throw new Error("expected settled");
    expect(row.payout.toNumber()).toBe(0);
    expect(row.redeemable).toBe(false);
  });

  it("skips zero-amount holdings", () => {
    expect(buildPortfolio([holding({ amount: new BN(0) })], new Map())).toEqual(
      []
    );
  });
});
