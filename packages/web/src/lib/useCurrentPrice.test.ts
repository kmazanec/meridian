import { describe, it, expect } from "vitest";
import { parseCurrentPrice } from "./useCurrentPrice";

describe("parseCurrentPrice", () => {
  it("parses price, open, and pctFromOpen from a well-formed payload", () => {
    const out = parseCurrentPrice({
      symbol: "NVDA",
      price: 215.33,
      open: 220.9,
      pctFromOpen: -0.0252,
      asOf: "2026-05-23T20:00:00Z",
    });
    expect(out.price).toBeCloseTo(215.33);
    expect(out.open).toBeCloseTo(220.9);
    expect(out.pctFromOpen).toBeCloseTo(-0.0252);
  });

  it("nulls out non-finite or missing fields", () => {
    const out = parseCurrentPrice({ price: "nope", pctFromOpen: NaN });
    expect(out.price).toBeNull();
    expect(out.open).toBeNull();
    expect(out.pctFromOpen).toBeNull();
  });

  it("returns an all-null quote for a malformed payload", () => {
    expect(parseCurrentPrice(null)).toEqual({
      price: null,
      open: null,
      pctFromOpen: null,
    });
    expect(parseCurrentPrice("bad")).toEqual({
      price: null,
      open: null,
      pctFromOpen: null,
    });
  });
});
