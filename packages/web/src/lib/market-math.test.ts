import { describe, it, expect } from "vitest";
import BN from "bn.js";
import { Outcome, type BookView, type BookLevel } from "@meridian/sdk";
import {
  midPrice,
  priceFromBook,
  impliedComplement,
  markValue,
  positionPnl,
  settledPayout,
  holdsBothSides,
} from "./market-math";

function level(price: number, size: number, count = 1): BookLevel {
  return { price: new BN(price), size: new BN(size), count };
}

const emptyView: BookView = { bids: [], asks: [] };

describe("market-math", () => {
  it("midPrice averages best bid and ask, null if a side is empty", () => {
    const view: BookView = {
      bids: [level(600_000, 1_000_000)],
      asks: [level(700_000, 1_000_000)],
    };
    expect(midPrice(view)!.toNumber()).toBe(650_000);
    expect(midPrice({ bids: [level(600_000, 1)], asks: [] })).toBeNull();
    expect(midPrice(emptyView)).toBeNull();
  });

  it("priceFromBook prefers mid, then a single side, then 50/50", () => {
    expect(
      priceFromBook({
        bids: [level(600_000, 1)],
        asks: [level(700_000, 1)],
      }).toNumber()
    ).toBe(650_000);
    expect(
      priceFromBook({ bids: [level(620_000, 1)], asks: [] }).toNumber()
    ).toBe(620_000);
    expect(
      priceFromBook({ bids: [], asks: [level(710_000, 1)] }).toNumber()
    ).toBe(710_000);
    // Empty book → strike-implied 50/50.
    expect(priceFromBook(emptyView).toNumber()).toBe(500_000);
  });

  it("impliedComplement returns the No price for a Yes price", () => {
    expect(impliedComplement(new BN(650_000)).toNumber()).toBe(350_000);
    expect(impliedComplement(new BN(0)).toNumber()).toBe(1_000_000);
  });

  it("markValue scales tokens by price", () => {
    // 2.0 tokens at $0.65 = $1.30
    expect(markValue(new BN(2_000_000), new BN(650_000)).toNumber()).toBe(
      1_300_000
    );
  });

  it("positionPnl computes value, cost, and signed pnl", () => {
    // Bought 1.0 Yes at $0.50, now marks at $0.70 → +$0.20.
    const r = positionPnl(new BN(1_000_000), new BN(500_000), new BN(700_000));
    expect(r.value.toNumber()).toBe(700_000);
    expect(r.cost.toNumber()).toBe(500_000);
    expect(r.pnl.toNumber()).toBe(200_000);

    // A losing mark gives negative pnl.
    const loss = positionPnl(
      new BN(1_000_000),
      new BN(700_000),
      new BN(400_000)
    );
    expect(loss.pnl.toNumber()).toBe(-300_000);
  });

  it("settledPayout pays the winning side 1:1, the loser zero", () => {
    const yesWins = { outcome: Outcome.YesWins };
    expect(settledPayout(yesWins, "yes", new BN(3_000_000)).toNumber()).toBe(
      3_000_000
    );
    expect(settledPayout(yesWins, "no", new BN(3_000_000)).toNumber()).toBe(0);

    const noWins = { outcome: Outcome.NoWins };
    expect(settledPayout(noWins, "no", new BN(2_000_000)).toNumber()).toBe(
      2_000_000
    );
    expect(settledPayout(noWins, "yes", new BN(2_000_000)).toNumber()).toBe(0);
  });

  it("holdsBothSides detects a both-sides position", () => {
    expect(
      holdsBothSides({ usdc: new BN(0), yes: new BN(1), no: new BN(1) })
    ).toBe(true);
    expect(
      holdsBothSides({ usdc: new BN(0), yes: new BN(1), no: new BN(0) })
    ).toBe(false);
    expect(
      holdsBothSides({ usdc: new BN(99), yes: new BN(0), no: new BN(0) })
    ).toBe(false);
  });
});
