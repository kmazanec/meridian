"use client";

import { useState } from "react";
import { Outcome, tickerToSymbol } from "@meridian/sdk";
import { useLeaderboard } from "@/lib/useLeaderboard";
import { useChainData } from "@/lib/ChainDataProvider";
import {
  formatPrice,
  formatTradingDay,
  formatUsdc,
  shortKey,
} from "@/lib/format";
import { Panel, Button } from "@/components/ui";
import { groupByTradingDay } from "@/lib/discovery";
import { MarketDrilldown } from "./MarketDrilldown";
import type { LeaderboardRow } from "@/lib/leaderboard";
import type { DiscoveredMarket } from "@/lib/discovery";

/**
 * Market-wide trader leaderboard (admin observability). Ranks every discovered trader by
 * current net worth — wallet USDC + outcome-token value + collateral escrowed in resting
 * orders. No PnL column: an arbitrary wallet's starting capital is unknown on-chain, so we
 * rank by value held, not gain. Lazy: the heavy holder-discovery RPC runs only once expanded.
 */
export function LeaderboardPanel() {
  const [open, setOpen] = useState(false);
  const { data, loading, error, refresh } = useLeaderboard(open);

  return (
    <Panel>
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-serif text-xl text-fg">Trader leaderboard</h2>
          <p className="mt-1 text-sm text-fg-dim">
            Every trader ranked by net worth held (USDC + positions + escrowed
            orders). Market-wide, not limited to demo bots.
          </p>
        </div>
        <Button
          variant={open ? "ghost" : "accent"}
          onClick={() => setOpen((v) => !v)}
        >
          {open ? "Hide" : "Load leaderboard"}
        </Button>
      </div>

      {open && (
        <div className="mt-4">
          {error ? (
            <div className="text-no">
              Failed to load leaderboard: {error.message}{" "}
              <button className="underline" onClick={refresh}>
                retry
              </button>
            </div>
          ) : loading && !data ? (
            <p className="text-fg-dim">Scanning holders…</p>
          ) : data && data.length > 0 ? (
            <LeaderboardTable rows={data} />
          ) : (
            <p className="text-fg-dim">No traders found.</p>
          )}

          <MarketsList />
        </div>
      )}
    </Panel>
  );
}

/** Markets grouped by trading day; each market expands to its top holders + book depth. */
function MarketsList() {
  const { markets } = useChainData();
  const [expanded, setExpanded] = useState<string | null>(null);
  const rows = markets.data ?? [];
  if (rows.length === 0) return null;
  const groups = groupByTradingDay(rows);

  return (
    <div className="mt-6">
      <h3 className="mb-2 font-serif text-lg text-fg">Markets by day</h3>
      <div className="space-y-4">
        {groups.map((g) => {
          const openCount = g.markets.filter((m) => m.state === "open").length;
          return (
            <div key={g.dayKey}>
              <div className="mb-1 flex items-baseline gap-2">
                <h4 className="text-sm font-medium text-fg">
                  {formatTradingDay(g.tradingDay)}
                </h4>
                <span className="text-xs text-fg-faint">
                  {g.markets.length} market{g.markets.length === 1 ? "" : "s"}
                  {openCount > 0 && ` · ${openCount} open`}
                </span>
              </div>
              <div className="divide-y divide-line/40 rounded border border-line/40">
                {g.markets.map((m) => (
                  <MarketRow
                    key={m.address.toBase58()}
                    market={m}
                    expanded={expanded === m.address.toBase58()}
                    onToggle={() =>
                      setExpanded((cur) =>
                        cur === m.address.toBase58()
                          ? null
                          : m.address.toBase58()
                      )
                    }
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function MarketRow({
  market: m,
  expanded,
  onToggle,
}: {
  market: DiscoveredMarket;
  expanded: boolean;
  onToggle: () => void;
}) {
  const settled = m.state === "settled";
  return (
    <div>
      <button
        className="flex w-full items-center gap-3 px-3 py-2 text-left text-sm hover:bg-bg-soft/40"
        onClick={onToggle}
      >
        <span className="text-fg-faint">{expanded ? "▾" : "▸"}</span>
        <span className="font-medium text-fg">
          {tickerToSymbol(m.ticker)} {formatPrice(m.strike)}
        </span>
        <span
          className={`ml-auto text-xs ${settled ? "text-fg-dim" : "text-yes"}`}
        >
          {settled
            ? m.outcome === Outcome.YesWins
              ? "YES won"
              : m.outcome === Outcome.NoWins
              ? "NO won"
              : "settled"
            : "open"}
        </span>
      </button>
      {expanded && <MarketDrilldown market={m} />}
    </div>
  );
}

function LeaderboardTable({ rows }: { rows: LeaderboardRow[] }) {
  const anyUnpriceable = rows.some((r) => r.unpriceableCount > 0);
  return (
    <div>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs uppercase tracking-wide text-fg-faint">
            <th className="py-1 pr-2">#</th>
            <th className="py-1 pr-2">Wallet</th>
            <th className="py-1 pr-2 text-right">Net worth</th>
            <th className="py-1 pr-2 text-right">USDC</th>
            <th className="py-1 pr-2 text-right">Positions</th>
            <th className="py-1 pr-2 text-right">In orders</th>
            <th className="py-1 pr-2 text-right">Orders</th>
          </tr>
        </thead>
        <tbody className="stat-mono">
          {rows.map((r, i) => (
            <tr key={r.owner} className="border-t border-line/40">
              <td className="py-1 pr-2 text-fg-faint">{i + 1}</td>
              <td className="py-1 pr-2">
                {shortKey(r.owner)}
                {r.unpriceableCount > 0 && (
                  <span
                    className="ml-1 text-fg-faint"
                    title="Open positions with no book mark, excluded from net"
                  >
                    *
                  </span>
                )}
              </td>
              <td className="py-1 pr-2 text-right text-fg">
                {formatUsdc(r.net)}
              </td>
              <td className="py-1 pr-2 text-right text-usdc">
                {formatUsdc(r.usdc)}
              </td>
              <td className="py-1 pr-2 text-right">
                {formatUsdc(r.tokenValue)}
              </td>
              <td className="py-1 pr-2 text-right">
                {formatUsdc(r.escrowValue)}
              </td>
              <td className="py-1 pr-2 text-right text-fg-dim">
                {r.openOrders}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-3 text-xs text-fg-faint">
        Top 20 holders per market side; long-tail holders excluded.
        {anyUnpriceable &&
          " * Some open positions had no book mark and are excluded from net worth."}
      </p>
    </div>
  );
}
