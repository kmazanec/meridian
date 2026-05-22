import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import BN from "bn.js";
import { PublicKey } from "@solana/web3.js";
import { Outcome, Ticker } from "@meridian/sdk";
import type { DiscoveredMarket } from "@/lib/discovery";
import { MarketsView, type LivePrices } from "./MarketsView";

function market(
  ticker: Ticker,
  strike: number,
  state: "open" | "settled" = "open"
): DiscoveredMarket {
  return {
    address: PublicKey.unique(),
    ticker,
    strike: new BN(strike),
    tradingDay: new BN(1_716_321_600),
    state,
    outcome: Outcome.Unsettled,
  };
}

describe("MarketsView", () => {
  it("renders all seven MAG7 tickers", () => {
    render(<MarketsView markets={[]} prices={{}} />);
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
    const prices: LivePrices = { [Ticker.Meta]: new BN(650_000) };
    render(
      <MarketsView
        markets={[market(Ticker.Meta, 680_000_000)]}
        prices={prices}
      />
    );
    expect(screen.getByText("$0.65")).toBeInTheDocument();
    expect(screen.getByText("65%")).toBeInTheDocument();
  });

  it("counts active (open) contracts per ticker", () => {
    const markets = [
      market(Ticker.Aapl, 180_000_000, "open"),
      market(Ticker.Aapl, 190_000_000, "open"),
      market(Ticker.Aapl, 200_000_000, "settled"),
    ];
    render(<MarketsView markets={markets} prices={{}} />);
    // AAPL has 2 open of 3 total.
    expect(screen.getByText("2 active")).toBeInTheDocument();
  });

  it("links each card to its trade page", () => {
    render(<MarketsView markets={[]} prices={{}} />);
    expect(screen.getByLabelText("Trade NVDA")).toHaveAttribute(
      "href",
      "/trade/NVDA"
    );
  });
});
