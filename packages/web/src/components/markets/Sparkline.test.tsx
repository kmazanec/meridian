import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Sparkline, sparklineGeometry } from "./Sparkline";

describe("sparklineGeometry", () => {
  it("returns null for fewer than two points", () => {
    expect(sparklineGeometry([], 100, 40)).toBeNull();
    expect(sparklineGeometry([5], 100, 40)).toBeNull();
  });

  it("maps the highest value to the top (smallest y)", () => {
    const geo = sparklineGeometry([1, 2], 100, 40, 1)!;
    // First point (lower value) sits lower (larger y) than the second (higher value).
    const [, y0] = geo.line.match(/M[\d.]+ ([\d.]+)/)!;
    const [, y1] = geo.line.match(/L[\d.]+ ([\d.]+)/)!;
    expect(Number(y0)).toBeGreaterThan(Number(y1));
  });

  it("closes the area path back to the baseline", () => {
    const geo = sparklineGeometry([1, 2, 3], 100, 40)!;
    expect(geo.area.endsWith("Z")).toBe(true);
  });
});

describe("Sparkline", () => {
  it("renders an up direction when the series rises", () => {
    render(<Sparkline values={[100, 101, 105]} />);
    expect(screen.getByTestId("sparkline")).toHaveAttribute(
      "data-direction",
      "up"
    );
  });

  it("renders a down direction when the series falls", () => {
    render(<Sparkline values={[105, 102, 100]} />);
    expect(screen.getByTestId("sparkline")).toHaveAttribute(
      "data-direction",
      "down"
    );
  });

  it("renders a baseline placeholder with too little data", () => {
    render(<Sparkline values={[]} />);
    const el = screen.getByTestId("sparkline");
    expect(el).toHaveAttribute("aria-label", "no price history");
    expect(el.querySelector("line")).not.toBeNull();
  });
});
