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
        <div className="text-xs uppercase tracking-widest text-accent">
          Today's verdicts
        </div>
        <h1 className="mt-2 font-serif text-3xl tracking-tight text-fg">
          Will it close above the line?
        </h1>
        <p className="mt-1 max-w-2xl text-fg-dim">
          Seven stocks, one question each. Take a side on where they close — open
          a stock for its full strike ladder, depth, and live order book.
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
