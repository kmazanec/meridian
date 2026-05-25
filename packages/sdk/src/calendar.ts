/**
 * US equity (NYSE/Nasdaq) market calendar.
 *
 * This module owns the *timing* concern that ADR-005 deliberately keeps off-chain: which
 * dates are trading sessions, and what unix timestamp a session's close corresponds to.
 * The on-chain program never reimplements a timezone/DST calendar — it does a single
 * integer comparison against `Market.trading_day`, which the morning job computes here as
 * the **4:00 PM ET close instant** (1:00 PM ET on half-days). See the F-04 settlement-
 * timing sub-contract (ROADMAP concern #2).
 *
 * DST correctness: rather than hand-code the US DST transition rules, the ET wall-clock →
 * unix conversion is derived from the platform's IANA `America/New_York` zone via `Intl`
 * (built into Node, no dependency). That is authoritative across DST boundaries and future
 * rule changes. Calendar/holiday dates are computed in ET terms so a run from any host
 * timezone resolves the same session.
 */

/** ET wall-clock pieces of a date, as the IANA `America/New_York` zone sees it. */
interface EtParts {
  year: number;
  month: number; // 1-12
  day: number; // 1-31
  /** 0 = Sunday … 6 = Saturday. */
  weekday: number;
}

const ET_ZONE = "America/New_York";

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

const etDateFormat = new Intl.DateTimeFormat("en-US", {
  timeZone: ET_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  weekday: "short",
});

/** Decompose an instant into ET calendar parts (the date *in New York*). */
export function etParts(date: Date): EtParts {
  const parts = etDateFormat.formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return {
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
    weekday: WEEKDAY_INDEX[get("weekday")] ?? 0,
  };
}

/** A date is on a weekend (in ET) — never a trading day. */
export function isWeekend(date: Date): boolean {
  const wd = etParts(date).weekday;
  return wd === 0 || wd === 6;
}

// ---------------------------------------------------------------------------
// Holiday computation (in ET calendar terms)
// ---------------------------------------------------------------------------

/** Weekday (0=Sun..6=Sat) of a given ET calendar date, via UTC noon to avoid DST edges. */
function weekdayOf(year: number, month: number, day: number): number {
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

/** The date (1-31) of the Nth given weekday in a month (e.g. 4th Thursday of November). */
function nthWeekdayOfMonth(
  year: number,
  month: number,
  weekday: number,
  n: number
): number {
  const firstWd = weekdayOf(year, month, 1);
  const offset = (weekday - firstWd + 7) % 7;
  return 1 + offset + (n - 1) * 7;
}

/** The date (1-31) of the last given weekday in a month (e.g. last Monday = Memorial Day). */
function lastWeekdayOfMonth(
  year: number,
  month: number,
  weekday: number
): number {
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const lastWd = weekdayOf(year, month, daysInMonth);
  const offset = (lastWd - weekday + 7) % 7;
  return daysInMonth - offset;
}

/**
 * Observed date of a *fixed-date* federal holiday: if it lands on Saturday it is observed
 * the preceding Friday; on Sunday, the following Monday. (This is how NYSE shifts fixed
 * holidays like New Year's Day, Juneteenth, Independence Day, and Christmas.)
 */
function observedFixed(
  year: number,
  month: number,
  day: number
): { month: number; day: number } {
  const wd = weekdayOf(year, month, day);
  if (wd === 6) {
    // Saturday → observed Friday (previous day). Handles month/day rollback.
    const dt = new Date(Date.UTC(year, month - 1, day - 1));
    return { month: dt.getUTCMonth() + 1, day: dt.getUTCDate() };
  }
  if (wd === 0) {
    // Sunday → observed Monday (next day).
    const dt = new Date(Date.UTC(year, month - 1, day + 1));
    return { month: dt.getUTCMonth() + 1, day: dt.getUTCDate() };
  }
  return { month, day };
}

/** Easter Sunday (Gregorian) by the Anonymous/Meeus algorithm; used for Good Friday. */
function easterSunday(year: number): { month: number; day: number } {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const dd = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - dd - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return { month, day };
}

/** Good Friday = two days before Easter Sunday. NYSE is closed; not a federal holiday. */
function goodFriday(year: number): { month: number; day: number } {
  const easter = easterSunday(year);
  const dt = new Date(Date.UTC(year, easter.month - 1, easter.day - 2));
  return { month: dt.getUTCMonth() + 1, day: dt.getUTCDate() };
}

/** The set of full-closure NYSE holidays for a year, as `"MM-DD"` ET keys. */
function holidayKeys(year: number): Set<string> {
  const key = (m: number, dd: number) =>
    `${String(m).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
  const fixed = (m: number, dd: number) => {
    const o = observedFixed(year, m, dd);
    return key(o.month, o.day);
  };
  const set = new Set<string>();
  // Fixed-date (with weekend observance):
  set.add(fixed(1, 1)); // New Year's Day
  set.add(fixed(6, 19)); // Juneteenth (NYSE holiday since 2022)
  set.add(fixed(7, 4)); // Independence Day
  set.add(fixed(12, 25)); // Christmas Day
  // Floating Monday/Thursday holidays (never need weekend observance):
  set.add(key(1, nthWeekdayOfMonth(year, 1, 1, 3))); // MLK Jr — 3rd Mon Jan
  set.add(key(2, nthWeekdayOfMonth(year, 2, 1, 3))); // Presidents' Day — 3rd Mon Feb
  set.add(key(5, lastWeekdayOfMonth(year, 5, 1))); // Memorial Day — last Mon May
  set.add(key(9, nthWeekdayOfMonth(year, 9, 1, 1))); // Labor Day — 1st Mon Sep
  set.add(key(11, nthWeekdayOfMonth(year, 11, 4, 4))); // Thanksgiving — 4th Thu Nov
  // Good Friday (movable):
  const gf = goodFriday(year);
  set.add(key(gf.month, gf.day));
  return set;
}

function mmddKey(p: EtParts): string {
  return `${String(p.month).padStart(2, "0")}-${String(p.day).padStart(
    2,
    "0"
  )}`;
}

/** True if the date is a full NYSE closure (weekend handled separately). */
export function isHoliday(date: Date): boolean {
  const p = etParts(date);
  return holidayKeys(p.year).has(mmddKey(p));
}

/**
 * True if the date is an early-close (1:00 PM ET) NYSE half-day:
 *   - the Friday after Thanksgiving,
 *   - July 3 when it is itself a trading day (the day before Independence Day),
 *   - December 24 (Christmas Eve) when it is a weekday.
 * (NYSE half-days vary slightly year to year; this covers the recurring three.)
 */
export function isHalfDay(date: Date): boolean {
  if (isWeekend(date) || isHoliday(date)) return false;
  const p = etParts(date);

  // Day after Thanksgiving (4th Thursday Nov + 1 = that Friday).
  const thanksgiving = nthWeekdayOfMonth(p.year, 11, 4, 4);
  if (p.month === 11 && p.day === thanksgiving + 1) return true;

  // July 3 (only meaningful as a trading day before July 4).
  if (p.month === 7 && p.day === 3) return true;

  // Christmas Eve.
  if (p.month === 12 && p.day === 24) return true;

  return false;
}

/** True if the date is a (full or half) trading session. */
export function isTradingDay(date: Date): boolean {
  return !isWeekend(date) && !isHoliday(date);
}

// ---------------------------------------------------------------------------
// ET wall-clock → unix (the close instant = Market.trading_day)
// ---------------------------------------------------------------------------

const etOffsetFormat = new Intl.DateTimeFormat("en-US", {
  timeZone: ET_ZONE,
  timeZoneName: "shortOffset",
});

/**
 * The ET UTC offset in minutes for an instant (e.g. -240 for EDT, -300 for EST), read
 * from the IANA zone via `Intl` so it is correct across DST without hard-coded rules.
 */
function etOffsetMinutes(date: Date): number {
  const tzName = etOffsetFormat
    .formatToParts(date)
    .find((p) => p.type === "timeZoneName")?.value;
  // tzName looks like "GMT-4" / "GMT-5" (or "GMT-04:00" on some platforms).
  const m = tzName?.match(/GMT([+-])(\d{1,2})(?::?(\d{2}))?/);
  if (!m) {
    throw new Error(`could not parse ET offset from "${tzName}"`);
  }
  const sign = m[1] === "-" ? -1 : 1;
  const hours = Number(m[2]);
  const minutes = Number(m[3] ?? "0");
  return sign * (hours * 60 + minutes);
}

/**
 * Unix timestamp (seconds) of an ET wall-clock time on a given ET calendar date.
 *
 * Computes the offset by first guessing UTC for the wall time, reading the ET offset at
 * that instant, then correcting once. A single correction is sufficient here because the
 * close (13:00 / 16:00 ET) is never within the 2 AM DST transition window, so the offset
 * is stable across the correction.
 */
function etWallClockToUnix(p: EtParts, hour: number, minute: number): number {
  const guessUtcMs = Date.UTC(p.year, p.month - 1, p.day, hour, minute, 0);
  const offsetMin = etOffsetMinutes(new Date(guessUtcMs));
  // Wall time is offset behind UTC: utc = wall - offset (offset is negative for ET).
  const utcMs = guessUtcMs - offsetMin * 60_000;
  return Math.floor(utcMs / 1000);
}

/**
 * The close instant for a date as a unix timestamp (seconds): 4:00 PM ET on a full
 * session, 1:00 PM ET on a half-day. This is the value passed to `create_strike_market`
 * as `Market.trading_day`. Throws if the date is not a trading session.
 */
export function closeInstant(date: Date): number {
  if (!isTradingDay(date)) {
    throw new Error(
      `${etParts(date).year}-${etParts(date).month}-${
        etParts(date).day
      } is not a trading session`
    );
  }
  const p = etParts(date);
  const half = isHalfDay(date);
  return etWallClockToUnix(p, half ? 13 : 16, 0);
}

/** The ET wall-clock opening bell: 9:30 AM ET (regular and half-days alike). */
const OPEN_HOUR = 9;
const OPEN_MINUTE = 30;

/** Advance an instant to ET midnight of the following calendar day (DST-safe via UTC noon). */
function nextEtDay(date: Date): Date {
  const p = etParts(date);
  // UTC noon of the *next* ET date is unambiguously inside that ET day across DST.
  return new Date(Date.UTC(p.year, p.month - 1, p.day + 1, 12, 0, 0));
}

/**
 * The next opening-bell instant (unix seconds) at or after `from`: 9:30 AM ET on the next
 * trading session. If `from` is during a trading day but before that day's 9:30 open, it
 * returns today's open; once the bell has rung (or on a closed date) it walks forward to the
 * next session's open, skipping weekends and NYSE holidays. The counterpart to
 * {@link closeInstant}: together they bracket a session, so the frontend can count down to
 * "trading opens" when the board is dark and to "settles" once it's live.
 */
export function nextOpenInstant(from: Date = new Date()): number {
  let cursor = from;
  for (let i = 0; i < 14; i++) {
    if (isTradingDay(cursor)) {
      const openTs = etWallClockToUnix(etParts(cursor), OPEN_HOUR, OPEN_MINUTE);
      // Only today's open counts if the bell hasn't rung yet relative to `from`.
      if (openTs * 1000 > from.getTime()) return openTs;
    }
    cursor = nextEtDay(cursor);
  }
  // 14 days is more than any NYSE holiday gap; reaching here means a calendar bug.
  throw new Error("no trading session found within 14 days");
}

/** A one-call summary of a date's session status. */
export interface SessionInfo {
  /** The ET calendar date as `YYYY-MM-DD`. */
  date: string;
  isTradingDay: boolean;
  isHalfDay: boolean;
  /** The close instant (unix seconds), or null if not a trading session. */
  closeInstant: number | null;
}

/** Summarize a date: trading-day/half-day flags and the close instant if applicable. */
export function sessionForDate(date: Date): SessionInfo {
  const p = etParts(date);
  const trading = isTradingDay(date);
  const half = trading && isHalfDay(date);
  return {
    date: `${p.year}-${String(p.month).padStart(2, "0")}-${String(
      p.day
    ).padStart(2, "0")}`,
    isTradingDay: trading,
    isHalfDay: half,
    closeInstant: trading ? closeInstant(date) : null,
  };
}
