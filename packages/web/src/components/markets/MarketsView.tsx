import Link from "next/link";
import BN from "bn.js";
import { Ticker, TICKER_SYMBOLS } from "@meridian/sdk";
import type { DiscoveredMarket } from "@/lib/discovery";
import { activeCount, groupByTicker } from "@/lib/discovery";
import { formatPrice, formatProbability } from "@/lib/format";
import { Panel, Price, cx } from "@/components/ui";

/** A live Yes price per ticker, keyed by ticker ordinal (from book mids upstream). */
export type LivePrices = Partial<Record<Ticker, BN>>;

/**
 * The Markets grid: all 7 MAG7 stocks, each with its live Yes price (implied
 * probability) and its count of active (open) contracts. Presentational — data is
 * passed in so it renders identically in tests and against live RPC.
 */
export function MarketsView({
  markets,
  prices,
  loading,
}: {
  markets: DiscoveredMarket[];
  prices: LivePrices;
  loading?: boolean;
}) {
  const grouped = groupByTicker(markets);

  return (
    <div>
      <header className="mb-6">
        <h1 className="font-serif text-3xl text-fg">Markets</h1>
        <p className="mt-1 text-fg-dim">
          Seven stocks. Will it close at or above the strike today?
        </p>
      </header>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {TICKER_SYMBOLS.map((symbol, ordinal) => {
          const ticker = ordinal as Ticker;
          const list = grouped.get(ticker) ?? [];
          const open = activeCount(list);
          const price = prices[ticker] ?? null;
          return (
            <Link
              key={symbol}
              href={`/trade/${symbol}`}
              aria-label={`Trade ${symbol}`}
            >
              <Panel className="transition-colors hover:border-line">
                <div className="flex items-baseline justify-between">
                  <span className="font-mono text-lg text-fg">{symbol}</span>
                  <span
                    className={cx(
                      "text-xs uppercase tracking-wide",
                      open > 0 ? "text-accent" : "text-fg-faint"
                    )}
                  >
                    {open} active
                  </span>
                </div>
                <div className="mt-4 flex items-end justify-between">
                  <div>
                    <div className="text-xs uppercase tracking-wide text-fg-faint">
                      Yes price
                    </div>
                    <Price tone="yes" className="text-2xl">
                      {price ? formatPrice(price) : loading ? "—" : "n/a"}
                    </Price>
                  </div>
                  <div className="text-right">
                    <div className="text-xs uppercase tracking-wide text-fg-faint">
                      Implied
                    </div>
                    <Price className="text-lg">
                      {price ? formatProbability(price) : "—"}
                    </Price>
                  </div>
                </div>
              </Panel>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
