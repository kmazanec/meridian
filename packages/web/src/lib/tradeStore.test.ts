import { describe, it, expect } from "vitest";
import { aggregateBasis, basisKey, type FillRecord } from "./tradeStore";

function fill(
  market: string,
  side: "yes" | "no",
  size: number,
  price: number
): FillRecord {
  return {
    market,
    side,
    size: String(size),
    price: String(price),
    ts: 0,
  };
}

describe("tradeStore.aggregateBasis", () => {
  it("keeps a size-weighted average entry per market+side", () => {
    const m = "MKT";
    // Buy 1 token @ 0.40, then 1 token @ 0.60 → avg 0.50, size 2.
    const basis = aggregateBasis([
      fill(m, "yes", 1_000_000, 400_000),
      fill(m, "yes", 1_000_000, 600_000),
    ]);
    const b = basis.get(basisKey(m, "yes"))!;
    expect(b.size.toNumber()).toBe(2_000_000);
    expect(b.avgPrice.toNumber()).toBe(500_000);
  });

  it("weights by size, not count", () => {
    const m = "MKT";
    // 3 tokens @ 0.20, 1 token @ 0.60 → (3*0.20 + 1*0.60)/4 = 0.30.
    const basis = aggregateBasis([
      fill(m, "yes", 3_000_000, 200_000),
      fill(m, "yes", 1_000_000, 600_000),
    ]);
    expect(basis.get(basisKey(m, "yes"))!.avgPrice.toNumber()).toBe(300_000);
  });

  it("separates markets and sides", () => {
    const basis = aggregateBasis([
      fill("A", "yes", 1_000_000, 500_000),
      fill("A", "no", 1_000_000, 300_000),
      fill("B", "yes", 1_000_000, 700_000),
    ]);
    expect(basis.get(basisKey("A", "yes"))!.avgPrice.toNumber()).toBe(500_000);
    expect(basis.get(basisKey("A", "no"))!.avgPrice.toNumber()).toBe(300_000);
    expect(basis.get(basisKey("B", "yes"))!.avgPrice.toNumber()).toBe(700_000);
  });
});
