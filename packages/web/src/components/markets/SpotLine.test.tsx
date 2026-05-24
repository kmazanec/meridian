import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { SpotLine } from "./SpotLine";

describe("SpotLine", () => {
  it("shows last close and an up change", () => {
    render(
      <SpotLine
        spot={{ date: "2026-05-02", close: 110, open: 101, changePct: 0.1 }}
      />
    );
    const el = screen.getByTestId("spot-line");
    expect(el).toHaveTextContent("last close $110.00");
    expect(el).toHaveTextContent("▲ +10.00%");
  });

  it("shows open only when showOpen is set", () => {
    const spot = {
      date: "2026-05-02",
      close: 110,
      open: 101,
      changePct: -0.05,
    };
    const { rerender } = render(<SpotLine spot={spot} />);
    expect(screen.getByTestId("spot-line")).not.toHaveTextContent("open");
    rerender(<SpotLine spot={spot} showOpen />);
    expect(screen.getByTestId("spot-line")).toHaveTextContent("open $101.00");
    expect(screen.getByTestId("spot-line")).toHaveTextContent("▼ -5.00%");
  });

  it("suppresses the change when showChange is false (the hero)", () => {
    // On the hero the day-over-day delta sits next to the open, which would falsely read
    // as an open-vs-close move — so the hero hides it and relies on the live "from open" stat.
    render(
      <SpotLine
        spot={{ date: "2026-05-02", close: 110, open: 101, changePct: -0.05 }}
        showOpen
        showChange={false}
      />
    );
    const el = screen.getByTestId("spot-line");
    expect(el).toHaveTextContent("last close $110.00");
    expect(el).toHaveTextContent("open $101.00");
    expect(el).not.toHaveTextContent("%");
  });

  it("renders a dash when there is no spot", () => {
    render(<SpotLine spot={null} />);
    expect(screen.getByTestId("spot-line")).toHaveTextContent("last close —");
  });

  it("omits the change when changePct is null", () => {
    render(
      <SpotLine
        spot={{ date: "2026-05-01", close: 100, open: null, changePct: null }}
      />
    );
    const el = screen.getByTestId("spot-line");
    expect(el).toHaveTextContent("last close $100.00");
    expect(el).not.toHaveTextContent("%");
  });
});
