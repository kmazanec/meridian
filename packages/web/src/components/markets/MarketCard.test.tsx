import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import BN from "bn.js";
import { PublicKey } from "@solana/web3.js";
import { Outcome, Ticker, type BookView } from "@meridian/sdk";
import type { StrikeRow, TickerView } from "@/lib/marketStats";
import { MarketCard } from "./MarketCard";

const emptyBook: BookView = { bids: [], asks: [] };

function row(strike: number): StrikeRow {
  return {
    address: PublicKey.unique().toBase58(),
    strike: new BN(strike),
    state: "open",
    outcome: Outcome.Unsettled,
    yesPrice: new BN(650_000),
    noPrice: new BN(350_000),
    spread: new BN(100_000),
    restingSize: new BN(2_000_000),
    depth: emptyBook,
    settlementPrice: null,
  };
}

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
    rows: [row(660_000_000), row(680_000_000)],
    history: [
      { date: "2026-05-01", close: 100 },
      { date: "2026-05-02", close: 110 },
    ],
    ...overrides,
  };
}

describe("MarketCard", () => {
  it("shows the summary: symbol, active count, Yes price, sparkline", () => {
    render(<MarketCard view={view()} expanded={false} onToggle={() => {}} />);
    const card = screen.getByTestId("market-card-NVDA");
    expect(within(card).getByText("NVDA")).toBeInTheDocument();
    expect(within(card).getByText("2 active")).toBeInTheDocument();
    expect(within(card).getByText("$0.65")).toBeInTheDocument();
    expect(within(card).getByTestId("sparkline")).toBeInTheDocument();
  });

  it("hides the strike ladder until expanded", () => {
    const { rerender } = render(
      <MarketCard view={view()} expanded={false} onToggle={() => {}} />
    );
    expect(screen.queryByTestId("strike-ladder")).not.toBeInTheDocument();
    rerender(<MarketCard view={view()} expanded onToggle={() => {}} />);
    expect(screen.getByTestId("strike-ladder")).toBeInTheDocument();
    expect(screen.getByTestId("ladder-row-660000000")).toBeInTheDocument();
  });

  it("calls onToggle when the summary is clicked", async () => {
    const onToggle = vi.fn();
    render(<MarketCard view={view()} expanded={false} onToggle={onToggle} />);
    await userEvent.click(screen.getByText("NVDA"));
    expect(onToggle).toHaveBeenCalledOnce();
  });

  it("falls back gracefully when there is no open market", () => {
    render(
      <MarketCard
        view={view({ activeCount: 0, repYesPrice: null, tradingDay: null })}
        expanded={false}
        onToggle={() => {}}
      />
    );
    const card = screen.getByTestId("market-card-NVDA");
    expect(within(card).getByText("no open market")).toBeInTheDocument();
    expect(within(card).queryByTestId("countdown")).not.toBeInTheDocument();
  });
});
