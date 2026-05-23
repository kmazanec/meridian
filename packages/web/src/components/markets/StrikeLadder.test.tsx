import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import BN from "bn.js";
import { PublicKey } from "@solana/web3.js";
import { Outcome, type BookView } from "@meridian/sdk";
import type { StrikeRow } from "@/lib/marketStats";
import { StrikeLadder } from "./StrikeLadder";

const emptyBook: BookView = { bids: [], asks: [] };

function row(strike: number, overrides: Partial<StrikeRow> = {}): StrikeRow {
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
    ...overrides,
  };
}

describe("StrikeLadder", () => {
  it("renders an empty-state message with no rows", () => {
    render(<StrikeLadder rows={[]} />);
    expect(screen.getByTestId("strike-ladder")).toHaveTextContent(
      "No markets for this stock today."
    );
  });

  it("shows each strike's Yes price and implied probability", () => {
    render(<StrikeLadder rows={[row(680_000_000)]} />);
    const r = screen.getByTestId("ladder-row-680000000");
    expect(within(r).getByText("$0.65")).toBeInTheDocument();
    expect(within(r).getByText("65%")).toBeInTheDocument();
  });

  it("marks open strikes as Open", () => {
    render(<StrikeLadder rows={[row(660_000_000)]} />);
    const r = screen.getByTestId("ladder-row-660000000");
    expect(within(r).getByText("Open")).toBeInTheDocument();
  });

  it("shows settled outcome and settlement price for settled strikes", () => {
    render(
      <StrikeLadder
        rows={[
          row(700_000_000, {
            state: "settled",
            outcome: Outcome.YesWins,
            settlementPrice: new BN(712_340_000),
          }),
        ]}
      />
    );
    const r = screen.getByTestId("ladder-row-700000000");
    expect(within(r).getByText(/Yes won/)).toBeInTheDocument();
    expect(within(r).getByText(/\$712\.34/)).toBeInTheDocument();
  });
});
