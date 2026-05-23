#!/usr/bin/env node
/**
 * One-off generator for the synthetic-price intraday curve dataset.
 *
 * Pulls real 5-minute intraday bars from Yahoo's keyless chart endpoint for each MAG7 ticker,
 * splits them by trading day (US/Eastern), converts each day to a **%-from-day-open** path, and
 * downsamples to ~24 points/day. The result is committed as
 * `packages/web/functions/api/_intraday-curves.json` and replayed at runtime by the
 * `/api/price` Pages Function — so the function never calls Yahoo for intraday data and the
 * synthetic prices are deterministic + offline.
 *
 * Relative deltas only (e.g. d: 0.013 = +1.3% from that day's open), so a curve replays onto
 * whatever open price a market was seeded at. Re-run to refresh; commit the output.
 *
 *   node scripts/fetch-intraday-curves.mjs               # all MAG7, ~5 trading days each
 *   SYMBOLS=NVDA,META DAYS=8 node scripts/fetch-intraday-curves.mjs
 */
import { writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ALL = ["AAPL", "MSFT", "GOOGL", "AMZN", "NVDA", "META", "TSLA"];
const SYMBOLS =
  process.env.SYMBOLS?.split(",").map((s) => s.trim().toUpperCase()) ?? ALL;
const RANGE = process.env.RANGE ?? "1mo"; // how far back to pull (Yahoo caps 5m to ~1mo)
const POINTS_PER_DAY = Number(process.env.POINTS_PER_DAY ?? 24);
const MAX_DAYS = Number(process.env.DAYS ?? 6); // keep the newest N complete days per symbol
const YAHOO = "https://query1.finance.yahoo.com/v8/finance/chart";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(
  __dirname,
  "..",
  "packages",
  "web",
  "functions",
  "api",
  "_intraday-curves.json"
);

const round4 = (n) => Math.round(n * 1e4) / 1e4;

/** ET calendar day (YYYY-MM-DD) for a unix-seconds timestamp. */
function etDay(unixSec) {
  // en-CA gives YYYY-MM-DD; timeZone pins it to the exchange day regardless of host TZ.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(unixSec * 1000));
}

/** Pull 5-minute bars and group into per-day [{t,open,closeLike}] in time order. */
async function fetchBars(symbol) {
  const url = `${YAHOO}/${symbol}?range=${RANGE}&interval=5m`;
  const res = await fetch(url, {
    headers: { "user-agent": "Mozilla/5.0 (Meridian curves)" },
  });
  if (!res.ok) throw new Error(`${symbol}: upstream ${res.status}`);
  const r = (await res.json())?.chart?.result?.[0];
  const stamps = r?.timestamp ?? [];
  const q = r?.indicators?.quote?.[0] ?? {};
  const opens = q.open ?? [];
  const closes = q.close ?? [];

  const byDay = new Map(); // day -> [{ ts, price }]
  for (let i = 0; i < stamps.length; i++) {
    // Use the bar's close (fall back to open) as the price at that minute.
    const price = Number.isFinite(closes[i]) ? closes[i] : opens[i];
    if (!Number.isFinite(price)) continue;
    const day = etDay(stamps[i]);
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day).push({ ts: stamps[i], price });
  }
  return byDay;
}

/** Convert one day's bars to a downsampled %-from-open curve: [{t, d}] with t,0..1. */
function toCurve(bars) {
  if (bars.length < 10) return null; // skip thin/partial days
  bars.sort((a, b) => a.ts - b.ts);
  const open = bars[0].price;
  if (!(open > 0)) return null;
  const first = bars[0].ts;
  const span = bars[bars.length - 1].ts - first || 1;

  // Resample to POINTS_PER_DAY evenly spaced points over [0,1] by nearest bar.
  const curve = [];
  for (let k = 0; k < POINTS_PER_DAY; k++) {
    const t = k / (POINTS_PER_DAY - 1);
    const target = first + t * span;
    // nearest bar to target time
    let best = bars[0];
    let bestDist = Infinity;
    for (const b of bars) {
      const dist = Math.abs(b.ts - target);
      if (dist < bestDist) {
        bestDist = dist;
        best = b;
      }
    }
    curve.push({ t: round4(t), d: round4(best.price / open - 1) });
  }
  // Force exact endpoints (t=0 → open → d=0).
  curve[0] = { t: 0, d: 0 };
  curve[curve.length - 1].t = 1;
  return curve;
}

async function main() {
  const dataset = {};
  for (const symbol of SYMBOLS) {
    try {
      const byDay = await fetchBars(symbol);
      const days = [...byDay.keys()].sort(); // ascending
      const curves = [];
      for (const day of days) {
        const curve = toCurve(byDay.get(day));
        if (curve) curves.push({ day, points: curve });
      }
      const kept = curves.slice(-MAX_DAYS); // newest N complete days
      if (kept.length === 0) {
        console.warn(`! ${symbol}: no complete days — skipped`);
        continue;
      }
      dataset[symbol] = kept;
      const last = kept[kept.length - 1].points;
      const endPct = (last[last.length - 1].d * 100).toFixed(2);
      console.log(
        `✓ ${symbol}: ${kept.length} day(s), ${POINTS_PER_DAY} pts each (last day close ${endPct}% from open)`
      );
    } catch (e) {
      console.warn(`! ${symbol}: ${e instanceof Error ? e.message : e}`);
    }
  }

  if (Object.keys(dataset).length === 0) {
    console.error("No curves fetched; not writing.");
    process.exit(1);
  }
  const body = {
    generatedAt: new Date().toISOString(),
    note: "Real intraday %-from-open curves (relative deltas). Replayed by /api/price. Regenerate with scripts/fetch-intraday-curves.mjs.",
    pointsPerDay: POINTS_PER_DAY,
    curves: dataset,
  };
  writeFileSync(OUT, JSON.stringify(body, null, 2) + "\n");
  console.log(`\nWrote ${OUT}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
