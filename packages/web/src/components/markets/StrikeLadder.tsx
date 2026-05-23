import { Fragment } from "react";
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
 *
 * Doubles as the trade page's strike picker: when `onSelect` is provided, **open** rows
 * become clickable (the selected one is highlighted) and settled rows stay muted and
 * non-interactive — you can't trade a closed market. Without `onSelect` it's a read-only
 * table. Presentational — rows are derived upstream by `strikeLadderRows`.
 */
/** Columns the ladder renders — used to size the full-width "last close" marker. */
const COL_COUNT = 7;

export function StrikeLadder({
  rows,
  selectedAddress,
  onSelect,
  lastClose,
}: {
  rows: StrikeRow[];
  /** Address of the currently selected strike (highlighted), if any. */
  selectedAddress?: string | null;
  /** When provided, open rows are clickable and call this with the row address. */
  onSelect?: (address: string) => void;
  /** The stock's last close (dollars). Draws a marker line between the strikes it sits
   *  between, so you can see at a glance which strikes are in/out of the money. */
  lastClose?: number | null;
}) {
  if (rows.length === 0) {
    return (
      <p className="px-1 py-3 text-sm text-fg-dim" data-testid="strike-ladder">
        No markets for this stock today.
      </p>
    );
  }

  // Rows are strike-ascending. The marker goes before the first strike that is *above*
  // the last close (so the close sits between that row and the one before it). If the
  // close is above every strike, place it after the last row.
  const STRIKE_SCALE = 1_000_000; // strike is in USDC base units (6dp); close is dollars.
  const markerIndex =
    lastClose == null
      ? -1
      : (() => {
          const idx = rows.findIndex(
            (r) => r.strike.toNumber() / STRIKE_SCALE > lastClose
          );
          return idx === -1 ? rows.length : idx;
        })();

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
          {rows.map((row, i) => {
            const selectable = !!onSelect && row.state === "open";
            const selected = selectedAddress === row.address;
            return (
              <Fragment key={row.address}>
                {i === markerIndex && lastClose != null && (
                  <LastCloseMarker value={lastClose} />
                )}
                <tr
                  className={cx(
                    "border-t border-line-soft/60",
                    selectable && "cursor-pointer hover:bg-panel-2/60",
                    selected && "bg-accent/10",
                    row.state === "settled" && "opacity-55"
                  )}
                  data-testid={`ladder-row-${row.strike.toString()}`}
                  data-selectable={selectable || undefined}
                  data-selected={selected || undefined}
                  aria-selected={onSelect ? selected : undefined}
                  onClick={
                    selectable ? () => onSelect!(row.address) : undefined
                  }
                >
                  <td className="py-2 pr-3 text-fg">
                    {formatUsdc(row.strike, 0)}
                  </td>
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
              </Fragment>
            );
          })}
          {/* Close above every strike → marker sits below the last row. */}
          {markerIndex === rows.length && lastClose != null && (
            <LastCloseMarker value={lastClose} />
          )}
        </tbody>
      </table>
    </div>
  );
}

/** A full-width divider row marking where the last close falls among the strikes. */
function LastCloseMarker({ value }: { value: number }) {
  // `value` is a plain dollar amount (from the price-history feed), not USDC base units —
  // format it directly rather than via formatUsdc (which divides by 1e6).
  const label = `$${value.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
  return (
    <tr data-testid="last-close-marker" aria-hidden>
      <td colSpan={COL_COUNT} className="p-0">
        <div className="flex items-center gap-2 py-1">
          <span className="whitespace-nowrap text-xs uppercase tracking-wide text-amber">
            Last close <span className="stat-mono normal-case">{label}</span>
          </span>
          <span className="h-px flex-1 bg-amber/50" />
        </div>
      </td>
    </tr>
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
