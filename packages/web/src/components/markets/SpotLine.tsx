import { cx } from "@/components/ui";
import type { Spot } from "@/lib/usePriceHistory";

/**
 * The stock's latest spot, shown compactly: last close, optional open, and the
 * day-over-day % change (mint up / coral down). Used across the markets grid card, the
 * trade-page header, and the strike-ladder caption so the strike prices read against where
 * the stock actually closed. Presentational — pass the derived {@link Spot} (or null).
 */

const fmtUsd = (n: number) =>
  `$${n.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

function fmtPct(frac: number): string {
  const sign = frac > 0 ? "+" : "";
  return `${sign}${(frac * 100).toFixed(2)}%`;
}

export function SpotLine({
  spot,
  showOpen = false,
  className,
}: {
  spot: Spot | null;
  /** Also show the day's open price (used on the roomier trade page). */
  showOpen?: boolean;
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
      <span className="text-fg">{fmtUsd(close)}</span>
      {showOpen && open != null && (
        <span className="text-fg-faint"> · open {fmtUsd(open)}</span>
      )}
      {changePct != null && (
        <span className={cx("ml-1.5", tone)}>
          {changePct >= 0 ? "▲" : "▼"} {fmtPct(changePct)}
        </span>
      )}
    </span>
  );
}
