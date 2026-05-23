import { Outcome } from "@meridian/sdk";
import {
  formatPrice,
  formatProbability,
  formatTokens,
  formatUsdc,
} from "@/lib/format";
import { cx } from "@/components/ui";
import type { StrikeRow } from "@/lib/marketStats";
import { DepthBar } from "./DepthBar";

/**
 * The options-style strike ladder for one ticker: every strike's Yes price + implied
 * probability, the bid/ask spread, resting size, and a compact depth bar. Settled strikes
 * show their outcome (Yes/No won) and the settlement price instead of a live spread.
 * Presentational — rows are derived upstream by `strikeLadderRows`.
 */
export function StrikeLadder({ rows }: { rows: StrikeRow[] }) {
  if (rows.length === 0) {
    return (
      <p className="px-1 py-3 text-sm text-fg-dim" data-testid="strike-ladder">
        No markets for this stock today.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto" data-testid="strike-ladder">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs uppercase tracking-wide text-fg-faint">
            <th className="py-2 pr-3 font-medium">Strike</th>
            <th className="py-2 pr-3 font-medium">Yes</th>
            <th className="py-2 pr-3 font-medium">Implied</th>
            <th className="hidden py-2 pr-3 font-medium sm:table-cell">
              Spread
            </th>
            <th className="hidden py-2 pr-3 font-medium sm:table-cell">Size</th>
            <th className="py-2 pr-3 font-medium">Depth</th>
            <th className="py-2 font-medium">Status</th>
          </tr>
        </thead>
        <tbody className="stat-mono">
          {rows.map((row) => (
            <tr
              key={row.address}
              className="border-t border-line-soft/60"
              data-testid={`ladder-row-${row.strike.toString()}`}
            >
              <td className="py-2 pr-3 text-fg">{formatUsdc(row.strike, 0)}</td>
              <td className="py-2 pr-3 text-yes">
                {formatPrice(row.yesPrice)}
              </td>
              <td className="py-2 pr-3 text-fg-dim">
                {formatProbability(row.yesPrice)}
              </td>
              <td className="hidden py-2 pr-3 text-fg-dim sm:table-cell">
                {row.spread ? formatPrice(row.spread) : "—"}
              </td>
              <td className="hidden py-2 pr-3 text-fg-dim sm:table-cell">
                {formatTokens(row.restingSize, 0)}
              </td>
              <td className="py-2 pr-3">
                <DepthBar view={row.depth} className="w-20" />
              </td>
              <td className="py-2">
                <StatusCell row={row} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Live "Open", or a settled outcome badge with the settlement price. */
function StatusCell({ row }: { row: StrikeRow }) {
  if (row.state === "open") {
    return (
      <span className="text-xs uppercase tracking-wide text-accent">Open</span>
    );
  }
  const yesWon = row.outcome === Outcome.YesWins;
  const noWon = row.outcome === Outcome.NoWins;
  const label = yesWon ? "Yes won" : noWon ? "No won" : "Settled";
  return (
    <span
      className={cx(
        "text-xs uppercase tracking-wide",
        yesWon ? "text-yes" : noWon ? "text-no" : "text-fg-faint"
      )}
    >
      {label}
      {row.settlementPrice && (
        <span className="ml-1 normal-case text-fg-faint">
          @ {formatUsdc(row.settlementPrice, 2)}
        </span>
      )}
    </span>
  );
}
