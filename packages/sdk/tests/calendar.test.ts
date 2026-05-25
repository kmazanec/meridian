/**
 * US equity market-calendar tests.
 *
 * The calendar owns the *timing* concern ADR-005 places off-chain: it decides which
 * dates are trading sessions (no weekends, no NYSE holidays, half-days handled) and
 * converts a session's close to a unix timestamp — `Market.trading_day`, the 4:00 PM ET
 * close instant (1:00 PM ET on half-days). The DST-aware ET→unix conversion is the trap;
 * these tests pin both standard-time and daylight-time sessions and the half-day rule.
 */

import { expect } from "chai";
import {
  isTradingDay,
  isHalfDay,
  isHoliday,
  closeInstant,
  sessionForDate,
} from "../src/calendar";

/** Parse a YYYY-MM-DD as a calendar date in ET (noon UTC keeps the date unambiguous). */
function d(iso: string): Date {
  return new Date(`${iso}T12:00:00Z`);
}

describe("market calendar", () => {
  describe("trading-day detection", () => {
    it("rejects weekends", () => {
      expect(isTradingDay(d("2026-05-23"))).to.be.false; // Saturday
      expect(isTradingDay(d("2026-05-24"))).to.be.false; // Sunday
    });

    it("accepts a normal weekday", () => {
      expect(isTradingDay(d("2026-05-21"))).to.be.true; // Thursday
    });

    it("rejects fixed and floating NYSE holidays", () => {
      expect(isHoliday(d("2026-01-01"))).to.be.true; // New Year's Day
      expect(isHoliday(d("2026-07-03"))).to.be.true; // Independence Day (observed, Jul 4 = Sat)
      expect(isHoliday(d("2026-12-25"))).to.be.true; // Christmas
      expect(isHoliday(d("2026-11-26"))).to.be.true; // Thanksgiving (4th Thu Nov)
      expect(isTradingDay(d("2026-12-25"))).to.be.false;
    });

    it("treats a holiday that lands on a weekend as observed on the adjacent weekday", () => {
      // Jul 4 2026 is a Saturday → observed Friday Jul 3.
      expect(isHoliday(d("2026-07-03"))).to.be.true;
      expect(isTradingDay(d("2026-07-03"))).to.be.false;
    });
  });

  describe("half-days", () => {
    it("flags the day after Thanksgiving as a half-day", () => {
      expect(isHalfDay(d("2026-11-27"))).to.be.true; // Black Friday
      expect(isTradingDay(d("2026-11-27"))).to.be.true; // still a (short) session
    });

    it("flags Christmas Eve as a half-day when it is a weekday", () => {
      expect(isHalfDay(d("2026-12-24"))).to.be.true; // Thursday
    });

    it("a normal day is not a half-day", () => {
      expect(isHalfDay(d("2026-05-21"))).to.be.false;
    });
  });

  describe("closeInstant — DST-aware ET→unix", () => {
    it("computes 4:00 PM EDT (summer, UTC-4) → 20:00 UTC", () => {
      const ts = closeInstant(d("2026-07-01")); // EDT
      // 4 PM EDT = 20:00 UTC
      expect(new Date(ts * 1000).toISOString()).to.equal(
        "2026-07-01T20:00:00.000Z"
      );
    });

    it("computes 4:00 PM EST (winter, UTC-5) → 21:00 UTC", () => {
      const ts = closeInstant(d("2026-01-02")); // EST (Jan 1 is a holiday)
      expect(new Date(ts * 1000).toISOString()).to.equal(
        "2026-01-02T21:00:00.000Z"
      );
    });

    it("uses 1:00 PM ET on a half-day", () => {
      const ts = closeInstant(d("2026-11-27")); // Black Friday half-day, EST
      // 1 PM EST = 18:00 UTC
      expect(new Date(ts * 1000).toISOString()).to.equal(
        "2026-11-27T18:00:00.000Z"
      );
    });

    it("returns whole unix seconds (no fractional, integer trading_day)", () => {
      const ts = closeInstant(d("2026-07-01"));
      expect(Number.isInteger(ts)).to.be.true;
    });

    it("throws if asked for the close of a non-session date", () => {
      expect(() => closeInstant(d("2026-05-23"))).to.throw(); // Saturday
      expect(() => closeInstant(d("2026-12-25"))).to.throw(); // Christmas
    });
  });

  describe("sessionForDate", () => {
    it("summarizes a normal session", () => {
      const s = sessionForDate(d("2026-05-21"));
      expect(s.isTradingDay).to.be.true;
      expect(s.isHalfDay).to.be.false;
      expect(s.closeInstant).to.be.a("number");
    });

    it("summarizes a holiday with no close instant", () => {
      const s = sessionForDate(d("2026-12-25"));
      expect(s.isTradingDay).to.be.false;
      expect(s.closeInstant).to.equal(null);
    });
  });
});
