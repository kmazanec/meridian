import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { ClosePoint } from "@/lib/usePriceHistory";
import { PriceChart, chartLayout } from "./PriceChart";

const series: ClosePoint[] = [
  { date: "2026-05-01", close: 100, open: 99 },
  { date: "2026-05-02", close: 110, open: 101 },
  { date: "2026-05-03", close: 105, open: 108 },
];

describe("chartLayout", () => {
  it("returns null for fewer than two points", () => {
    expect(chartLayout([], 700, 160)).toBeNull();
    expect(chartLayout([series[0]], 700, 160)).toBeNull();
  });

  it("maps the highest close to the top (smallest y)", () => {
    const layout = chartLayout(series, 700, 160)!;
    const ys = layout.pts.map((p) => p.y);
    // The peak (110, index 1) should be the smallest y.
    expect(Math.min(...ys)).toBe(ys[1]);
  });

  it("spans min/max from the close values and emits y ticks", () => {
    const layout = chartLayout(series, 700, 160, 4)!;
    expect(layout.min).toBe(100);
    expect(layout.max).toBe(110);
    expect(layout.ticks).toHaveLength(4);
    expect(layout.area.endsWith("Z")).toBe(true);
  });
});

describe("PriceChart", () => {
  it("renders an empty state with too little data", () => {
    render(<PriceChart points={[]} />);
    expect(screen.getByTestId("price-chart-empty")).toHaveTextContent(
      "No price history available."
    );
  });

  it("renders the chart for a real series", () => {
    render(<PriceChart points={series} />);
    expect(screen.getByTestId("price-chart")).toBeInTheDocument();
    // No crosshair/tooltip until the pointer moves over it.
    expect(screen.queryByTestId("price-chart-tooltip")).not.toBeInTheDocument();
  });

  it("shows a crosshair + tooltip on pointer move", () => {
    render(<PriceChart points={series} />);
    const svg = screen.getByLabelText("price history chart");
    // jsdom getBoundingClientRect is 0-sized; clientX 0 maps to the first point.
    fireEvent.pointerMove(svg, { clientX: 0, clientY: 0 });
    expect(screen.getByTestId("price-chart-crosshair")).toBeInTheDocument();
    const tip = screen.getByTestId("price-chart-tooltip");
    expect(tip).toHaveTextContent("Close $100.00");
    expect(tip).toHaveTextContent("Open $99.00");
  });
});
