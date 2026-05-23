"use client";

import { useEffect, useState } from "react";

/**
 * Last-N-days closing prices for a stock, served by the Cloudflare Pages Function at
 * `/api/history?symbol=XXX` (which proxies a public market-data source server-side —
 * the browser can't call it directly because of CORS). Closes change once per day, so
 * results are cached per symbol for the session and the hook degrades gracefully to
 * `null` whenever the endpoint is unavailable (e.g. under plain `next dev`, which serves
 * no Functions) — the sparkline simply renders its empty-state baseline.
 */

/** One trading day. `date` is ISO `YYYY-MM-DD`; prices in dollars. */
export interface ClosePoint {
  date: string;
  close: number;
  /** Day's opening price; omitted if the feed didn't report a finite value. */
  open?: number;
}

/** Base for the history endpoint. Same-origin in prod; overridable for local dev. */
const HISTORY_BASE = process.env.NEXT_PUBLIC_HISTORY_BASE ?? "";

/**
 * Parse the Pages Function payload into a clean, ascending-by-date `ClosePoint[]`.
 * Tolerant of nulls/non-finite closes (drops them) so a single bad row never blanks the
 * chart. Exported for unit testing without a network round-trip.
 */
export function parseHistory(json: unknown): ClosePoint[] {
  if (!Array.isArray(json)) return [];
  const out: ClosePoint[] = [];
  for (const row of json) {
    if (!row || typeof row !== "object") continue;
    const { date, close, open } = row as {
      date?: unknown;
      close?: unknown;
      open?: unknown;
    };
    if (typeof date !== "string") continue;
    if (typeof close !== "number" || !Number.isFinite(close)) continue;
    const point: ClosePoint = { date, close };
    if (typeof open === "number" && Number.isFinite(open)) point.open = open;
    out.push(point);
  }
  out.sort((a, b) => a.date.localeCompare(b.date));
  return out;
}

/** The latest day's spot: its close/open and the % change in close vs the prior day. */
export interface Spot {
  date: string;
  close: number;
  open: number | null;
  /** Close change vs the previous day's close, as a fraction (0.012 = +1.2%); null if N/A. */
  changePct: number | null;
}

/**
 * Derive the most recent spot (last close + open + day-over-day % change) from an
 * ascending `ClosePoint[]`. Returns null for empty history. Pure — unit-tested directly.
 */
export function spotFromHistory(points: ClosePoint[]): Spot | null {
  if (points.length === 0) return null;
  const last = points[points.length - 1];
  const prev = points.length >= 2 ? points[points.length - 2] : null;
  const changePct =
    prev && prev.close !== 0 ? (last.close - prev.close) / prev.close : null;
  return {
    date: last.date,
    close: last.close,
    open: last.open ?? null,
    changePct,
  };
}

// Session cache + in-flight dedupe, keyed by symbol — expand/collapse never refetches.
const cache = new Map<string, ClosePoint[]>();
const inFlight = new Map<string, Promise<ClosePoint[]>>();

async function loadHistory(symbol: string): Promise<ClosePoint[]> {
  const cached = cache.get(symbol);
  if (cached) return cached;
  const existing = inFlight.get(symbol);
  if (existing) return existing;

  const promise = (async () => {
    const res = await fetch(
      `${HISTORY_BASE}/api/history?symbol=${encodeURIComponent(symbol)}`
    );
    if (!res.ok) throw new Error(`history ${res.status}`);
    const points = parseHistory(await res.json());
    cache.set(symbol, points);
    return points;
  })();

  inFlight.set(symbol, promise);
  try {
    return await promise;
  } finally {
    inFlight.delete(symbol);
  }
}

export interface PriceHistory {
  data: ClosePoint[] | null;
  loading: boolean;
  error: Error | null;
}

/** Fetch (once, then cached) the last-N-days closes for `symbol`. */
export function usePriceHistory(symbol: string | null): PriceHistory {
  const [data, setData] = useState<ClosePoint[] | null>(
    symbol ? cache.get(symbol) ?? null : null
  );
  const [loading, setLoading] = useState(!!symbol && !cache.has(symbol ?? ""));
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!symbol) {
      setData(null);
      setLoading(false);
      return;
    }
    const cached = cache.get(symbol);
    if (cached) {
      setData(cached);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    loadHistory(symbol)
      .then((points) => {
        if (!cancelled) {
          setData(points);
          setError(null);
        }
      })
      .catch((e: unknown) => {
        // Endpoint missing/unreachable is expected in some envs — fail soft to null.
        if (!cancelled) {
          setData(null);
          setError(e instanceof Error ? e : new Error(String(e)));
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [symbol]);

  return { data, loading, error };
}
