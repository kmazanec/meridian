"use client";

import { useState } from "react";
import { useLeaderboard } from "@/lib/useLeaderboard";
import { formatUsdc, shortKey } from "@/lib/format";
import { Panel, Button } from "@/components/ui";
import type { LeaderboardRow } from "@/lib/leaderboard";

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
        </div>
      )}
    </Panel>
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
                  <span className="ml-1 text-fg-faint" title="Open positions with no book mark, excluded from net">
                    *
                  </span>
                )}
              </td>
              <td className="py-1 pr-2 text-right text-fg">{formatUsdc(r.net)}</td>
              <td className="py-1 pr-2 text-right text-usdc">{formatUsdc(r.usdc)}</td>
              <td className="py-1 pr-2 text-right">{formatUsdc(r.tokenValue)}</td>
              <td className="py-1 pr-2 text-right">{formatUsdc(r.escrowValue)}</td>
              <td className="py-1 pr-2 text-right text-fg-dim">{r.openOrders}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-3 text-xs text-fg-faint">
        Top 20 holders per market side; long-tail holders excluded.
        {anyUnpriceable && " * Some open positions had no book mark and are excluded from net worth."}
      </p>
    </div>
  );
}
