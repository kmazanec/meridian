/**
 * Cloudflare Pages Function: GET /api/history?symbol=NVDA
 *
 * Returns the last ~30 trading days of daily closes for one of the seven supported
 * stocks, as `[{ date: "YYYY-MM-DD", close: number }]`. It proxies a public market-data
 * source (Yahoo Finance's keyless chart endpoint) *server-side*, because that source
 * sends no CORS headers and so cannot be called from the browser directly. This keeps the
 * frontend a pure static SPA: the function deploys alongside the static `out/` from the
 * same `wrangler pages deploy` (run from packages/web so `functions/` is bundled).
 *
 * The response is cached at the edge (closes change once per trading day) and the symbol
 * is validated against an allow-list so the proxy can't be pointed at arbitrary tickers.
 */

// Allowed tickers (mirrors the SDK's TICKER_SYMBOLS; inlined so the edge bundle is
// self-contained and doesn't pull the SDK into the Functions build).
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
// Daily closes for the last month. `interval=1d` → one point per trading day.
const RANGE = "1mo";
const INTERVAL = "1d";

interface YahooChart {
  chart?: {
    result?: Array<{
      timestamp?: number[];
      indicators?: { quote?: Array<{ close?: Array<number | null> }> };
    }>;
    error?: unknown;
  };
}

interface ClosePoint {
  date: string;
  close: number;
}

function json(body: unknown, status: number, cacheSeconds = 0): Response {
  const headers: Record<string, string> = {
    "content-type": "application/json; charset=utf-8",
  };
  if (cacheSeconds > 0) {
    headers["cache-control"] = `public, max-age=${cacheSeconds}`;
  }
  return new Response(JSON.stringify(body), { status, headers });
}

/** Map a Yahoo chart payload to ascending daily closes, dropping incomplete days. */
function toClosePoints(data: YahooChart): ClosePoint[] {
  const result = data.chart?.result?.[0];
  const stamps = result?.timestamp ?? [];
  const closes = result?.indicators?.quote?.[0]?.close ?? [];
  const out: ClosePoint[] = [];
  for (let i = 0; i < stamps.length; i++) {
    const close = closes[i];
    if (typeof close !== "number" || !Number.isFinite(close)) continue;
    const date = new Date(stamps[i] * 1000).toISOString().slice(0, 10);
    out.push({ date, close: Math.round(close * 100) / 100 });
  }
  return out;
}

export const onRequestGet: PagesFunction = async ({ request }) => {
  const url = new URL(request.url);
  const symbol = (url.searchParams.get("symbol") ?? "").toUpperCase();

  if (!ALLOWED.has(symbol)) {
    return json({ error: "unsupported symbol" }, 400);
  }

  try {
    const upstream = await fetch(
      `${YAHOO}/${symbol}?range=${RANGE}&interval=${INTERVAL}`,
      {
        // A UA avoids occasional bot rejections; cf cache dedupes upstream calls.
        headers: { "user-agent": "Mozilla/5.0 (Meridian markets)" },
        cf: { cacheTtl: 3600, cacheEverything: true },
      }
    );
    if (!upstream.ok) {
      return json({ error: `upstream ${upstream.status}` }, 502);
    }
    const points = toClosePoints((await upstream.json()) as YahooChart);
    // Cache successful results for an hour at the edge and in the browser.
    return json(points, 200, 3600);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "fetch failed" }, 502);
  }
};
