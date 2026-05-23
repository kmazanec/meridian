import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import BN from "bn.js";
import { Ticker, TICKER_SYMBOLS } from "@meridian/sdk";
import type { TickerView } from "@/lib/marketStats";
import { MarketsView } from "./MarketsView";

/** A minimal TickerView for one symbol; overrides tune the fields under test. */
function ticker(
  ordinal: Ticker,
  overrides: Partial<TickerView> = {}
): TickerView {
  return {
    ticker: ordinal,
    symbol: TICKER_SYMBOLS[ordinal],
    tradingDay: null,
    activeCount: 0,
    repYesPrice: null,
    totalRestingSize: new BN(0),
    totalPairsMinted: new BN(0),
    totalCollateral: new BN(0),
    rows: [],
    history: null,
    ...overrides,
  };
}

/** All seven tickers, with optional per-ordinal overrides. */
function allTickers(
  overrides: Partial<Record<Ticker, Partial<TickerView>>> = {}
): TickerView[] {
  return TICKER_SYMBOLS.map((_, ordinal) =>
    ticker(ordinal as Ticker, overrides[ordinal as Ticker] ?? {})
  );
}

describe("MarketsView", () => {
  it("renders all seven MAG7 tickers", () => {
    render(<MarketsView tickers={allTickers()} />);
    for (const sym of [
      "AAPL",
      "MSFT",
      "GOOGL",
      "AMZN",
      "NVDA",
      "META",
      "TSLA",
    ]) {
      expect(screen.getByText(sym)).toBeInTheDocument();
    }
  });

  it("shows the live Yes price and implied probability per ticker", () => {
    render(
      <MarketsView
        tickers={allTickers({
          [Ticker.Meta]: { activeCount: 1, repYesPrice: new BN(650_000) },
        })}
      />
    );
    expect(screen.getByText("$0.65")).toBeInTheDocument();
    expect(screen.getByText("65% implied")).toBeInTheDocument();
  });

  it("counts open contracts per ticker", () => {
    render(
      <MarketsView
        tickers={allTickers({ [Ticker.Aapl]: { activeCount: 2 } })}
      />
    );
    expect(screen.getByText("2 open")).toBeInTheDocument();
  });

  it("links each card to the stock's trade/detail page", () => {
    render(<MarketsView tickers={allTickers()} />);
    expect(screen.getByLabelText("View NVDA")).toHaveAttribute(
      "href",
      "/trade/NVDA"
    );
    expect(screen.getByLabelText("View TSLA")).toHaveAttribute(
      "href",
      "/trade/TSLA"
    );
  });
});
