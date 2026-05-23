"use client";

import { useRef, useState } from "react";
import { cx } from "@/components/ui";
import type { ClosePoint } from "@/lib/usePriceHistory";

/**
 * A full-width interactive close-price chart for the trade page: a close line + area, a
 * y-axis with a few price labels, date ticks, gridlines, and a pointer crosshair + dot +
 * tooltip showing the hovered day's date and close. Hand-rolled SVG (no chart lib — the
 * codebase deliberately ships none). The grid cards keep the tiny static {@link Sparkline};
 * this is the richer detail-page variant. Tone (mint up / coral down) follows the series.
 */

const PAD = { top: 12, right: 56, bottom: 22, left: 8 };

interface ChartPoint {
  x: number;
  y: number;
  point: ClosePoint;
}

export interface ChartLayout {
  pts: ChartPoint[];
  line: string;
  area: string;
  min: number;
  max: number;
  /** y-axis label values (price) with their y pixel positions. */
  ticks: Array<{ value: number; y: number }>;
}

/** Pure layout: map close points to pixel coords + line/area paths + y ticks. */
export function chartLayout(
  points: ClosePoint[],
  width: number,
  height: number,
  tickCount = 4
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
  const pts: ChartPoint[] = points.map((point, i) => ({
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

  return { pts, line, area, min, max, ticks };
}

const fmtUsd = (n: number) =>
  `$${n.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

/** Short label like "May 3" from an ISO date, in UTC (the feed's dates are calendar days). */
function fmtDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

export function PriceChart({
  points,
  height = 160,
  className,
}: {
  points: ClosePoint[];
  height?: number;
  className?: string;
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
  const stroke = up ? "text-accent" : "text-no";

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
        {/* Horizontal gridlines + y-axis price labels. */}
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
              x={width - PAD.right + 6}
              y={t.y + 3}
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

        {/* First / last date ticks along the bottom. */}
        <text
          x={layout.pts[0].x}
          y={height - 6}
          fill="currentColor"
          fillOpacity={0.45}
          fontSize={11}
          className="stat-mono"
        >
          {fmtDate(points[0].date)}
        </text>
        <text
          x={layout.pts[layout.pts.length - 1].x}
          y={height - 6}
          textAnchor="end"
          fill="currentColor"
          fillOpacity={0.45}
          fontSize={11}
          className="stat-mono"
        >
          {fmtDate(points[points.length - 1].date)}
        </text>

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
            <circle cx={hoverPt.x} cy={hoverPt.y} r={3.5} fill="currentColor" />
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
          <div className="text-fg-faint">{fmtDate(hoverPt.point.date)}</div>
          <div className="stat-mono text-fg">
            Close {fmtUsd(hoverPt.point.close)}
          </div>
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
