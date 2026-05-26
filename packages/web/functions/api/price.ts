/**
 * Cloudflare Pages Function: GET /api/price?symbol=NVDA&tradingDay=<unix-seconds>
 *
 * Returns a live quote for the symbol. Two sources, chosen by the `PRICE_SOURCE` env binding:
 *
 *   - "pyth" (default): the real Pyth Hermes feed for the equity — the same source the morning
 *     and settlement jobs use, so the UI shows what the chain will settle on. Fails soft to
 *     the synthetic source if Hermes is unreachable / stale, so the page never breaks.
 *   - "synthetic": a deterministic intraday price replayed from a committed prior-day curve.
 *     Useful for local/dev so the bots see movement off-hours. Curve is a pure function of
 *     (symbol, tradingDay, now), so every caller in the same time-bucket gets the same value.
 *
 * Shared (both sources):
 *   - `open` (the day's reference) comes from Yahoo, same call /api/history uses.
 *   - Response shape: { symbol, price, open, pctFromOpen, asOf, source, … }.
 *   - Short edge cache (CACHE_SECONDS) so a tick of bots agree and we don't hammer Hermes.
 */

import dataset from "./_intraday-curves.json";
import {
  curveIndexForDay,
  sessionProgress,
  syntheticPrice,
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

/**
 * Pyth Hermes feed ids for the seven MAG7 equities — the plain `<SYM>/USD` variants (RTH,
 * 4:00 PM ET close), matching what the on-chain `Config.tickers[].feed_id` is bootstrapped
 * with. See ARCHITECTURE ADR-004; the canonical list lives in memory `pyth-feed-ids-mag7`.
 * Outside regular market hours these feeds go stale (last close → no new updates).
 */
const PYTH_FEED_IDS: Record<string, string> = {
  AAPL: "49f6b65cb1de6b10eaf75e7c03ca029c306d0357e91b5311b175084a5ad55688",
  MSFT: "d0ca23c1cc005e004ccf1db5bf76aeb6a49218f43dac3d4b275e92de12ded4d1",
  GOOGL: "5a48c03e9b9cb337801073ed9d166817473697efff0d138874e0f6a33d6d5aa6",
  AMZN: "b5d0e0fa58a1f8b81498ae670ce93c872d14434b72c364885d4fa1b257cbb07a",
  NVDA: "b1073854ed24cbc755dc527418f52b7d271f6cc967bbf8d8129112b18860a593",
  META: "78a3e3b8e676a8f73c439f5d749737034b139bbbe899ba5775216fba596607fe",
  TSLA: "16dad506d7db8da01c87581c87ca897a012a153557d4d578c3b9c9e1bc0632f1",
};

const HERMES_URL = "https://hermes.pyth.network";
const YAHOO = "https://query1.finance.yahoo.com/v8/finance/chart";
const DEFAULT_SYNTH_DAY_SECONDS = 5400; // 90-minute compressed trading day
// The price is a step function quantized to this window: all callers within the same bucket get
// the identical price, and it's also the edge-cache TTL. Small enough to feel live, large enough
// that every bot in a tick agrees.
const CACHE_SECONDS = 5;

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
  /** "pyth" (default) — real Hermes feed; "synthetic" — deterministic replay curve. */
  PRICE_SOURCE?: string;
}

/**
 * Latest Pyth Hermes quote for one feed. Hermes encodes the price as an integer + exponent
 * (`price.price` is a signed int string, `price.expo` is negative), so the real value is
 * `price * 10^expo`. `publish_time` is the seconds-since-epoch when Pyth publishers signed.
 */
interface HermesQuote {
  price: number;
  publishTime: number;
}

/**
 * Fetch the latest Pyth price for `symbol` from the public Hermes REST endpoint. Returns
 * null on any failure (network, non-2xx, malformed payload) so the caller can fall back to
 * the synthetic source instead of breaking the page.
 */
async function fetchHermesPrice(symbol: string): Promise<HermesQuote | null> {
  const feedId = PYTH_FEED_IDS[symbol];
  if (!feedId) return null;
  const url = `${HERMES_URL}/v2/updates/price/latest?ids[]=${feedId}`;
  try {
    const res = await fetch(url, {
      headers: { accept: "application/json" },
      // Hermes is fine with a short edge cache — every caller in the same CACHE_SECONDS
      // bucket sees the same quote, same property the synthetic source relied on.
      cf: { cacheTtl: CACHE_SECONDS, cacheEverything: true },
    });
    if (!res.ok) return null;
    const body = (await res.json()) as {
      parsed?: Array<{
        price?: { price?: string; expo?: number; publish_time?: number };
      }>;
    };
    const parsed = body.parsed?.[0]?.price;
    if (
      !parsed ||
      typeof parsed.price !== "string" ||
      typeof parsed.expo !== "number" ||
      typeof parsed.publish_time !== "number"
    ) {
      return null;
    }
    const raw = Number(parsed.price);
    if (!Number.isFinite(raw)) return null;
    const price = raw * Math.pow(10, parsed.expo);
    if (!Number.isFinite(price) || price <= 0) return null;
    return { price, publishTime: parsed.publish_time };
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

/** Fetch the symbol's most-recent real close as the day's open/reference. */
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

  // The day's reference open is real-data either way (Yahoo, same as /api/history). If it's
  // unavailable, both sources are unusable, so 502 here as before.
  const open = await fetchOpen(symbol);
  if (open === null)
    return json({ error: `no reference price for ${symbol}` }, 502);

  const source =
    (env.PRICE_SOURCE ?? "pyth").toLowerCase() === "synthetic"
      ? "synthetic"
      : "pyth";

  // Default path: real Pyth quote. On any failure (network, malformed, off-hours stale-and-
  // missing) fall back to the synthetic curve so the UI never shows a hole.
  if (source === "pyth") {
    const quote = await fetchHermesPrice(symbol);
    if (quote !== null) {
      const pctFromOpen = quote.price / open - 1;
      return json(
        {
          symbol,
          price: round4(quote.price),
          open: round4(open),
          pctFromOpen: round4(pctFromOpen),
          source: "pyth",
          publishTime: quote.publishTime,
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
  if (!curve) return json({ error: `no curve data for ${symbol}` }, 404);

  // progress 0→1 over the compressed window [tradingDay − synthDay, tradingDay], quantized to
  // CACHE_SECONDS buckets so EVERY caller in the same bucket computes the exact same value (all
  // bots agree). Without quantizing, two bots calling ms apart drift — defeating the point.
  const progress = sessionProgress(
    Date.now() / 1000,
    tradingDay,
    synthDaySeconds,
    CACHE_SECONDS
  );
  const price = syntheticPrice(open, curve, progress);
  const pctFromOpen = price / open - 1;

  return json(
    {
      symbol,
      price: round4(price),
      open: round4(open),
      pctFromOpen: round4(pctFromOpen),
      progress: round4(progress),
      synthDaySeconds,
      source: source === "pyth" ? "synthetic-fallback" : "synthetic",
      asOf: new Date().toISOString(),
    },
    200,
    CACHE_SECONDS
  );
};
