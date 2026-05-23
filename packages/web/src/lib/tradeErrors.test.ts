import { describe, it, expect } from "vitest";
import { marketOrderHasNoLiquidity, readableTradeError } from "./tradeErrors";

describe("marketOrderHasNoLiquidity", () => {
  it("true for a market order with no makers", () => {
    expect(marketOrderHasNoLiquidity({ isMarket: true, makerCount: 0 })).toBe(true);
  });
  it("false for a market order with makers", () => {
    expect(marketOrderHasNoLiquidity({ isMarket: true, makerCount: 2 })).toBe(false);
  });
  it("false for a limit order even with no makers (it rests)", () => {
    expect(marketOrderHasNoLiquidity({ isMarket: false, makerCount: 0 })).toBe(false);
  });
});

describe("readableTradeError", () => {
  it("maps SOL fee shortfall", () => {
    expect(readableTradeError(new Error("Attempt to debit: insufficient lamports"))).toMatch(
      /SOL/
    );
  });
  it("maps token insufficient funds", () => {
    expect(readableTradeError(new Error("Transfer: insufficient funds"))).toMatch(
      /Insufficient funds for this trade/
    );
  });
  it("maps user rejection", () => {
    expect(readableTradeError(new Error("User rejected the request"))).toMatch(/rejected/);
  });
  it("maps expired blockhash", () => {
    expect(readableTradeError(new Error("block height exceeded"))).toMatch(/expired/);
  });
  it("maps 429", () => {
    expect(readableTradeError(new Error("429 Too Many Requests"))).toMatch(/rate-limit/);
  });
  it("replaces the bare 'Unexpected error' with a generic line", () => {
    expect(readableTradeError(new Error("Unexpected error"))).toMatch(
      /could not be completed/
    );
  });
  it("passes through a meaningful original message", () => {
    expect(readableTradeError(new Error("Market is paused"))).toBe("Market is paused");
  });
});
