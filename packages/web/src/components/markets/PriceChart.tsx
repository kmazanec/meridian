"use client";

import { useRef, useState } from "react";
import { cx } from "@/components/ui";

/**
 * A full-width interactive price chart for the trade page: a close line + area, a y-axis with a
 * few price labels, evenly-spaced x labels, gridlines, and a pointer crosshair + dot + tooltip.
 * Hand-rolled SVG (no chart lib — the codebase deliberately ships none). The grid cards keep the
 * tiny static {@link Sparkline}; this is the richer detail-page variant. Tone (teal up / terra
 * down) follows the series.
 *
 * Timeframe-agnostic: it renders whatever {@link ChartPoint}s it's handed — daily closes ("Month")
 * or an intraday session ("Day"). Each point carries its own axis `label` (a date or a time) so
 * the chart never needs to know which it is. An optional `liveIndex` marks the session's live edge.
 */

// A roomier right gutter keeps the y-axis price labels off the plotted line.
const PAD = { top: 12, right: 64, bottom: 24, left: 10 };

/** One point to plot. `label` is the x-axis text (e.g. "May 3" or "1:30 PM"). */
export interface ChartPoint {
  close: number;
  /** Axis/tooltip label for this point. */
  label: string;
  /** Optional secondary value shown in the tooltip (e.g. the day's open). */
  open?: number;
}

interface PlacedPoint {
  x: number;
  y: number;
  point: ChartPoint;
}

export interface ChartLayout {
  pts: PlacedPoint[];
  line: string;
  area: string;
  min: number;
  max: number;
  /** y-axis label values (price) with their y pixel positions. */
  ticks: Array<{ value: number; y: number }>;
  /** x-axis labels with their x pixel positions and text anchor (avoids edge clipping). */
  xLabels: Array<{
    label: string;
    x: number;
    anchor: "start" | "middle" | "end";
  }>;
}

/**
 * Pure layout: map points to pixel coords + line/area paths + y ticks + evenly-spaced x labels.
 * `xLabelCount` is the *target* number of bottom labels (capped at the point count); the first
 * and last are always included and anchored inward so they never clip the chart edges.
 */
export function chartLayout(
  points: ChartPoint[],
  width: number,
  height: number,
  tickCount = 4,
  xLabelCount = 5
): ChartLayout | null {
  if (points.length < 2) return null;
  const closes = points.map((p) => p.close);
  const min = Math.min(...closes);
  const max = Math.max(...closes);
  const span = max - min || 1;
  const innerW = width - PAD.left - PAD.right;
  const innerH = height - PAD.top - PAD.bottom;
  const stepX = innerW / (points.length - 1);

  const yFor = (v: number) => PAD.top + innerH - ((v - min) / span) * innerH;
  const pts: PlacedPoint[] = points.map((point, i) => ({
    x: PAD.left + i * stepX,
    y: yFor(point.close),
    point,
  }));

  const line = pts
    .map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(2)} ${p.y.toFixed(2)}`)
    .join(" ");
  const baseY = height - PAD.bottom;
  const area = `${line} L${pts[pts.length - 1].x.toFixed(
    2
  )} ${baseY} L${pts[0].x.toFixed(2)} ${baseY} Z`;

  const ticks = Array.from({ length: tickCount }, (_, i) => {
    const value = min + (span * i) / (tickCount - 1);
    return { value, y: yFor(value) };
  });

  // Pick evenly-spaced point indices for x labels (deduped), then anchor the ends inward.
  const labelCount = Math.max(2, Math.min(xLabelCount, points.length));
  const idxs = Array.from(
    new Set(
      Array.from({ length: labelCount }, (_, i) =>
        Math.round((i * (points.length - 1)) / (labelCount - 1))
      )
    )
  );
  const xLabels = idxs.map((idx) => ({
    label: points[idx].label,
    x: pts[idx].x,
    anchor:
      idx === 0
        ? ("start" as const)
        : idx === points.length - 1
        ? ("end" as const)
        : ("middle" as const),
  }));

  return { pts, line, area, min, max, ticks, xLabels };
}

const fmtUsd = (n: number) =>
  `$${n.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

export function PriceChart({
  points,
  height = 160,
  className,
  liveIndex,
}: {
  points: ChartPoint[];
  height?: number;
  className?: string;
  /** When set, marks this point's index as the session's live edge with a gold dot. */
  liveIndex?: number;
}) {
  // Fixed viewBox width; the SVG scales to its container via width=100%.
  const width = 720;
  const layout = chartLayout(points, width, height);
  const [hover, setHover] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  if (!layout) {
    return (
      <div
        className={cx(
          "flex items-center justify-center text-sm text-fg-faint",
          className
        )}
        style={{ height }}
        data-testid="price-chart-empty"
      >
        No price history available.
      </div>
    );
  }

  const up = points[points.length - 1].close >= points[0].close;
  const stroke = up ? "text-yes" : "text-no";

  // Map a pointer x (in viewBox units) to the nearest data point index.
  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const vbX = ((e.clientX - rect.left) / rect.width) * width;
    let best = 0;
    let bestDist = Infinity;
    for (let i = 0; i < layout.pts.length; i++) {
      const d = Math.abs(layout.pts[i].x - vbX);
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    }
    setHover(best);
  };

  const hoverPt = hover !== null ? layout.pts[hover] : null;

  return (
    <div className={cx("relative", className)} data-testid="price-chart">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${width} ${height}`}
        width="100%"
        height={height}
        preserveAspectRatio="none"
        className={stroke}
        onPointerMove={onMove}
        onPointerLeave={() => setHover(null)}
        role="img"
        aria-label="price history chart"
      >
        {/* Horizontal gridlines + y-axis price labels (right-aligned in the gutter). */}
        {layout.ticks.map((t, i) => (
          <g key={i}>
            <line
              x1={PAD.left}
              y1={t.y}
              x2={width - PAD.right}
              y2={t.y}
              stroke="currentColor"
              strokeOpacity={0.08}
            />
            <text
              x={width - 6}
              y={t.y + 3}
              textAnchor="end"
              fill="currentColor"
              fillOpacity={0.5}
              fontSize={11}
              className="stat-mono"
            >
              {fmtUsd(t.value)}
            </text>
          </g>
        ))}

        <path
          d={layout.area}
          fill="currentColor"
          fillOpacity={0.12}
          stroke="none"
        />
        <path
          d={layout.line}
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />

        {/* Evenly-spaced x-axis labels (dates for Month, times for Day). */}
        {layout.xLabels.map((l, i) => (
          <text
            key={i}
            x={l.x}
            y={height - 6}
            textAnchor={l.anchor}
            fill="currentColor"
            fillOpacity={0.45}
            fontSize={11}
            className="stat-mono"
          >
            {l.label}
          </text>
        ))}

        {/* Live edge of the session: a gold dot at the current intraday point. */}
        {liveIndex != null &&
          liveIndex >= 0 &&
          liveIndex < layout.pts.length && (
            <g data-testid="price-chart-live">
              <circle
                cx={layout.pts[liveIndex].x}
                cy={layout.pts[liveIndex].y}
                r={6}
                className="fill-accent"
                fillOpacity={0.18}
              />
              <circle
                cx={layout.pts[liveIndex].x}
                cy={layout.pts[liveIndex].y}
                r={3}
                className="fill-accent"
              />
            </g>
          )}

        {/* Crosshair + dot at the hovered point. */}
        {hoverPt && (
          <g data-testid="price-chart-crosshair">
            <line
              x1={hoverPt.x}
              y1={PAD.top}
              x2={hoverPt.x}
              y2={height - PAD.bottom}
              stroke="currentColor"
              strokeOpacity={0.35}
              strokeDasharray="3 3"
            />
            {/* Gold marker: the brand color marks the moment of interaction. */}
            <circle
              cx={hoverPt.x}
              cy={hoverPt.y}
              r={4}
              className="fill-accent"
            />
          </g>
        )}
      </svg>

      {/* Tooltip — positioned over the SVG by percentage so it tracks the scaled chart. */}
      {hoverPt && (
        <div
          className="panel pointer-events-none absolute -translate-x-1/2 -translate-y-full whitespace-nowrap px-2 py-1 text-xs"
          style={{
            left: `${(hoverPt.x / width) * 100}%`,
            top: `${(hoverPt.y / height) * 100}%`,
          }}
          data-testid="price-chart-tooltip"
        >
          <div className="text-fg-faint">{hoverPt.point.label}</div>
          <div className="stat-mono text-fg">{fmtUsd(hoverPt.point.close)}</div>
          {hoverPt.point.open != null && (
            <div className="stat-mono text-fg-dim">
              Open {fmtUsd(hoverPt.point.open)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
