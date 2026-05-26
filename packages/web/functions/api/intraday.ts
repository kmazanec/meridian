/**
 * Cloudflare Pages Function: GET /api/intraday?symbol=NVDA&tradingDay=<unix-seconds>
 *
 * The current trading day's intraday price path. Two sources, chosen by `PRICE_SOURCE`:
 *
 *   - "pyth" (default): the real 5-minute bars for today from Yahoo (same source as
 *     `/api/history`), mapped to {timestamp, close}. `liveIndex` = the last real bar so the
 *     chart's "you are here" marker sits on actual data; `progress` is fraction-of-session
 *     using Yahoo's `currentTradingPeriod.regular` bounds (RTH 9:30 → 16:00 ET). On any
 *     failure (Yahoo unreachable, no bars yet at pre-open) we fall through to synthetic so
 *     the page never blanks.
 *   - "synthetic": the deterministic compressed-session replay (the original behavior). The
 *     whole curve from open to close evaluated up-front, with `liveIndex` at the cursor.
 *
 * Both sources answer with the same {symbol, points, liveIndex, progress, open, …} shape, plus
 * a `source` field so callers can tell at a glance which path served the request. Series
 * companion to `/api/price` (single live tick) — same `PRICE_SOURCE` toggle, same defaults.
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
  /** "pyth" (default) — Yahoo 1d/5m bars; "synthetic" — deterministic replay curve. */
  PRICE_SOURCE?: string;
}

/** One real 5-minute bar pulled from Yahoo's chart endpoint. */
interface RealBar {
  timestamp: number;
  close: number;
}

/** Fetch Yahoo's 1d/5m intraday bars + the regular-session window. Null on failure. */
async function fetchYahooIntraday(symbol: string): Promise<{
  bars: RealBar[];
  regularStart: number;
  regularEnd: number;
} | null> {
  try {
    const res = await fetch(`${YAHOO}/${symbol}?range=1d&interval=5m`, {
      headers: { "user-agent": "Mozilla/5.0 (Meridian intraday)" },
      // Match CACHE_SECONDS so the edge serves a tight tick from one upstream call.
      cf: { cacheTtl: CACHE_SECONDS, cacheEverything: true },
    });
    if (!res.ok) return null;
    const r = (await res.json()) as {
      chart?: {
        result?: Array<{
          timestamp?: number[];
          indicators?: { quote?: Array<{ close?: Array<number | null> }> };
          meta?: {
            currentTradingPeriod?: {
              regular?: { start?: number; end?: number };
            };
          };
        }>;
      };
    };
    const result = r.chart?.result?.[0];
    const timestamps = result?.timestamp;
    const closes = result?.indicators?.quote?.[0]?.close;
    const regular = result?.meta?.currentTradingPeriod?.regular;
    if (
      !Array.isArray(timestamps) ||
      !Array.isArray(closes) ||
      timestamps.length === 0 ||
      closes.length !== timestamps.length ||
      typeof regular?.start !== "number" ||
      typeof regular?.end !== "number"
    ) {
      return null;
    }
    const bars: RealBar[] = [];
    for (let i = 0; i < timestamps.length; i++) {
      const t = timestamps[i];
      const c = closes[i];
      if (typeof t !== "number" || !Number.isFinite(t)) continue;
      if (typeof c !== "number" || !Number.isFinite(c) || c <= 0) continue;
      bars.push({ timestamp: t, close: c });
    }
    if (bars.length === 0) return null;
    return { bars, regularStart: regular.start, regularEnd: regular.end };
  } catch {
    return null;
  }
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

/** Fetch today's regular-session open price from Yahoo's daily bars (same as /api/price). */
async function fetchOpen(symbol: string): Promise<number | null> {
  const res = await fetch(`${YAHOO}/${symbol}?range=5d&interval=1d`, {
    headers: { "user-agent": "Mozilla/5.0 (Meridian price)" },
    cf: { cacheTtl: 3600, cacheEverything: true },
  });
  if (!res.ok) return null;
  const r = (await res.json()) as {
    chart?: {
      result?: Array<{
        indicators?: { quote?: Array<{ open?: Array<number | null> }> };
      }>;
    };
  };
  const opens = r.chart?.result?.[0]?.indicators?.quote?.[0]?.open ?? [];
  for (let i = opens.length - 1; i >= 0; i--) {
    const o = opens[i];
    if (typeof o === "number" && Number.isFinite(o) && o > 0) return o;
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

  // The day's reference open is real-data either way (Yahoo daily; same as /api/history).
  const open = await fetchOpen(symbol);
  if (open === null)
    return json({ error: `no reference price for ${symbol}` }, 502);

  const source =
    (env.PRICE_SOURCE ?? "pyth").toLowerCase() === "synthetic"
      ? "synthetic"
      : "pyth";

  // Default path: real 5-minute bars from Yahoo for today. Pre-open / early session before
  // any bars exist → returns null and we fall through to the synthetic curve so the chart is
  // never empty during the demo.
  if (source === "pyth") {
    const yahoo = await fetchYahooIntraday(symbol);
    if (yahoo !== null) {
      const points = yahoo.bars.map((b) => ({
        timestamp: b.timestamp,
        close: round4(b.close),
      }));
      const span = yahoo.regularEnd - yahoo.regularStart;
      const now = Date.now() / 1000;
      const progress =
        span > 0
          ? Math.max(0, Math.min(1, (now - yahoo.regularStart) / span))
          : 0;
      return json(
        {
          symbol,
          open: round4(open),
          tradingDay,
          progress: round4(progress),
          // Real bars only go up to "now"; the last bar IS the live edge.
          liveIndex: points.length - 1,
          points,
          source: "pyth",
          regularStart: yahoo.regularStart,
          regularEnd: yahoo.regularEnd,
          asOf: new Date().toISOString(),
        },
        200,
        CACHE_SECONDS
      );
    }
    // fall through to synthetic
  }

  const synthDaySeconds =
    Number(env.SYNTH_DAY_SECONDS) > 0
      ? Number(env.SYNTH_DAY_SECONDS)
      : DEFAULT_SYNTH_DAY_SECONDS;

  const curve = pickCurve(symbol, tradingDay);
  // No curve → no synthetic intraday for this symbol; callers fall back to the daily-close view.
  if (!curve) return json({ error: `no intraday data for ${symbol}` }, 404);

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
      source: source === "pyth" ? "synthetic-fallback" : "synthetic",
      asOf: new Date().toISOString(),
    },
    200,
    CACHE_SECONDS
  );
};
