import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import BN from "bn.js";
import { Ticker } from "@meridian/sdk";
import type { DailyResults } from "@/lib/results";
import { ResultsView } from "./ResultsView";

const DAY = new BN(1_700_000_000);

const results: DailyResults = {
  tradingDay: DAY,
  wagered: new BN(36_000000), // $36
  earned: new BN(32_000000), // $32
  lost: new BN(8_000000), // $8
  netPnl: new BN(-4_000000), // −$4
  wonCount: 14,
  lostCount: 9,
  positionCount: 23,
  winRate: 14 / 23,
  byStock: [
    {
      ticker: Ticker.Aapl,
      symbol: "AAPL",
      wagered: new BN(24_000000),
      earned: new BN(20_000000),
      net: new BN(-4_000000),
      wonCount: 9,
      lostCount: 6,
    },
  ],
  complete: true,
};

function renderView(
  over: Partial<React.ComponentProps<typeof ResultsView>> = {}
) {
  return render(
    <ResultsView
      results={results}
      tradingDay={DAY}
      usdcBalance={new BN(148_000000)}
      claimable={new BN(32_000000)}
      claimableCount={14}
      coverageComplete
      connected
      {...over}
    />
  );
}

describe("ResultsView", () => {
  it("prompts to connect when disconnected", () => {
    renderView({ connected: false });
    expect(screen.getByText(/connect a wallet/i)).toBeInTheDocument();
  });

  it("shows the no-results state when nothing has settled yet", () => {
    renderView({ results: null, tradingDay: null });
    expect(screen.getByTestId("no-results")).toBeInTheDocument();
    expect(screen.getByText(/once today.*markets settle/i)).toBeInTheDocument();
    expect(screen.queryByTestId("today-recap")).not.toBeInTheDocument();
  });

  it("explains the browser-fills caveat when markets settled but this wallet has none", () => {
    // results null (or zero positions) WITH a settled day → the wallet just has no local fills.
    renderView({ results: null, tradingDay: DAY });
    expect(screen.getByTestId("no-results")).toBeInTheDocument();
    expect(screen.getByText(/no results for this wallet/i)).toBeInTheDocument();
    expect(screen.getByText(/in this browser/i)).toBeInTheDocument();
  });

  it("renders the today recap: net P&L, wagered, earned, lost, win rate", () => {
    renderView();
    const recap = screen.getByTestId("today-recap");
    expect(within(recap).getByText("-$4.00")).toBeInTheDocument(); // net P&L
    expect(within(recap).getByText("$36.00")).toBeInTheDocument(); // wagered
    expect(within(recap).getByText("$32.00")).toBeInTheDocument(); // earned
    expect(within(recap).getByText("$8.00")).toBeInTheDocument(); // lost
    expect(within(recap).getByText("61%")).toBeInTheDocument(); // win rate (14/23)
  });

  it("shows wallet balance and claimable", () => {
    renderView();
    const recap = screen.getByTestId("today-recap");
    expect(within(recap).getByText("$148.00")).toBeInTheDocument(); // wallet
    expect(within(recap).getByText("$32.00 claimable")).toBeInTheDocument();
  });

  it("renders the per-stock breakdown", () => {
    renderView();
    const table = screen.getByTestId("results-by-stock");
    expect(within(table).getByText("AAPL")).toBeInTheDocument();
    expect(within(table).getByText("9–6")).toBeInTheDocument(); // record
  });

  it("qualifies the figures when coverage is incomplete", () => {
    renderView({ coverageComplete: false });
    expect(
      screen.getByText(/trades placed in this browser/i)
    ).toBeInTheDocument();
  });

  it("does not show the qualifier when coverage is complete", () => {
    renderView({ coverageComplete: true });
    expect(
      screen.queryByText(/trades placed in this browser/i)
    ).not.toBeInTheDocument();
  });
});
