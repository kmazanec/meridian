/**
 * Pure math for the deterministic synthetic intraday price. Imported by the `/api/price` Pages
 * Function and unit-tested from the web vitest suite. Dependency-free and side-effect-free so it
 * runs identically on the Workers runtime and under Node/vitest. The `_` prefix keeps Pages from
 * treating this as a route.
 *
 *   price = open × (1 + interpolate(curve, progress))
 *
 * `progress` is 0→1 over a compressed window ending at the market's close, quantized to a tick
 * bucket so every caller within the same bucket computes the identical value (all bots agree).
 */

export interface CurvePoint {
  /** Fraction through the session, 0..1. */
  t: number;
  /** Fractional move from the day's open at time t (e.g. 0.013 = +1.3%). */
  d: number;
}

/**
 * Progress 0→1 over `[tradingDay − synthDaySeconds, tradingDay]`, with `nowSeconds` snapped
 * down to `tickSeconds` buckets so concurrent callers agree exactly. Clamped to [0,1].
 */
export function sessionProgress(
  nowSeconds: number,
  tradingDay: number,
  synthDaySeconds: number,
  tickSeconds: number
): number {
  const tick = tickSeconds > 0 ? tickSeconds : 1;
  const quantized = Math.floor(nowSeconds / tick) * tick;
  const start = tradingDay - synthDaySeconds;
  const p = (quantized - start) / synthDaySeconds;
  return Math.max(0, Math.min(1, p));
}

/** Linear-interpolate a %-from-open curve (ascending `t`) at progress `p` ∈ [0,1]. */
export function interpolateCurve(points: CurvePoint[], p: number): number {
  if (points.length === 0) return 0;
  if (p <= 0) return points[0].d;
  if (p >= 1) return points[points.length - 1].d;
  for (let i = 1; i < points.length; i++) {
    if (p <= points[i].t) {
      const a = points[i - 1];
      const b = points[i];
      const span = b.t - a.t || 1;
      const f = (p - a.t) / span;
      return a.d + f * (b.d - a.d);
    }
  }
  return points[points.length - 1].d;
}

/**
 * Deterministically pick a day-index into `dayCount` curves from the trading day's date, so a
 * given market session always replays the same curve.
 */
export function curveIndexForDay(tradingDay: number, dayCount: number): number {
  if (dayCount <= 0) return 0;
  const dayNum = Math.floor(tradingDay / 86400);
  return ((dayNum % dayCount) + dayCount) % dayCount;
}

/** The full synthetic price: open × (1 + interpolated %-from-open at progress). */
export function syntheticPrice(
  open: number,
  points: CurvePoint[],
  progress: number
): number {
  return open * (1 + interpolateCurve(points, progress));
}
