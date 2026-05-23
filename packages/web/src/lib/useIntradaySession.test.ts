import { describe, it, expect } from "vitest";
import { parseIntraday } from "./useIntradaySession";

describe("parseIntraday", () => {
  it("parses points, liveIndex, and progress from a well-formed payload", () => {
    const out = parseIntraday({
      points: [
        { timestamp: 100, close: 200 },
        { timestamp: 200, close: 204 },
        { timestamp: 300, close: 198 },
      ],
      liveIndex: 1,
      progress: 0.4,
    });
    expect(out.points).toHaveLength(3);
    expect(out.liveIndex).toBe(1);
    expect(out.progress).toBeCloseTo(0.4);
  });

  it("sorts points ascending by timestamp", () => {
    const out = parseIntraday({
      points: [
        { timestamp: 300, close: 198 },
        { timestamp: 100, close: 200 },
        { timestamp: 200, close: 204 },
      ],
      liveIndex: 0,
      progress: 0,
    });
    expect(out.points.map((p) => p.timestamp)).toEqual([100, 200, 300]);
  });

  it("drops rows with non-finite or missing values", () => {
    const out = parseIntraday({
      points: [
        { timestamp: 100, close: 200 },
        { timestamp: 200 }, // missing close
        { timestamp: NaN, close: 5 },
        { close: 7 }, // missing timestamp
        "nope",
      ],
      liveIndex: 0,
      progress: 0,
    });
    expect(out.points).toHaveLength(1);
    expect(out.points[0]).toEqual({ timestamp: 100, close: 200 });
  });

  it("clamps liveIndex into range and progress into [0,1]", () => {
    const out = parseIntraday({
      points: [
        { timestamp: 100, close: 200 },
        { timestamp: 200, close: 204 },
      ],
      liveIndex: 99,
      progress: 5,
    });
    expect(out.liveIndex).toBe(1); // clamped to last index
    expect(out.progress).toBe(1); // clamped to 1
  });

  it("returns an empty result for a malformed payload", () => {
    expect(parseIntraday(null)).toEqual({
      points: [],
      liveIndex: 0,
      progress: 0,
    });
    expect(parseIntraday({ points: "bad" })).toEqual({
      points: [],
      liveIndex: 0,
      progress: 0,
    });
  });
});
