import { describe, it, expect } from "vitest";
import BN from "bn.js";
import { TradeAction } from "@meridian/sdk";
import { fillToRecord } from "./recordTradeFill";

describe("fillToRecord", () => {
  it("records Buy Yes as a Yes entry at the Yes price", () => {
    const rec = fillToRecord("MKT", {
      action: TradeAction.BuyYes,
      price: new BN(650_000),
      size: new BN(1_000_000),
    })!;
    expect(rec.side).toBe("yes");
    expect(rec.price).toBe("650000");
  });

  it("records Buy No as a No entry at the entered No price", () => {
    const rec = fillToRecord("MKT", {
      action: TradeAction.BuyNo,
      price: new BN(300_000),
      size: new BN(1_000_000),
    })!;
    expect(rec.side).toBe("no");
    expect(rec.price).toBe("300000");
  });

  it("records Sell No as a Yes entry at 1 − noPrice (it buys Yes)", () => {
    const rec = fillToRecord("MKT", {
      action: TradeAction.SellNo,
      price: new BN(300_000),
      size: new BN(1_000_000),
    })!;
    expect(rec.side).toBe("yes");
    expect(rec.price).toBe("700000"); // 1.00 − 0.30
  });

  it("does not record Sell Yes (an exit, not a new entry)", () => {
    expect(
      fillToRecord("MKT", {
        action: TradeAction.SellYes,
        price: new BN(650_000),
        size: new BN(1_000_000),
      })
    ).toBeNull();
  });
});
