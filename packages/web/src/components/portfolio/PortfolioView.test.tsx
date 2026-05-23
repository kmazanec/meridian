import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import BN from "bn.js";
import { Ticker } from "@meridian/sdk";
import type { OpenRow, SettledRow } from "@/lib/portfolio";
import { PortfolioView } from "./PortfolioView";

const openRow: OpenRow = {
  kind: "open",
  market: "MKT",
  ticker: Ticker.Meta,
  strike: new BN(680_000_000),
  side: "yes",
  amount: new BN(2_000_000),
  markPrice: new BN(600_000),
  entryPrice: new BN(500_000),
  value: new BN(1_200_000),
  pnl: new BN(200_000),
};

const settledWinner: SettledRow = {
  kind: "settled",
  market: "MKT2",
  ticker: Ticker.Nvda,
  strike: new BN(120_000_000),
  side: "yes",
  amount: new BN(3_000_000),
  payout: new BN(3_000_000),
  redeemable: true,
};

describe("PortfolioView", () => {
  it("prompts to connect when disconnected", () => {
    render(<PortfolioView rows={[]} onRedeem={() => {}} connected={false} />);
    expect(screen.getByText(/connect a wallet/i)).toBeInTheDocument();
  });

  it("shows an open position's entry, mark, value, and P&L", () => {
    render(<PortfolioView rows={[openRow]} onRedeem={() => {}} connected />);
    expect(screen.getByTestId("open-positions")).toBeInTheDocument();
    // The responsive view renders a desktop table and mobile cards, so values can appear
    // more than once — assert presence via getAllBy.
    expect(screen.getAllByText("$0.50").length).toBeGreaterThan(0); // entry
    expect(screen.getAllByText("$0.60").length).toBeGreaterThan(0); // mark
    expect(screen.getAllByText("$1.20").length).toBeGreaterThan(0); // value
    expect(screen.getAllByTestId("pnl")[0].textContent).toBe("+$0.20");
  });

  it("summarizes the book (position value, open P&L, claimable)", () => {
    render(
      <PortfolioView
        rows={[openRow, settledWinner]}
        onRedeem={() => {}}
        connected
      />
    );
    const summary = screen.getByTestId("portfolio-summary");
    expect(summary).toHaveTextContent("$1.20"); // position value
    expect(summary).toHaveTextContent("+$0.20"); // open P&L
    expect(summary).toHaveTextContent("$3.00"); // claimable
  });

  it("renders a redeem button for a settled winner and fires onRedeem", async () => {
    const onRedeem = vi.fn();
    render(
      <PortfolioView rows={[settledWinner]} onRedeem={onRedeem} connected />
    );
    const btn = screen.getAllByTestId("redeem-MKT2:yes")[0];
    expect(btn).toBeInTheDocument();
    await userEvent.click(btn);
    expect(onRedeem).toHaveBeenCalledWith(settledWinner);
  });

  it("shows Lost (no redeem) for a settled loser", () => {
    render(
      <PortfolioView
        rows={[{ ...settledWinner, payout: new BN(0), redeemable: false }]}
        onRedeem={() => {}}
        connected
      />
    );
    expect(screen.getAllByText("Lost").length).toBeGreaterThan(0);
    expect(screen.queryByTestId("redeem-MKT2:yes")).not.toBeInTheDocument();
  });
});
