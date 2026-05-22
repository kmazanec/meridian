import { describe, it, expect } from "vitest";
import BN from "bn.js";
import { countdownTo, formatCountdown } from "./countdown";

describe("countdown", () => {
  const close = 1_716_321_600; // some unix close instant (seconds)

  it("computes hours/minutes/seconds remaining", () => {
    const nowMs = (close - (3 * 3600 + 25 * 60 + 9)) * 1000;
    const c = countdownTo(close, nowMs);
    expect(c.closed).toBe(false);
    expect(c.hours).toBe(3);
    expect(c.minutes).toBe(25);
    expect(c.seconds).toBe(9);
    expect(c.totalSeconds).toBe(3 * 3600 + 25 * 60 + 9);
  });

  it("accepts a BN trading day", () => {
    const nowMs = (close - 61) * 1000;
    const c = countdownTo(new BN(close), nowMs);
    expect(c.minutes).toBe(1);
    expect(c.seconds).toBe(1);
  });

  it("reports closed at/after the close instant", () => {
    expect(countdownTo(close, close * 1000).closed).toBe(true);
    expect(countdownTo(close, (close + 5) * 1000).closed).toBe(true);
  });

  it("formats HH:MM:SS and Closed", () => {
    expect(
      formatCountdown({
        totalSeconds: 1,
        hours: 3,
        minutes: 5,
        seconds: 9,
        closed: false,
      })
    ).toBe("03:05:09");
    expect(
      formatCountdown({
        totalSeconds: 0,
        hours: 0,
        minutes: 0,
        seconds: 0,
        closed: true,
      })
    ).toBe("Closed");
  });
});
