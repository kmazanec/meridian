"use client";

import { useEffect, useState } from "react";

/**
 * The current trading day's intraday price path for a stock, served by the Cloudflare Pages
 * Function at `/api/intraday?symbol=XXX&tradingDay=<unix-seconds>`. The endpoint returns the
 * whole compressed session in one shot (deterministic synthetic curve), plus a `liveIndex`
 * marking how far the session has progressed; this hook re-fetches on an interval so that live
 * marker advances without a page reload.
 *
 * Synthetic/dev only by nature: production captures no intraday prices, so the endpoint 404s and
 * the hook degrades gracefully to `null` — the trade page treats that as "Day view unavailable"
 * and falls back to the daily-close "Month" view. Same soft-fail contract as {@link usePriceHistory}.
 */

/** One intraday sample. `timestamp` is unix seconds; `close` in dollars. */
export interface IntradayPoint {
  timestamp: number;
  close: number;
}

export interface IntradaySession {
  points: IntradayPoint[] | null;
  /** Index of the latest point at/before "now" — the live edge of the session. */
  liveIndex: number;
  /** Session progress 0..1 (0 before open, 1 at/after close). */
  progress: number;
  loading: boolean;
  error: Error | null;
}

/** Base for the intraday endpoint. Same-origin in prod; overridable for local dev. */
const INTRADAY_BASE = process.env.NEXT_PUBLIC_HISTORY_BASE ?? "";

/** How often to re-pull so the live marker advances through the (compressed) session. */
const REFRESH_MS = 30_000;

interface IntradayPayload {
  points: IntradayPoint[];
  liveIndex: number;
  progress: number;
}

/**
 * Parse the Pages Function payload into clean, ascending-by-timestamp points plus the live
 * index / progress. Tolerant of nulls/non-finite closes (drops them). Exported for unit testing
 * without a network round-trip.
 */
export function parseIntraday(json: unknown): IntradayPayload {
  const empty: IntradayPayload = { points: [], liveIndex: 0, progress: 0 };
  if (!json || typeof json !== "object") return empty;
  const obj = json as {
    points?: unknown;
    liveIndex?: unknown;
    progress?: unknown;
  };
  if (!Array.isArray(obj.points)) return empty;
  const points: IntradayPoint[] = [];
  for (const row of obj.points) {
    if (!row || typeof row !== "object") continue;
    const { timestamp, close } = row as {
      timestamp?: unknown;
      close?: unknown;
    };
    if (typeof timestamp !== "number" || !Number.isFinite(timestamp)) continue;
    if (typeof close !== "number" || !Number.isFinite(close)) continue;
    points.push({ timestamp, close });
  }
  points.sort((a, b) => a.timestamp - b.timestamp);
  const liveIndex =
    typeof obj.liveIndex === "number" && Number.isFinite(obj.liveIndex)
      ? Math.max(0, Math.min(points.length - 1, Math.round(obj.liveIndex)))
      : Math.max(0, points.length - 1);
  const progress =
    typeof obj.progress === "number" && Number.isFinite(obj.progress)
      ? Math.max(0, Math.min(1, obj.progress))
      : 0;
  return { points, liveIndex, progress };
}

async function loadIntraday(
  symbol: string,
  tradingDay: number
): Promise<IntradayPayload> {
  const res = await fetch(
    `${INTRADAY_BASE}/api/intraday?symbol=${encodeURIComponent(
      symbol
    )}&tradingDay=${tradingDay}`
  );
  if (!res.ok) throw new Error(`intraday ${res.status}`);
  return parseIntraday(await res.json());
}

/**
 * Fetch the current session's intraday path for `symbol` at the market's `tradingDay`
 * (unix seconds), re-pulling every {@link REFRESH_MS} so the live edge advances. Pass a null
 * symbol or tradingDay to disable (e.g. no open market) — the hook then reports empty/idle.
 */
export function useIntradaySession(
  symbol: string | null,
  tradingDay: number | null
): IntradaySession {
  const [state, setState] = useState<IntradaySession>({
    points: null,
    liveIndex: 0,
    progress: 0,
    loading: !!symbol && !!tradingDay,
    error: null,
  });

  useEffect(() => {
    if (!symbol || !tradingDay) {
      setState({
        points: null,
        liveIndex: 0,
        progress: 0,
        loading: false,
        error: null,
      });
      return;
    }

    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | null = null;

    const pull = (showLoading: boolean) => {
      if (showLoading) {
        setState((s) => ({ ...s, loading: true }));
      }
      loadIntraday(symbol, tradingDay)
        .then((p) => {
          if (cancelled) return;
          setState({
            points: p.points,
            liveIndex: p.liveIndex,
            progress: p.progress,
            loading: false,
            error: null,
          });
        })
        .catch((e: unknown) => {
          if (cancelled) return;
          // Endpoint missing/unreachable (e.g. prod has no intraday) — fail soft to null so
          // the caller can fall back to the daily-close view.
          setState({
            points: null,
            liveIndex: 0,
            progress: 0,
            loading: false,
            error: e instanceof Error ? e : new Error(String(e)),
          });
        });
    };

    pull(true);
    timer = setInterval(() => pull(false), REFRESH_MS);

    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
  }, [symbol, tradingDay]);

  return state;
}
