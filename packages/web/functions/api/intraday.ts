/**
 * Cloudflare Pages Function: GET /api/intraday?symbol=NVDA&tradingDay=<unix-seconds>
 *
 * The **whole** synthetic intraday session in one response — the deterministic price path from
 * the day's open to its close — so the trade-page chart's "Day" view can render the complete
 * session without polling. It's the series companion to `/api/price` (which returns a single
 * live tick): same curve data, same open, same compressed-window math, just mapped across every
 * curve point instead of evaluated at one progress.
 *
 *   close[i] = open × (1 + curve(symbol, day)[i].d)
 *   timestamp[i] = (tradingDay − SYNTH_DAY_SECONDS) + curve[i].t × SYNTH_DAY_SECONDS
 *
 * `liveIndex` marks the last point at or before the current session progress, so the chart can
 * show "you are here" and dim the deterministic remainder. Synthetic/dev only: prod has no
 * intraday capture, so callers treat a 404 (no curve) as "Day view unavailable" and fall back to
 * the daily-close "Month" view. Symbol allow-listed like /api/history and /api/price.
 */

import dataset from "./_intraday-curves.json";
import {
  curveIndexForDay,
  liveIndexForProgress,
  sessionProgress,
  sessionSeries,
  type CurvePoint,
} from "./_synthetic-price";

const ALLOWED = new Set([
  "AAPL",
  "MSFT",
  "GOOGL",
  "AMZN",
  "NVDA",
  "META",
  "TSLA",
]);

const YAHOO = "https://query1.finance.yahoo.com/v8/finance/chart";
const DEFAULT_SYNTH_DAY_SECONDS = 5400; // 90-minute compressed trading day (matches /api/price)
// The live point advances only every CACHE_SECONDS; it's also the edge-cache TTL. The series
// itself is static for the day — only `liveIndex`/`progress` move — so a short cache is plenty.
const CACHE_SECONDS = 15;

interface DayCurve {
  day: string;
  points: CurvePoint[];
}
interface Dataset {
  pointsPerDay: number;
  curves: Record<string, DayCurve[]>;
}
const CURVES = dataset as unknown as Dataset;

interface Env {
  SYNTH_DAY_SECONDS?: string;
}

function json(body: unknown, status: number, cacheSeconds = 0): Response {
  const headers: Record<string, string> = {
    "content-type": "application/json; charset=utf-8",
  };
  if (cacheSeconds > 0)
    headers["cache-control"] = `public, max-age=${cacheSeconds}`;
  return new Response(JSON.stringify(body), { status, headers });
}

const round4 = (n: number) => Math.round(n * 1e4) / 1e4;

/** Fetch the symbol's most-recent real close as the day's open/reference (same as /api/price). */
async function fetchOpen(symbol: string): Promise<number | null> {
  const res = await fetch(`${YAHOO}/${symbol}?range=5d&interval=1d`, {
    headers: { "user-agent": "Mozilla/5.0 (Meridian price)" },
    cf: { cacheTtl: 3600, cacheEverything: true },
  });
  if (!res.ok) return null;
  const r = (await res.json()) as {
    chart?: {
      result?: Array<{
        indicators?: { quote?: Array<{ close?: Array<number | null> }> };
      }>;
    };
  };
  const closes = r.chart?.result?.[0]?.indicators?.quote?.[0]?.close ?? [];
  for (let i = closes.length - 1; i >= 0; i--) {
    const c = closes[i];
    if (typeof c === "number" && Number.isFinite(c) && c > 0) return c;
  }
  return null;
}

/** Deterministically pick one of the symbol's day-curves by the trading day's date. */
function pickCurve(symbol: string, tradingDay: number): CurvePoint[] | null {
  const days = CURVES.curves[symbol];
  if (!days || days.length === 0) return null;
  return days[curveIndexForDay(tradingDay, days.length)].points;
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const url = new URL(request.url);
  const symbol = (url.searchParams.get("symbol") ?? "").toUpperCase();
  const tradingDay = Number(url.searchParams.get("tradingDay"));

  if (!ALLOWED.has(symbol)) return json({ error: "unsupported symbol" }, 400);
  if (!Number.isFinite(tradingDay) || tradingDay <= 0) {
    return json({ error: "tradingDay (unix seconds) is required" }, 400);
  }

  const synthDaySeconds =
    Number(env.SYNTH_DAY_SECONDS) > 0
      ? Number(env.SYNTH_DAY_SECONDS)
      : DEFAULT_SYNTH_DAY_SECONDS;

  const curve = pickCurve(symbol, tradingDay);
  // No curve → no synthetic intraday for this symbol; callers fall back to the daily-close view.
  if (!curve) return json({ error: `no intraday data for ${symbol}` }, 404);

  const open = await fetchOpen(symbol);
  if (open === null)
    return json({ error: `no reference price for ${symbol}` }, 502);

  const progress = sessionProgress(
    Date.now() / 1000,
    tradingDay,
    synthDaySeconds,
    CACHE_SECONDS
  );
  const series = sessionSeries(open, curve, tradingDay, synthDaySeconds).map(
    (p) => ({ timestamp: p.timestamp, close: round4(p.close) })
  );

  return json(
    {
      symbol,
      open: round4(open),
      tradingDay,
      synthDaySeconds,
      progress: round4(progress),
      liveIndex: liveIndexForProgress(curve, progress),
      points: series,
      asOf: new Date().toISOString(),
    },
    200,
    CACHE_SECONDS
  );
};
