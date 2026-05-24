import type { MarketsBoardRow } from "@/lib/marketStats";
import { MarketsBoard } from "./MarketsBoard";

/**
 * The Markets page: a sortable board of all seven MAG7 stocks for opportunity discovery. Each
 * row leads with the live price + today's move, the nearest-the-money bet, and liquidity, and
 * expands inline to its full strike ladder — so a trader can scan where the action is and drill
 * into a specific strike without leaving the page. The trade page (`/trade/SYMBOL`) remains the
 * place to actually execute. Purely presentational — rows are derived upstream.
 */
export function MarketsView({ rows }: { rows: MarketsBoardRow[] }) {
  return (
    <div>
      <header className="mb-6">
        <div className="text-xs uppercase tracking-widest text-accent">
          Today's verdicts
        </div>
        <h1 className="mt-2 font-serif text-3xl tracking-tight text-fg">
          Where will they close?
        </h1>
        <p className="mt-1 max-w-2xl text-fg-dim">
          Seven stocks, one question each: does it close above the line? Scan
          the live prices, find the coin-flips, and open a stock for its full
          strike ladder and order book.
        </p>
      </header>

      <MarketsBoard rows={rows} />
    </div>
  );
}
