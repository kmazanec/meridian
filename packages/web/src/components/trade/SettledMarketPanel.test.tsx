import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import BN from "bn.js";
import { PublicKey } from "@solana/web3.js";
import { Outcome, symbolToTicker, type MarketAccount } from "@meridian/sdk";
import { SettledMarketPanel } from "./SettledMarketPanel";

function market(overrides: Partial<MarketAccount> = {}): MarketAccount {
  return {
    ticker: symbolToTicker("NVDA"),
    strike: new BN(220_000_000), // $220
    tradingDay: new BN(0),
    yesMint: PublicKey.default,
    noMint: PublicKey.default,
    vault: PublicKey.default,
    orderBook: PublicKey.default,
    pairsMinted: new BN(0),
    winningRedeemed: new BN(0),
    state: "settled",
    outcome: Outcome.YesWins,
    settlementPrice: new BN(223_450_000), // $223.45
    settledAt: new BN(0),
    bump: 0,
    vaultBump: 0,
    mintAuthorityBump: 0,
    ...overrides,
  };
}

const ticker = symbolToTicker("NVDA");

describe("SettledMarketPanel", () => {
  it("shows the Yes-won verdict and the close price", () => {
    render(<SettledMarketPanel ticker={ticker} market={market()} />);
    expect(screen.getByTestId("settled-verdict")).toHaveTextContent(/yes won/i);
    expect(screen.getByTestId("settled-close")).toHaveTextContent("$223.45");
    expect(screen.getByText(/closed at or above/i)).toHaveTextContent("$220.00");
  });

  it("shows the No-won verdict", () => {
    render(
      <SettledMarketPanel
        ticker={ticker}
        market={market({
          outcome: Outcome.NoWins,
          settlementPrice: new BN(210_000_000),
        })}
      />
    );
    expect(screen.getByTestId("settled-verdict")).toHaveTextContent(/no won/i);
    expect(screen.getByText(/closed below/i)).toBeInTheDocument();
  });

  it("notes the market is closed", () => {
    render(<SettledMarketPanel ticker={ticker} market={market()} />);
    expect(screen.getByTestId("settled-market-panel")).toHaveTextContent(
      /market closed/i
    );
    expect(
      screen.getByText(/trading is closed for this strike/i)
    ).toBeInTheDocument();
  });

  it("omits the close line when there is no settlement price", () => {
    render(
      <SettledMarketPanel
        ticker={ticker}
        market={market({ settlementPrice: null })}
      />
    );
    expect(screen.queryByTestId("settled-close")).not.toBeInTheDocument();
  });
});
