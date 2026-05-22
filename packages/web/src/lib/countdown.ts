import BN from "bn.js";

/**
 * Settlement countdown. `Market.trading_day` is already the 4:00 PM ET close *instant*
 * as a unix timestamp (the program/automation own the DST-aware ET→unix conversion —
 * the frontend never reimplements a timezone calendar). So the countdown is just the
 * delta to that instant; this module only formats the remaining time.
 */

export interface Countdown {
  /** Whole seconds remaining (0 once past close). */
  totalSeconds: number;
  hours: number;
  minutes: number;
  seconds: number;
  /** True once `now >= tradingDay` — the market is at/after its close instant. */
  closed: boolean;
}

/** Compute the countdown from `nowMs` to the `tradingDay` close (unix seconds). */
export function countdownTo(
  tradingDay: BN | number,
  nowMs: number = Date.now()
): Countdown {
  const closeMs =
    (BN.isBN(tradingDay) ? tradingDay.toNumber() : tradingDay) * 1000;
  const remainingMs = closeMs - nowMs;
  if (remainingMs <= 0) {
    return { totalSeconds: 0, hours: 0, minutes: 0, seconds: 0, closed: true };
  }
  const totalSeconds = Math.floor(remainingMs / 1000);
  return {
    totalSeconds,
    hours: Math.floor(totalSeconds / 3600),
    minutes: Math.floor((totalSeconds % 3600) / 60),
    seconds: totalSeconds % 60,
    closed: false,
  };
}

/** Format a countdown as `HH:MM:SS`, or `Closed` once past the close. */
export function formatCountdown(c: Countdown): string {
  if (c.closed) return "Closed";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(c.hours)}:${pad(c.minutes)}:${pad(c.seconds)}`;
}
