import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import BN from "bn.js";
import { Outcome, Ticker, TICKER_SYMBOLS } from "@meridian/sdk";
import type { MarketsBoardRow } from "@/lib/marketStats";
import { MarketsView } from "./MarketsView";

/** A minimal board row for one symbol; overrides tune the fields under test. */
function boardRow(
  ordinal: Ticker,
  overrides: Partial<MarketsBoardRow> = {}
): MarketsBoardRow {
  return {
    ticker: ordinal,
    symbol: TICKER_SYMBOLS[ordinal],
    displayPrice: null,
    changePct: null,
    livePrice: null,
    pctFromOpen: null,
    open: false,
    atmRow: null,
    liquidity: new BN(0),
    tradingDay: null,
    settlementPrice: null,
    outcome: Outcome.Unsettled,
    rows: [],
    history: null,
    ...overrides,
  };
}

function allRows(
  overrides: Partial<Record<Ticker, Partial<MarketsBoardRow>>> = {}
): MarketsBoardRow[] {
  return TICKER_SYMBOLS.map((_, ordinal) =>
    boardRow(ordinal as Ticker, overrides[ordinal as Ticker] ?? {})
  );
}

describe("MarketsView", () => {
  it("renders all seven MAG7 tickers as board rows", () => {
    render(<MarketsView rows={allRows()} />);
    for (const sym of [
      "AAPL",
      "MSFT",
      "GOOGL",
      "AMZN",
      "NVDA",
      "META",
      "TSLA",
    ]) {
      expect(screen.getByTestId(`board-row-${sym}`)).toBeInTheDocument();
    }
  });

  it("shows the price per ticker", () => {
    render(
      <MarketsView
        rows={allRows({
          [Ticker.Meta]: { open: true, displayPrice: 610.26 },
        })}
      />
    );
    expect(screen.getByText("$610.26")).toBeInTheDocument();
  });
});
