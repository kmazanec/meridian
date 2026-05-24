"use client";

import { Outcome, tickerToSymbol } from "@meridian/sdk";
import { useMarketDrilldown } from "@/lib/useLeaderboard";
import { formatPrice, formatTokens, formatUsdc, shortKey } from "@/lib/format";
import type { DiscoveredMarket } from "@/lib/discovery";

/**
 * Expanded view for one market: its top holders (YES/NO, ranked by stake value) and book
 * depth. Holders are fetched on expand; book stats come from the cached BookMap (no extra RPC).
 */
export function MarketDrilldown({ market }: { market: DiscoveredMarket }) {
  const { data, loading, error, refresh } = useMarketDrilldown(market);
  const symbol = tickerToSymbol(market.ticker);
  const outcomeLabel =
    market.state === "settled"
      ? market.outcome === Outcome.YesWins
        ? "YES won"
        : market.outcome === Outcome.NoWins
        ? "NO won"
        : "settled"
      : "open";

  return (
    <div className="border-t border-line/40 bg-bg-soft/40 px-3 py-3">
      <div className="mb-2 flex items-center gap-3 text-sm">
        <span className="font-medium text-fg">
          {symbol} {formatPrice(market.strike)}
        </span>
        <span className="text-fg-dim">{outcomeLabel}</span>
        {data && (
          <span className="ml-auto stat-mono text-xs text-fg-faint">
            bid {data.bestBid ? formatPrice(data.bestBid) : "—"} · ask{" "}
            {data.bestAsk ? formatPrice(data.bestAsk) : "—"} · depth{" "}
            {formatTokens(data.restingSize)}
          </span>
        )}
      </div>

      {error ? (
        <div className="text-no">
          Failed to load holders: {error.message}{" "}
          <button className="underline" onClick={refresh}>
            retry
          </button>
        </div>
      ) : loading && !data ? (
        <p className="text-fg-dim">Loading holders…</p>
      ) : data && data.holders.length > 0 ? (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-fg-faint">
              <th className="py-1 pr-2">Holder</th>
              <th className="py-1 pr-2">Side</th>
              <th className="py-1 pr-2 text-right">Tokens</th>
              <th className="py-1 pr-2 text-right">Value</th>
            </tr>
          </thead>
          <tbody className="stat-mono">
            {data.holders.map((h, i) => (
              <tr
                key={`${h.owner}-${h.side}-${i}`}
                className="border-t border-line/30"
              >
                <td className="py-1 pr-2">{shortKey(h.owner)}</td>
                <td
                  className={`py-1 pr-2 ${
                    h.side === "yes" ? "text-yes" : "text-no"
                  }`}
                >
                  {h.side.toUpperCase()}
                </td>
                <td className="py-1 pr-2 text-right">
                  {formatTokens(h.amount)}
                </td>
                <td className="py-1 pr-2 text-right text-fg">
                  {h.unpriceable ? "—" : formatUsdc(h.value)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="text-fg-dim">No holders found (top 20/side).</p>
      )}
    </div>
  );
}
