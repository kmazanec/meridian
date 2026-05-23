import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import BN from "bn.js";
import { Ticker } from "@meridian/sdk";
import type { TickerView } from "@/lib/marketStats";
import { MarketCard } from "./MarketCard";

function view(overrides: Partial<TickerView> = {}): TickerView {
  return {
    ticker: Ticker.Nvda,
    symbol: "NVDA",
    tradingDay: new BN(Math.floor(Date.now() / 1000) + 3600),
    activeCount: 2,
    repYesPrice: new BN(650_000),
    totalRestingSize: new BN(4_000_000),
    totalPairsMinted: new BN(3_000_000),
    totalCollateral: new BN(3_000_000),
    rows: [],
    history: [
      { date: "2026-05-01", close: 100 },
      { date: "2026-05-02", close: 110 },
    ],
    ...overrides,
  };
}

describe("MarketCard", () => {
  it("shows the summary: symbol, active count, Yes price, sparkline", () => {
    render(<MarketCard view={view()} />);
    const card = screen.getByTestId("market-card-NVDA");
    expect(within(card).getByText("NVDA")).toBeInTheDocument();
    expect(within(card).getByText("2 active")).toBeInTheDocument();
    expect(within(card).getByText("$0.65")).toBeInTheDocument();
    expect(within(card).getByTestId("sparkline")).toBeInTheDocument();
  });

  it("links to the stock's trade/detail page", () => {
    render(<MarketCard view={view()} />);
    expect(screen.getByTestId("market-card-NVDA")).toHaveAttribute(
      "href",
      "/trade/NVDA"
    );
  });

  it("falls back gracefully when there is no open market", () => {
    render(
      <MarketCard
        view={view({ activeCount: 0, repYesPrice: null, tradingDay: null })}
      />
    );
    const card = screen.getByTestId("market-card-NVDA");
    expect(within(card).getByText("no open market")).toBeInTheDocument();
    expect(within(card).queryByTestId("countdown")).not.toBeInTheDocument();
  });
});
