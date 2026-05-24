import BN from "bn.js";
import { PRICE_SCALE } from "@meridian/sdk";

/**
 * Display formatting. The on-chain/SDK contract is integer base units (USDC 6dp,
 * prices in `[0, PRICE_SCALE]`); floats appear *only here*, for human-readable
 * output. No serialized math uses these.
 */

const PRICE_SCALE_NUM = PRICE_SCALE.toNumber();
const USDC_BASE = 1_000_000;

function toBN(v: BN | number | string): BN {
  return BN.isBN(v) ? v : new BN(v);
}

/** A price (integer in `[0, PRICE_SCALE]`) as a dollar string, e.g. `$0.65`. */
export function formatPrice(price: BN | number | string): string {
  const n = toBN(price).toNumber() / PRICE_SCALE_NUM;
  return `$${n.toFixed(2)}`;
}

/**
 * A price as an implied probability percentage, e.g. `65%`. The Yes price *is* the
 * market-implied probability the stock closes at/above the strike.
 */
export function formatProbability(price: BN | number | string): string {
  const pct = (toBN(price).toNumber() / PRICE_SCALE_NUM) * 100;
  return `${pct.toFixed(0)}%`;
}

/** USDC base units → dollar string with the given fraction digits (default 2). */
export function formatUsdc(
  baseUnits: BN | number | string,
  digits = 2
): string {
  const n = toBN(baseUnits).toNumber() / USDC_BASE;
  return `$${n.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })}`;
}

/** Token base units (6dp) → a plain token-count string, e.g. `1.5`. */
export function formatTokens(
  baseUnits: BN | number | string,
  digits = 2
): string {
  const n = toBN(baseUnits).toNumber() / USDC_BASE;
  return n.toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits,
  });
}

/** A signed USDC P&L, e.g. `+$0.40` / `-$0.10` (for portfolio rows). */
export function formatSignedUsdc(baseUnits: BN | number | string): string {
  const bn = toBN(baseUnits);
  const sign = bn.isNeg() ? "-" : "+";
  return `${sign}${formatUsdc(bn.abs())}`;
}

/** Short pubkey for display, e.g. `7xKX…9aQ2`. */
export function shortKey(key: { toBase58: () => string } | string): string {
  const s = typeof key === "string" ? key : key.toBase58();
  return s.length <= 10 ? s : `${s.slice(0, 4)}…${s.slice(-4)}`;
}

/**
 * `trading_day` is the 4:00 PM ET close *instant* (unix seconds). Both helpers below resolve it
 * in ET (`America/New_York`) so a market's day is stable regardless of the viewer's timezone —
 * important for grouping (a West-Coast viewer must bucket a market on the same day as the close).
 */

/** A stable, sortable ET date key for grouping, e.g. `2026-05-23`. */
export function tradingDayKey(tradingDay: BN | number): string {
  const ms = (typeof tradingDay === "number" ? tradingDay : tradingDay.toNumber()) * 1000;
  // en-CA gives ISO-ish YYYY-MM-DD, which sorts lexicographically = chronologically.
  return new Date(ms).toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

/** Human label for a trading day, e.g. `Thu, May 23` (ET). */
export function formatTradingDay(tradingDay: BN | number | null): string {
  if (tradingDay === null) return "—";
  const ms = (typeof tradingDay === "number" ? tradingDay : tradingDay.toNumber()) * 1000;
  return new Date(ms).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "America/New_York",
  });
}
