import { describe, it, expect } from "vitest";
import BN from "bn.js";
import { OrderSide, TradeAction } from "@meridian/sdk";
import {
  yesSideFor,
  yesPriceFor,
  isNoAction,
  validateTradeForm,
  parsePrice,
  parseSize,
} from "./tradeForm";

describe("tradeForm", () => {
  it("maps each action to its Yes-book side", () => {
    expect(yesSideFor(TradeAction.BuyYes)).toBe(OrderSide.Bid);
    expect(yesSideFor(TradeAction.SellNo)).toBe(OrderSide.Bid);
    expect(yesSideFor(TradeAction.SellYes)).toBe(OrderSide.Ask);
    expect(yesSideFor(TradeAction.BuyNo)).toBe(OrderSide.Ask);
  });

  it("reflects the No price to a Yes price for No actions only", () => {
    expect(isNoAction(TradeAction.BuyNo)).toBe(true);
    expect(isNoAction(TradeAction.BuyYes)).toBe(false);
    // Yes action: price unchanged.
    expect(yesPriceFor(TradeAction.BuyYes, new BN(650_000)).toNumber()).toBe(
      650_000
    );
    // No action: 1 − 0.30 = 0.70.
    expect(yesPriceFor(TradeAction.BuyNo, new BN(300_000)).toNumber()).toBe(
      700_000
    );
  });

  it("validates size and limit price", () => {
    const base = {
      action: TradeAction.BuyYes,
      price: new BN(500_000),
      isMarket: false,
    };
    expect(validateTradeForm({ ...base, size: new BN(1_000_000) }).ok).toBe(
      true
    );
    expect(validateTradeForm({ ...base, size: new BN(0) }).ok).toBe(false);
    expect(
      validateTradeForm({ ...base, size: new BN(1), price: new BN(0) }).ok
    ).toBe(false);
    expect(
      validateTradeForm({ ...base, size: new BN(1), price: new BN(2_000_000) })
        .ok
    ).toBe(false);
  });

  it("allows a zero price for a market order", () => {
    expect(
      validateTradeForm({
        action: TradeAction.BuyYes,
        price: new BN(0),
        size: new BN(1_000_000),
        isMarket: true,
      }).ok
    ).toBe(true);
  });

  it("enforces BUY_NO whole-token and the per-tx cap", () => {
    const base = {
      action: TradeAction.BuyNo,
      price: new BN(300_000),
      isMarket: false,
    };
    // 1.5 tokens → not a whole multiple.
    expect(validateTradeForm({ ...base, size: new BN(1_500_000) }).ok).toBe(
      false
    );
    // 6 tokens → ok (at the cap).
    expect(validateTradeForm({ ...base, size: new BN(6_000_000) }).ok).toBe(
      true
    );
    // 7 tokens → over the cap.
    expect(validateTradeForm({ ...base, size: new BN(7_000_000) }).ok).toBe(
      false
    );
  });

  it("parses decimal price/size into base units", () => {
    expect(parsePrice("0.65")!.toNumber()).toBe(650_000);
    expect(parsePrice("-1")).toBeNull();
    expect(parseSize("1.5")!.toNumber()).toBe(1_500_000);
    expect(parseSize("0")).toBeNull();
    expect(parseSize("abc")).toBeNull();
  });
});
