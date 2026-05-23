import type { TickerView } from "@/lib/marketStats";
import { MarketCard } from "./MarketCard";

/**
 * The Markets grid: all 7 MAG7 stocks as summary cards, each linking into its full detail +
 * trade page (`/trade/SYMBOL`) where the strike ladder, depth, and trading live. Each card
 * shows the live Yes price, implied probability, a close-price sparkline, open interest, and
 * a settlement countdown. Purely presentational — the per-ticker {@link TickerView} models
 * are derived upstream.
 */
export function MarketsView({ tickers }: { tickers: TickerView[] }) {
  return (
    <div>
      <header className="mb-6">
        <h1 className="font-serif text-3xl text-fg">Markets</h1>
        <p className="mt-1 text-fg-dim">
          Seven stocks. Will it close at or above the strike today? Open a stock
          for its full strike ladder, depth, and settlement history.
        </p>
      </header>

      <div className="grid grid-cols-1 items-start gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {tickers.map((view) => (
          <MarketCard key={view.symbol} view={view} />
        ))}
      </div>
    </div>
  );
}
