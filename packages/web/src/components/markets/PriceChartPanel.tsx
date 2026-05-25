"use client";

import { useState } from "react";
import { cx } from "@/components/ui";
import { PriceChart, type ChartPoint } from "./PriceChart";
import { SpotLine } from "./SpotLine";
import type { ClosePoint, Spot } from "@/lib/usePriceHistory";
import { useIntradaySession } from "@/lib/useIntradaySession";

/**
 * The trade-page chart panel: a Day/Month timeframe toggle over the {@link PriceChart}.
 *
 * - **Day** (the default) plots the current session's intraday path from {@link useIntradaySession},
 *   with a gold "live" dot at the session's current edge. Today's path is the most relevant view
 *   for a contract that settles today, so the panel opens here.
 * - **Month** plots the daily closes already loaded for the page (`closes`).
 *
 * Intraday is synthetic/dev-only, so when the endpoint isn't available (e.g. production, which
 * captures no intraday) the Day view has nothing to draw. Because Day is the default, we don't
 * want users landing on a bare "not available" note: if intraday is missing *and the user hasn't
 * explicitly chosen Day*, the panel silently falls back to Month (reflecting Month as active). The
 * "not available" note only appears when the user deliberately switches to Day and there's no data.
 *
 * The chart itself is timeframe-agnostic — this panel just maps each source into labelled
 * {@link ChartPoint}s (dates for Month, clock times for Day).
 */

type Timeframe = "day" | "month";

/** "May 3" from an ISO `YYYY-MM-DD` (UTC — the feed's dates are calendar days). */
function fmtDay(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

/** "1:30 PM" from unix seconds, in the viewer's local time. */
function fmtClock(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
}

const monthPoints = (closes: ClosePoint[]): ChartPoint[] =>
  closes.map((p) => ({
    close: p.close,
    label: fmtDay(p.date),
    open: p.open,
  }));

export function PriceChartPanel({
  symbol,
  closes,
  spot,
  tradingDay,
  className,
}: {
  symbol: string;
  /** Daily closes for the Month view (ascending). */
  closes: ClosePoint[];
  /** Latest spot, shown in the panel header. */
  spot: Spot | null;
  /** The selected market's settlement instant (unix seconds) — powers the Day view. */
  tradingDay: number | null;
  className?: string;
}) {
  // Day is the default view. `userPicked` records whether the user has actively toggled, so we
  // can silently fall back to Month when intraday is missing on the default Day view but still
  // honor a deliberate Day choice (showing the "not available" note) once they've clicked.
  const [timeframe, setTimeframe] = useState<Timeframe>("day");
  const [userPicked, setUserPicked] = useState(false);
  const pick = (t: Timeframe) => {
    setUserPicked(true);
    setTimeframe(t);
  };

  // Only fetch intraday when the user is actually on the Day tab (and a market exists).
  const session = useIntradaySession(
    timeframe === "day" ? symbol : null,
    timeframe === "day" ? tradingDay : null
  );

  const intradayPoints: ChartPoint[] =
    session.points?.map((p) => ({
      close: p.close,
      label: fmtClock(p.timestamp),
    })) ?? [];

  // Intraday has nothing to draw (prod has no intraday, or no market today).
  const noIntraday =
    !session.loading && (session.points == null || session.points.length < 2);
  // On the default Day view with no intraday, quietly render Month instead of an empty note.
  const fallBackToMonth = timeframe === "day" && noIntraday && !userPicked;
  const showDay = timeframe === "day" && !fallBackToMonth;
  // The note only appears when the user deliberately chose Day and there's no data.
  const dayUnavailable = timeframe === "day" && userPicked && noIntraday;

  // Reflect the effective view in the toggle so the active segment matches what's drawn.
  const activeToggle: Timeframe = showDay ? "day" : "month";

  const heading = showDay
    ? `${symbol} · today's session`
    : `${symbol} · last ${closes.length} sessions`;

  return (
    <div className={cx("panel p-5", className)} data-testid="price-chart-panel">
      <div className="mb-2 flex items-center justify-between gap-3">
        <h2 className="text-xs uppercase tracking-wide text-fg-faint">
          {heading}
        </h2>
        <div className="flex items-center gap-3">
          <SpotLine spot={spot} />
          <TimeframeToggle value={activeToggle} onChange={pick} />
        </div>
      </div>

      {dayUnavailable ? (
        <ChartMessage>
          Intraday isn't available for this market yet.
        </ChartMessage>
      ) : showDay ? (
        session.loading && intradayPoints.length === 0 ? (
          <ChartMessage>Loading today's session…</ChartMessage>
        ) : (
          <PriceChart points={intradayPoints} liveIndex={session.liveIndex} />
        )
      ) : (
        <PriceChart points={monthPoints(closes)} />
      )}
    </div>
  );
}

/** A two-segment Day/Month control, gold for the active segment. */
function TimeframeToggle({
  value,
  onChange,
}: {
  value: Timeframe;
  onChange: (t: Timeframe) => void;
}) {
  const opts: { id: Timeframe; label: string }[] = [
    { id: "day", label: "Day" },
    { id: "month", label: "Month" },
  ];
  return (
    <div
      className="inline-flex rounded-lg border border-line-soft p-0.5"
      role="tablist"
      aria-label="Chart timeframe"
    >
      {opts.map((o) => {
        const active = value === o.id;
        return (
          <button
            key={o.id}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(o.id)}
            className={cx(
              "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
              active ? "bg-accent/15 text-accent" : "text-fg-dim hover:text-fg"
            )}
            data-testid={`timeframe-${o.id}`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

function ChartMessage({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="flex items-center justify-center text-sm text-fg-faint"
      style={{ height: 160 }}
    >
      {children}
    </div>
  );
}
