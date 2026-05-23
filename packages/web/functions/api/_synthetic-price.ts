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

/** One sample in a synthetic intraday session series. */
export interface SessionPoint {
  /** Fraction through the session, 0..1 (the curve point's `t`). */
  t: number;
  /** Unix seconds for this sample, mapped onto the real compressed window. */
  timestamp: number;
  /** Absolute price = open × (1 + d). */
  close: number;
}

/**
 * Build the whole session series in one shot from a day's curve, so a chart can render the
 * complete intraday path without polling. Each curve point becomes a `{t, timestamp, close}`
 * sample; timestamps are spread across the compressed window `[tradingDay − synthDay, tradingDay]`
 * by each point's `t`. Points beyond the current `progress` are still returned (they're the
 * deterministic future path); callers mark the live point via {@link liveIndexForProgress}.
 */
export function sessionSeries(
  open: number,
  points: CurvePoint[],
  tradingDay: number,
  synthDaySeconds: number
): SessionPoint[] {
  const start = tradingDay - synthDaySeconds;
  return points.map((p) => ({
    t: p.t,
    timestamp: Math.round(start + p.t * synthDaySeconds),
    close: open * (1 + p.d),
  }));
}

/**
 * Index of the last session point at or before `progress` — i.e. "where we are now" in the
 * session. Returns the final index when the session is complete, 0 before it starts.
 */
export function liveIndexForProgress(
  points: CurvePoint[],
  progress: number
): number {
  if (points.length === 0) return 0;
  let idx = 0;
  for (let i = 0; i < points.length; i++) {
    if (points[i].t <= progress) idx = i;
    else break;
  }
  return idx;
}
