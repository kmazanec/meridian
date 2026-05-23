import { describe, it, expect } from "vitest";
import { parseHistory, spotFromHistory } from "./usePriceHistory";

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

  it("keeps open when finite and omits it otherwise", () => {
    const out = parseHistory([
      { date: "2026-05-01", close: 100, open: 98.5 },
      { date: "2026-05-02", close: 101, open: null },
    ]);
    expect(out[0]).toEqual({ date: "2026-05-01", close: 100, open: 98.5 });
    expect(out[1]).toEqual({ date: "2026-05-02", close: 101 });
    expect(out[1].open).toBeUndefined();
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

describe("spotFromHistory", () => {
  it("returns the latest close/open and day-over-day % change", () => {
    const spot = spotFromHistory([
      { date: "2026-05-01", close: 100, open: 99 },
      { date: "2026-05-02", close: 110, open: 101 },
    ]);
    expect(spot).toEqual({
      date: "2026-05-02",
      close: 110,
      open: 101,
      changePct: 0.1, // (110 - 100) / 100
    });
  });

  it("has a null changePct with only one day, and null open if absent", () => {
    const spot = spotFromHistory([{ date: "2026-05-01", close: 100 }]);
    expect(spot).toEqual({
      date: "2026-05-01",
      close: 100,
      open: null,
      changePct: null,
    });
  });

  it("returns null for empty history", () => {
    expect(spotFromHistory([])).toBeNull();
  });
});
