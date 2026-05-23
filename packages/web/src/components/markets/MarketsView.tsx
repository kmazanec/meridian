"use client";

import { useState } from "react";
import { Ticker } from "@meridian/sdk";
import type { TickerView } from "@/lib/marketStats";
import { MarketCard } from "./MarketCard";

/**
 * The Markets grid: all 7 MAG7 stocks as expandable cards. Each card summarizes its
 * stock (live Yes price, implied probability, a close-price sparkline, open interest,
 * settlement countdown) and expands to a full strike ladder. Presentational — the per-
 * ticker {@link TickerView} models are derived upstream — but it owns one piece of view
 * state: which ticker is expanded (one at a time).
 */
export function MarketsView({ tickers }: { tickers: TickerView[] }) {
  const [expanded, setExpanded] = useState<Ticker | null>(null);

  return (
    <div>
      <header className="mb-6">
        <h1 className="font-serif text-3xl text-fg">Markets</h1>
        <p className="mt-1 text-fg-dim">
          Seven stocks. Will it close at or above the strike today? Expand a stock
          for its full strike ladder, depth, and settlement history.
        </p>
      </header>

      <div className="grid grid-cols-1 items-start gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {tickers.map((view) => (
          <MarketCard
            key={view.symbol}
            view={view}
            expanded={expanded === view.ticker}
            onToggle={() =>
              setExpanded((cur) => (cur === view.ticker ? null : view.ticker))
            }
          />
        ))}
      </div>
    </div>
  );
}
