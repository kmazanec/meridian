import { describe, it, expect } from "vitest";
import BN from "bn.js";
import {
  formatPrice,
  formatProbability,
  formatUsdc,
  formatTokens,
  formatSignedUsdc,
  shortKey,
} from "./format";

describe("format", () => {
  it("formats a price (price-scale integer) as dollars", () => {
    expect(formatPrice(650_000)).toBe("$0.65");
    expect(formatPrice(new BN(1_000_000))).toBe("$1.00");
    expect(formatPrice(0)).toBe("$0.00");
  });

  it("formats a price as an implied probability percent", () => {
    expect(formatProbability(650_000)).toBe("65%");
    expect(formatProbability(0)).toBe("0%");
    expect(formatProbability(1_000_000)).toBe("100%");
  });

  it("formats USDC base units as dollars", () => {
    expect(formatUsdc(1_000_000)).toBe("$1.00");
    expect(formatUsdc(1_234_560)).toBe("$1.23");
    expect(formatUsdc(new BN(12_500_000))).toBe("$12.50");
  });

  it("formats token base units as a count", () => {
    expect(formatTokens(1_000_000)).toBe("1");
    expect(formatTokens(1_500_000)).toBe("1.5");
  });

  it("formats a signed USDC P&L with a leading sign", () => {
    expect(formatSignedUsdc(400_000)).toBe("+$0.40");
    expect(formatSignedUsdc(new BN(-100_000))).toBe("-$0.10");
    expect(formatSignedUsdc(0)).toBe("+$0.00");
  });

  it("shortens a base58 key", () => {
    expect(shortKey("7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU")).toBe(
      "7xKX…gAsU"
    );
    expect(shortKey("short")).toBe("short");
  });
});
