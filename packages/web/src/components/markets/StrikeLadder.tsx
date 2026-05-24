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
  currentPrice,
}: {
  rows: StrikeRow[];
  /** Address of the currently selected strike (highlighted), if any. */
  selectedAddress?: string | null;
  /** When provided, open rows are clickable and call this with the row address. */
  onSelect?: (address: string) => void;
  /** The stock's last close (dollars). Draws a marker line between the strikes it sits
   *  between, so you can see at a glance which strikes are in/out of the money. */
  lastClose?: number | null;
  /** The stock's live price (dollars). Draws a second marker so you can see where the
   *  stock is trading *right now* relative to the strikes, alongside the last close. */
  currentPrice?: number | null;
}) {
  if (rows.length === 0) {
    return (
      <p className="px-1 py-3 text-sm text-fg-dim" data-testid="strike-ladder">
        No markets for this stock today.
      </p>
    );
  }

  // Display highest strike at the top: rows arrive strike-ascending, so reverse to
  // descending for the ladder (a trader reads the price scale top-down, high to low).
  const orderedRows = [...rows].reverse();

  // Price markers (last close, current price) drop into the ladder between the strikes
  // they fall between, so you can see at a glance which strikes are in/out of the money
  // and where the stock is trading now. Each marker's row index is the first strike
  // *at or below* its price; below every strike → after the last row. Both markers are
  // sorted high→low so when they share a slot the higher price renders above (matching
  // the descending ladder).
  const STRIKE_SCALE = 1_000_000; // strike is in USDC base units (6dp); prices are dollars.
  const markerIndexFor = (value: number) => {
    const idx = orderedRows.findIndex(
      (r) => r.strike.toNumber() / STRIKE_SCALE <= value
    );
    return idx === -1 ? orderedRows.length : idx;
  };
  const markers: PriceMarker[] = [
    currentPrice != null
      ? { kind: "current" as const, value: currentPrice }
      : null,
    lastClose != null ? { kind: "last" as const, value: lastClose } : null,
  ]
    .filter((m): m is PriceMarker => m !== null)
    .map((m) => ({ ...m, index: markerIndexFor(m.value) }))
    .sort((a, b) => b.value - a.value);

  const markersAt = (i: number) => markers.filter((m) => m.index === i);

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
          {orderedRows.map((row, i) => {
            const selectable = !!onSelect && row.state === "open";
            const selected = selectedAddress === row.address;
            return (
              <Fragment key={row.address}>
                {markersAt(i).map((m) => (
                  <PriceMarkerRow key={m.kind} marker={m} />
                ))}
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
          {/* A price below every strike → its marker sits below the last row. */}
          {markersAt(orderedRows.length).map((m) => (
            <PriceMarkerRow key={m.kind} marker={m} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** A price marker dropped into the ladder (last close in amber, live price in teal). */
type PriceMarker = {
  kind: "last" | "current";
  value: number;
  /** Row index it renders before (filled in during placement). */
  index?: number;
};

/** A full-width divider row marking where a price falls among the strikes. */
function PriceMarkerRow({ marker }: { marker: PriceMarker }) {
  // `value` is a plain dollar amount (from the price feeds), not USDC base units —
  // format it directly rather than via formatUsdc (which divides by 1e6).
  const label = `$${marker.value.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
  const isCurrent = marker.kind === "current";
  return (
    <tr
      data-testid={isCurrent ? "current-price-marker" : "last-close-marker"}
      aria-hidden
    >
      <td colSpan={COL_COUNT} className="p-0">
        <div className="flex items-center gap-2 py-1">
          <span
            className={cx(
              "whitespace-nowrap text-xs uppercase tracking-wide",
              isCurrent ? "text-yes" : "text-amber"
            )}
          >
            {isCurrent ? "Current" : "Last close"}{" "}
            <span className="stat-mono normal-case">{label}</span>
          </span>
          <span
            className={cx("h-px flex-1", isCurrent ? "bg-yes/50" : "bg-amber/50")}
          />
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
