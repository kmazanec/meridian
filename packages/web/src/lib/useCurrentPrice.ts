"use client";

import { useEffect, useState } from "react";

/**
 * The stock's *current* price, served by the Cloudflare Pages Function at
 * `/api/price?symbol=XXX&tradingDay=<unix-seconds>`. Unlike the full intraday session
 * ({@link useIntradaySession}) or the daily-close history ({@link usePriceHistory}),
 * this is a single live quote — the lightest, always-available price. The trading bots
 * already consume the same endpoint, so the UI shows exactly the price bots trade against.
 *
 * The full multi-point intraday *history* may be unavailable (prod captures none), but a
 * current price always is; this hook re-pulls on an interval so the quote stays live. It
 * fails soft to `null` (same contract as the other price hooks) so callers can render a
 * "—" placeholder rather than break.
 */

export interface CurrentPrice {
  /** Current price in dollars, or null while loading / on failure. */
  price: number | null;
  /** The day's reference open in dollars, if reported. */
  open: number | null;
  /** Fractional change from open (0.012 = +1.2%); null if N/A. */
  pctFromOpen: number | null;
  loading: boolean;
  error: Error | null;
}

/** Base for the price endpoint. Same-origin in prod; overridable for local dev. */
const PRICE_BASE = process.env.NEXT_PUBLIC_HISTORY_BASE ?? "";

/** How often to re-pull so the quote stays live (the endpoint itself caches ~5s). */
const REFRESH_MS = 15_000;

interface PricePayload {
  price: number | null;
  open: number | null;
  pctFromOpen: number | null;
}

/**
 * Parse the Pages Function payload into a clean quote. Tolerant of missing/non-finite
 * fields (→ null). Exported for unit testing without a network round-trip.
 */
export function parseCurrentPrice(json: unknown): PricePayload {
  const empty: PricePayload = { price: null, open: null, pctFromOpen: null };
  if (!json || typeof json !== "object") return empty;
  const obj = json as {
    price?: unknown;
    open?: unknown;
    pctFromOpen?: unknown;
  };
  const num = (v: unknown): number | null =>
    typeof v === "number" && Number.isFinite(v) ? v : null;
  return {
    price: num(obj.price),
    open: num(obj.open),
    pctFromOpen: num(obj.pctFromOpen),
  };
}

async function loadCurrentPrice(
  symbol: string,
  tradingDay: number
): Promise<PricePayload> {
  const res = await fetch(
    `${PRICE_BASE}/api/price?symbol=${encodeURIComponent(
      symbol
    )}&tradingDay=${tradingDay}`
  );
  if (!res.ok) throw new Error(`price ${res.status}`);
  return parseCurrentPrice(await res.json());
}

/**
 * Fetch `symbol`'s current price at the market's `tradingDay` (unix seconds), re-pulling
 * every {@link REFRESH_MS}. Pass a null symbol or tradingDay to disable (e.g. no open
 * market) — the hook then reports an idle null quote.
 */
export function useCurrentPrice(
  symbol: string | null,
  tradingDay: number | null
): CurrentPrice {
  const [state, setState] = useState<CurrentPrice>({
    price: null,
    open: null,
    pctFromOpen: null,
    loading: !!symbol && !!tradingDay,
    error: null,
  });

  useEffect(() => {
    if (!symbol || !tradingDay) {
      setState({
        price: null,
        open: null,
        pctFromOpen: null,
        loading: false,
        error: null,
      });
      return;
    }

    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | null = null;

    const pull = (showLoading: boolean) => {
      if (showLoading) setState((s) => ({ ...s, loading: true }));
      loadCurrentPrice(symbol, tradingDay)
        .then((p) => {
          if (cancelled) return;
          setState({
            price: p.price,
            open: p.open,
            pctFromOpen: p.pctFromOpen,
            loading: false,
            error: null,
          });
        })
        .catch((e: unknown) => {
          if (cancelled) return;
          // Unreachable/unsupported — fail soft to null so the caller shows a placeholder.
          setState({
            price: null,
            open: null,
            pctFromOpen: null,
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
