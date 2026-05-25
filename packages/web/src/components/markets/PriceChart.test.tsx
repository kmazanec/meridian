import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { PriceChart, chartLayout, type ChartPoint } from "./PriceChart";

const series: ChartPoint[] = [
  { label: "May 1", close: 100, open: 99 },
  { label: "May 2", close: 110, open: 101 },
  { label: "May 3", close: 105, open: 108 },
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

  it("spans a padded domain around the close values and emits y ticks", () => {
    const layout = chartLayout(series, 700, 160, 4)!;
    // The domain brackets the raw [100, 110] range with a little air on each side.
    expect(layout.min).toBeLessThan(100);
    expect(layout.max).toBeGreaterThan(110);
    expect(layout.min).toBeGreaterThan(90);
    expect(layout.max).toBeLessThan(120);
    expect(layout.ticks).toHaveLength(4);
    expect(layout.area.endsWith("Z")).toBe(true);
  });

  it("emits evenly-spaced x labels with end anchors inset", () => {
    const layout = chartLayout(series, 700, 160, 4, 3)!;
    expect(layout.xLabels).toHaveLength(3);
    expect(layout.xLabels[0]).toMatchObject({
      label: "May 1",
      anchor: "start",
    });
    expect(layout.xLabels[2]).toMatchObject({ label: "May 3", anchor: "end" });
    // Middle labels are centered.
    expect(layout.xLabels[1].anchor).toBe("middle");
  });

  it("caps x labels at the point count and dedupes", () => {
    const layout = chartLayout(series, 700, 160, 4, 10)!;
    expect(layout.xLabels.length).toBeLessThanOrEqual(series.length);
  });

  it("pads the y-domain so the top/bottom values are never flush with the edges", () => {
    const layout = chartLayout(series, 700, 160)!;
    // Padded domain sits strictly outside the raw data range.
    expect(layout.min).toBeLessThan(100);
    expect(layout.max).toBeGreaterThan(110);
  });

  it("emits no strike overlay without a strike", () => {
    expect(chartLayout(series, 700, 160)!.strike).toBeNull();
    expect(chartLayout(series, 700, 160, 4, 5, null)!.strike).toBeNull();
  });

  it("includes the strike in the y-domain and places its line", () => {
    // Strike below the data range must still fit on-chart, padded off the bottom edge.
    const layout = chartLayout(series, 700, 160, 4, 5, 90)!;
    expect(layout.min).toBeLessThan(90); // padded below the strike
    expect(layout.strike).not.toBeNull();
    expect(layout.strike!.value).toBe(90);
    // The strike line spans the plot width and sits inside the plot box.
    expect(layout.strike!.right).toBeGreaterThan(layout.strike!.left);
    expect(layout.strike!.y).toBeLessThanOrEqual(layout.strike!.plotBottom);
    expect(layout.strike!.y).toBeGreaterThanOrEqual(layout.strike!.plotTop);
  });

  it("never pins the strike line to the very top or bottom edge", () => {
    // Strike at the data max (110) — without padding it would sit on the top edge.
    const layout = chartLayout(series, 700, 160, 4, 5, 110)!;
    expect(layout.strike!.y).toBeGreaterThan(layout.strike!.plotTop);
    // And a strike at the data min (100) must clear the bottom edge.
    const low = chartLayout(series, 700, 160, 4, 5, 100)!;
    expect(low.strike!.y).toBeLessThan(low.strike!.plotBottom);
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
    // No live marker unless a liveIndex is given.
    expect(screen.queryByTestId("price-chart-live")).not.toBeInTheDocument();
  });

  it("shows a crosshair + tooltip on pointer move", () => {
    render(<PriceChart points={series} />);
    const svg = screen.getByLabelText("price history chart");
    // jsdom getBoundingClientRect is 0-sized; clientX 0 maps to the first point.
    fireEvent.pointerMove(svg, { clientX: 0, clientY: 0 });
    expect(screen.getByTestId("price-chart-crosshair")).toBeInTheDocument();
    const tip = screen.getByTestId("price-chart-tooltip");
    expect(tip).toHaveTextContent("May 1");
    expect(tip).toHaveTextContent("$100.00");
    expect(tip).toHaveTextContent("Open $99.00");
  });

  it("draws a live marker at the given liveIndex", () => {
    render(<PriceChart points={series} liveIndex={1} />);
    expect(screen.getByTestId("price-chart-live")).toBeInTheDocument();
  });

  it("draws no strike line by default", () => {
    render(<PriceChart points={series} />);
    expect(screen.queryByTestId("price-chart-strike")).not.toBeInTheDocument();
  });

  it("draws the strike line with Yes/No side markers when a strike is given", () => {
    render(<PriceChart points={series} strike={105} />);
    const strike = screen.getByTestId("price-chart-strike");
    expect(strike).toBeInTheDocument();
    expect(strike).toHaveTextContent("Strike $105.00");
    expect(strike).toHaveTextContent(/YES/);
    expect(strike).toHaveTextContent(/NO/);
  });
});
