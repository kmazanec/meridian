import { describe, it, expect } from "vitest";
import BN from "bn.js";
import { Outcome, Ticker } from "@meridian/sdk";
import {
  buildPortfolio,
  portfolioSummary,
  type Holding,
  type PortfolioRow,
} from "./portfolio";
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
    tradingDay: new BN(1_700_000_000),
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

describe("portfolioSummary", () => {
  const rows: PortfolioRow[] = [
    {
      kind: "open",
      market: "A",
      ticker: Ticker.Aapl,
      strike: new BN(300_000000),
      side: "yes",
      amount: new BN(5_000000),
      tradingDay: new BN(1_700_000_000),
      markPrice: new BN(600_000),
      entryPrice: new BN(500_000),
      value: new BN(3_000000), // $3.00
      pnl: new BN(500_000), // +$0.50
    },
    {
      kind: "open",
      market: "B",
      ticker: Ticker.Aapl,
      strike: new BN(320_000000),
      side: "no",
      amount: new BN(2_000000),
      tradingDay: new BN(1_700_000_000),
      markPrice: new BN(400_000),
      entryPrice: null, // unknown entry → excluded from P&L
      value: new BN(800_000), // $0.80
      pnl: null,
    },
    {
      kind: "settled",
      market: "C",
      ticker: Ticker.Nvda,
      strike: new BN(1_180_000000),
      side: "yes",
      amount: new BN(4_000000),
      tradingDay: new BN(1_700_000_000),
      payout: new BN(4_000000), // $4.00 claimable
      redeemable: true,
    },
    {
      kind: "settled",
      market: "D",
      ticker: Ticker.Tsla,
      strike: new BN(430_000000),
      side: "yes",
      amount: new BN(2_000000),
      tradingDay: new BN(1_700_000_000),
      payout: new BN(0),
      redeemable: false, // lost — not claimable
    },
  ];

  it("sums open value, P&L (entry-known only), and claimable payouts", () => {
    const s = portfolioSummary(rows);
    expect(s.positionValue.toNumber()).toBe(3_800_000); // $3.00 + $0.80
    expect(s.openPnl?.toNumber()).toBe(500_000); // only the position with an entry
    expect(s.openCount).toBe(2);
    expect(s.claimable.toNumber()).toBe(4_000_000); // only the redeemable winner
    expect(s.claimableCount).toBe(1);
  });

  it("reports null P&L when no open position has a known entry", () => {
    const s = portfolioSummary([rows[1]]); // the entry-less open row
    expect(s.openPnl).toBeNull();
    expect(s.positionValue.toNumber()).toBe(800_000);
  });

  it("is all-zero / null for an empty book", () => {
    const s = portfolioSummary([]);
    expect(s.positionValue.toNumber()).toBe(0);
    expect(s.openPnl).toBeNull();
    expect(s.openCount).toBe(0);
    expect(s.claimable.toNumber()).toBe(0);
    expect(s.claimableCount).toBe(0);
  });
});
