import { cx } from "@/components/ui";
import { formatDollars, formatPctChange } from "@/lib/format";
import type { Spot } from "@/lib/usePriceHistory";

/**
 * The stock's latest spot, shown compactly: last close, optional open, and the day-over-day
 * % change. That delta is the last close vs the *prior session's* close (NOT close-vs-open),
 * so it's suppressed (`showChange={false}`) on the trade-page hero, where sitting next to the
 * open would falsely imply an open-vs-close move; the hero's live "from open" stat carries
 * today's change instead. Mint up / coral down. Used on the markets grid card, the trade-page
 * header, and the chart caption. Presentational — pass the derived {@link Spot} (or null).
 */

export function SpotLine({
  spot,
  showOpen = false,
  showChange = true,
  className,
}: {
  spot: Spot | null;
  /** Also show the day's open price (used on the roomier trade page). */
  showOpen?: boolean;
  /** Show the day-over-day % change. Off on the hero to avoid the misleading
   *  open-vs-close reading (the day-over-day delta is vs the prior close). */
  showChange?: boolean;
  className?: string;
}) {
  if (!spot) {
    return (
      <span
        className={cx("stat-mono text-xs text-fg-faint", className)}
        data-testid="spot-line"
      >
        last close —
      </span>
    );
  }

  const { close, open, changePct } = spot;
  const tone =
    changePct == null
      ? "text-fg-faint"
      : changePct >= 0
      ? "text-yes"
      : "text-no";

  return (
    <span
      className={cx("stat-mono text-xs", className)}
      data-testid="spot-line"
    >
      <span className="text-fg-faint">last close </span>
      <span className="text-fg">{formatDollars(close)}</span>
      {showOpen && open != null && (
        <span className="text-fg-faint"> · open {formatDollars(open)}</span>
      )}
      {showChange && changePct != null && (
        <span className={cx("ml-1.5", tone)}>
          {changePct >= 0 ? "▲" : "▼"} {formatPctChange(changePct)}
        </span>
      )}
    </span>
  );
}
