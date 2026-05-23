import { cx } from "@/components/ui";

/**
 * A tiny hand-rolled SVG sparkline for a series of closing prices — no chart library
 * (none is in the bundle, and a sparkline doesn't warrant one). Pure and presentational:
 * given the raw numbers it normalizes them to the viewBox and draws a line plus a faint
 * area fill. Tone is derived from direction (last vs first close): mint when up, coral
 * when down. Renders a flat baseline placeholder when there's too little data to plot.
 */

/** Build the line/area path geometry for `values` over a `width × height` box. */
export function sparklineGeometry(
  values: number[],
  width: number,
  height: number,
  pad = 1
): { line: string; area: string } | null {
  if (values.length < 2) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1; // avoid /0 on a flat series
  const innerW = width - pad * 2;
  const innerH = height - pad * 2;
  const stepX = innerW / (values.length - 1);
  const points = values.map((v, i) => {
    const x = pad + i * stepX;
    // Invert y: higher price → higher on screen (smaller y).
    const y = pad + innerH - ((v - min) / span) * innerH;
    return [x, y] as const;
  });
  const line = points
    .map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(2)} ${y.toFixed(2)}`)
    .join(" ");
  const [firstX] = points[0];
  const [lastX] = points[points.length - 1];
  const area = `${line} L${lastX.toFixed(2)} ${(height - pad).toFixed(
    2
  )} L${firstX.toFixed(2)} ${(height - pad).toFixed(2)} Z`;
  return { line, area };
}

export function Sparkline({
  values,
  width = 132,
  height = 36,
  className,
}: {
  values: number[];
  width?: number;
  height?: number;
  className?: string;
}) {
  const geo = sparklineGeometry(values, width, height);
  // Direction tone: up vs the first observed close (or neutral with no data).
  const up = values.length >= 2 && values[values.length - 1] >= values[0];
  const stroke = up ? "text-yes" : "text-no";

  if (!geo) {
    return (
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label="no price history"
        data-testid="sparkline"
        className={cx("text-fg-faint", className)}
      >
        <line
          x1={1}
          y1={height / 2}
          x2={width - 1}
          y2={height / 2}
          stroke="currentColor"
          strokeOpacity={0.35}
          strokeDasharray="3 3"
        />
      </svg>
    );
  }

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      role="img"
      aria-label="price history"
      data-testid="sparkline"
      data-direction={up ? "up" : "down"}
      className={cx(stroke, className)}
    >
      <path d={geo.area} fill="currentColor" fillOpacity={0.12} stroke="none" />
      <path
        d={geo.line}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
