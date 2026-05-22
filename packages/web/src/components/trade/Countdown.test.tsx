import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { Countdown } from "./Countdown";

describe("Countdown", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("shows the remaining time to the close instant", () => {
    const now = 1_000_000_000_000; // fixed ms
    vi.setSystemTime(now);
    const tradingDay = Math.floor(now / 1000) + (2 * 3600 + 3 * 60 + 4);
    render(<Countdown tradingDay={tradingDay} />);
    expect(screen.getByTestId("countdown").textContent).toContain("02:03:04");
  });

  it("shows Closed once past the close instant", () => {
    const now = 1_000_000_000_000;
    vi.setSystemTime(now);
    const tradingDay = Math.floor(now / 1000) - 10;
    render(<Countdown tradingDay={tradingDay} />);
    expect(screen.getByTestId("countdown").textContent).toContain("Closed");
  });
});
