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
  nextOpenInstant,
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

  describe("nextOpenInstant — the 9:30 AM ET opening bell", () => {
    it("returns today's 9:30 AM open when called before the bell", () => {
      // Thu 2026-05-21, 7:00 AM EDT (UTC-4) = 11:00 UTC — before the 9:30 open.
      const ts = nextOpenInstant(new Date("2026-05-21T11:00:00Z"));
      // 9:30 AM EDT = 13:30 UTC.
      expect(new Date(ts * 1000).toISOString()).to.equal(
        "2026-05-21T13:30:00.000Z"
      );
    });

    it("rolls to the next day once today's bell has rung", () => {
      // Thu 2026-05-21, 10:00 AM EDT = 14:00 UTC — after that day's open.
      const ts = nextOpenInstant(new Date("2026-05-21T14:00:00Z"));
      // Next session is Fri 2026-05-22, 9:30 AM EDT = 13:30 UTC.
      expect(new Date(ts * 1000).toISOString()).to.equal(
        "2026-05-22T13:30:00.000Z"
      );
    });

    it("skips the weekend to Monday's open", () => {
      // Sat 2026-05-23, midday — board is dark all weekend.
      const ts = nextOpenInstant(new Date("2026-05-23T16:00:00Z"));
      // Next session is Mon 2026-05-25 (Memorial Day is the *next* Monday, 5/25 is... a holiday!)
      // 2026-05-25 is Memorial Day (last Mon May), so the next open is Tue 2026-05-26.
      expect(new Date(ts * 1000).toISOString()).to.equal(
        "2026-05-26T13:30:00.000Z"
      );
    });

    it("skips a holiday to the following session", () => {
      // Christmas 2026-12-25 (Fri holiday) at any time → next session Mon 2026-12-28.
      const ts = nextOpenInstant(new Date("2026-12-25T16:00:00Z"));
      // 9:30 AM EST (UTC-5) = 14:30 UTC.
      expect(new Date(ts * 1000).toISOString()).to.equal(
        "2026-12-28T14:30:00.000Z"
      );
    });

    it("opens half-days at 9:30 AM too (only the close is early)", () => {
      // Black Friday 2026-11-27 at 7:00 AM EST = 12:00 UTC, before the open.
      const ts = nextOpenInstant(new Date("2026-11-27T12:00:00Z"));
      // 9:30 AM EST = 14:30 UTC; the early close is the half-day, not the open.
      expect(new Date(ts * 1000).toISOString()).to.equal(
        "2026-11-27T14:30:00.000Z"
      );
    });

    it("returns whole unix seconds", () => {
      const ts = nextOpenInstant(new Date("2026-05-21T11:00:00Z"));
      expect(Number.isInteger(ts)).to.be.true;
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
