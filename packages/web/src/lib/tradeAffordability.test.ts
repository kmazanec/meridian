import { describe, it, expect } from "vitest";
import BN from "bn.js";
import { TradeAction } from "@meridian/sdk";
import { tradeCost, formatAmount, costSummary } from "./tradeAffordability";

const U = (n: number) => new BN(Math.round(n * 1_000_000)); // dollars/tokens → 6dp
const bal = (usdc: number, yes = 0, no = 0) => ({
  usdc: U(usdc),
  yes: U(yes),
  no: U(no),
});

describe("tradeCost — Buy Yes", () => {
  it("requires yesPrice * size USDC", () => {
    const c = tradeCost({
      action: TradeAction.BuyYes,
      price: U(0.5),
      size: U(2),
      isMarket: false,
      balances: bal(10),
    });
    expect(c.asset).toBe("USDC");
    expect(c.required.eq(U(1))).toBe(true); // 0.5 * 2
    expect(c.affordable).toBe(true);
  });
  it("is unaffordable with too little USDC", () => {
    const c = tradeCost({
      action: TradeAction.BuyYes,
      price: U(0.5),
      size: U(2),
      isMarket: false,
      balances: bal(0.5),
    });
    expect(c.affordable).toBe(false);
  });
});

describe("tradeCost — Buy No (the case that failed)", () => {
  it("requires the full size in USDC (mint deposits $1.00/pair up front)", () => {
    const c = tradeCost({
      action: TradeAction.BuyNo,
      price: U(0.5), // No price; reflected internally but deposit is full size
      size: U(1),
      isMarket: false,
      balances: bal(0),
    });
    expect(c.asset).toBe("USDC");
    expect(c.required.eq(U(1))).toBe(true);
    expect(c.affordable).toBe(false); // 0 USDC → the real bug
  });
  it("is affordable with enough USDC", () => {
    const c = tradeCost({
      action: TradeAction.BuyNo,
      price: U(0.5),
      size: U(1),
      isMarket: false,
      balances: bal(1),
    });
    expect(c.affordable).toBe(true);
  });
});

describe("tradeCost — Sell Yes", () => {
  it("requires Yes tokens, not USDC", () => {
    const c = tradeCost({
      action: TradeAction.SellYes,
      price: U(0.6),
      size: U(3),
      isMarket: false,
      balances: bal(0, 3),
    });
    expect(c.asset).toBe("Yes");
    expect(c.required.eq(U(3))).toBe(true);
    expect(c.affordable).toBe(true);
  });
  it("unaffordable without enough Yes", () => {
    const c = tradeCost({
      action: TradeAction.SellYes,
      price: U(0.6),
      size: U(3),
      isMarket: false,
      balances: bal(100, 1),
    });
    expect(c.affordable).toBe(false);
  });
});

describe("tradeCost — market order budgets worst case $1.00", () => {
  it("Buy Yes market needs full size USDC (price treated as $1.00)", () => {
    const c = tradeCost({
      action: TradeAction.BuyYes,
      price: U(0.5),
      size: U(2),
      isMarket: true,
      balances: bal(1.5),
    });
    expect(c.required.eq(U(2))).toBe(true); // 1.00 * 2
    expect(c.affordable).toBe(false);
  });
});

describe("formatters", () => {
  it("formatAmount", () => {
    expect(formatAmount(U(12.5))).toBe("12.50");
  });
  it("costSummary for USDC", () => {
    const c = tradeCost({
      action: TradeAction.BuyNo,
      price: U(0.5),
      size: U(1),
      isMarket: false,
      balances: bal(5),
    });
    expect(costSummary(c)).toMatch(/pay up to 1\.00 USDC/);
  });
});
