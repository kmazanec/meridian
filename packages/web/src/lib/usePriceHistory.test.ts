import { describe, it, expect } from "vitest";
import { parseHistory } from "./usePriceHistory";

describe("parseHistory", () => {
  it("keeps valid rows and sorts ascending by date", () => {
    const out = parseHistory([
      { date: "2026-05-03", close: 102.5 },
      { date: "2026-05-01", close: 100 },
      { date: "2026-05-02", close: 101.25 },
    ]);
    expect(out.map((p) => p.date)).toEqual([
      "2026-05-01",
      "2026-05-02",
      "2026-05-03",
    ]);
    expect(out[2].close).toBe(102.5);
  });

  it("drops rows with missing/non-finite closes or bad dates", () => {
    const out = parseHistory([
      { date: "2026-05-01", close: 100 },
      { date: "2026-05-02", close: null },
      { date: "2026-05-03", close: Number.NaN },
      { date: 20260504, close: 99 },
      { close: 98 },
      "nope",
    ]);
    expect(out).toEqual([{ date: "2026-05-01", close: 100 }]);
  });

  it("returns an empty array for non-array input", () => {
    expect(parseHistory(null)).toEqual([]);
    expect(parseHistory({ error: "boom" })).toEqual([]);
    expect(parseHistory(undefined)).toEqual([]);
  });
});
