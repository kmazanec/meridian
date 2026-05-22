"use client";

import { useEffect, useState } from "react";
import { dualBook, fetchOrderBook } from "@meridian/sdk";
import { useProgram } from "./useProgram";
import { groupByTicker, type DiscoveredMarket } from "./discovery";
import { priceFromBook } from "./market-math";
import type { LivePrices } from "@/components/markets/MarketsView";

/**
 * A live Yes price per ticker for the Markets grid. There's one book per market, so
 * for each ticker we read the book of a single **representative open market** (the
 * median strike — closest to a coin-flip, usually the most liquid) and take its mid.
 * This bounds the Markets page to ~7 book reads instead of one per strike.
 */
export function useTickerPrices(markets: DiscoveredMarket[]): LivePrices {
  const program = useProgram();
  const [prices, setPrices] = useState<LivePrices>({});

  // A stable key so the effect only re-runs when the representative set changes.
  const reps = representativeMarkets(markets);
  const key = reps.map((m) => m.address.toBase58()).join(",");

  useEffect(() => {
    let cancelled = false;
    if (reps.length === 0) {
      setPrices({});
      return;
    }

    const load = () =>
      Promise.all(
        reps.map(async (m) => {
          const book = await fetchOrderBook(program, m.address);
          const price = book ? priceFromBook(dualBook(book).yes) : null;
          return [m.ticker, price] as const;
        })
      )
        .then((pairs) => {
          if (cancelled) return;
          const next: LivePrices = {};
          for (const [ticker, price] of pairs) {
            if (price) next[ticker] = price;
          }
          setPrices(next);
        })
        .catch(() => {
          // Prices are best-effort decoration; a transient RPC error just leaves the
          // last good prices in place rather than blanking the grid.
        });

    load();
    // Refresh on an interval so the Markets/Landing prices stay live for the session.
    const id = setInterval(load, PRICE_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [program, key]);

  return prices;
}

/** How often the Markets/Landing live prices refresh. */
const PRICE_POLL_MS = 15_000;

/** One representative open market per ticker: the median-strike open market. */
export function representativeMarkets(
  markets: DiscoveredMarket[]
): DiscoveredMarket[] {
  const byTicker = groupByTicker(markets);
  const reps: DiscoveredMarket[] = [];
  for (const [, list] of byTicker) {
    const open = list.filter((m) => m.state === "open");
    const pool = open.length > 0 ? open : list;
    if (pool.length === 0) continue;
    // `list` is already strike-sorted from discovery; the median is the middle.
    reps.push(pool[Math.floor(pool.length / 2)]);
  }
  return reps;
}
