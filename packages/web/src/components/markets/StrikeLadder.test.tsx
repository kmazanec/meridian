import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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

  it("selects an open row when clicked (onSelect provided)", async () => {
    const onSelect = vi.fn();
    const open = row(660_000_000);
    render(<StrikeLadder rows={[open]} onSelect={onSelect} />);
    const r = screen.getByTestId("ladder-row-660000000");
    expect(r).toHaveAttribute("data-selectable", "true");
    await userEvent.click(r);
    expect(onSelect).toHaveBeenCalledWith(open.address);
  });

  it("highlights the selected row", () => {
    const open = row(660_000_000);
    render(
      <StrikeLadder
        rows={[open]}
        onSelect={() => {}}
        selectedAddress={open.address}
      />
    );
    expect(screen.getByTestId("ladder-row-660000000")).toHaveAttribute(
      "data-selected",
      "true"
    );
  });

  it("does not select settled rows", async () => {
    const onSelect = vi.fn();
    const settled = row(700_000_000, {
      state: "settled",
      outcome: Outcome.NoWins,
    });
    render(<StrikeLadder rows={[settled]} onSelect={onSelect} />);
    const r = screen.getByTestId("ladder-row-700000000");
    expect(r).not.toHaveAttribute("data-selectable");
    await userEvent.click(r);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("is read-only when no onSelect is given", () => {
    render(<StrikeLadder rows={[row(660_000_000)]} />);
    expect(screen.getByTestId("ladder-row-660000000")).not.toHaveAttribute(
      "data-selectable"
    );
  });

  it("renders strikes in descending order (highest at the top)", () => {
    render(
      <StrikeLadder
        rows={[row(300_000_000), row(310_000_000), row(320_000_000)]}
      />
    );
    const ids = Array.from(
      document.querySelectorAll("[data-testid^='ladder-row-']")
    ).map((el) => el.getAttribute("data-testid"));
    expect(ids).toEqual([
      "ladder-row-320000000",
      "ladder-row-310000000",
      "ladder-row-300000000",
    ]);
  });

  it("draws the last-close marker between the strikes it falls between", () => {
    // Strikes $300 and $320 (shown descending: $320, $300); last close $308.82 → between.
    render(
      <StrikeLadder
        rows={[row(300_000_000), row(320_000_000)]}
        lastClose={308.82}
      />
    );
    const marker = screen.getByTestId("last-close-marker");
    expect(marker).toHaveTextContent(/last close/i);
    expect(marker).toHaveTextContent("$308.82");

    // Descending display: marker sits after the $320 row and before the $300 row.
    const rows = Array.from(
      document.querySelectorAll(
        "[data-testid^='ladder-row-'], [data-testid='last-close-marker']"
      )
    ).map((el) => el.getAttribute("data-testid"));
    expect(rows).toEqual([
      "ladder-row-320000000",
      "last-close-marker",
      "ladder-row-300000000",
    ]);
  });

  it("places the marker above all strikes when the close is above every strike", () => {
    // Descending display ($320, $300); close $999 is above the top strike → marker first.
    render(
      <StrikeLadder
        rows={[row(300_000_000), row(320_000_000)]}
        lastClose={999}
      />
    );
    const ids = Array.from(
      document.querySelectorAll(
        "[data-testid^='ladder-row-'], [data-testid='last-close-marker']"
      )
    ).map((el) => el.getAttribute("data-testid"));
    expect(ids[0]).toBe("last-close-marker");
  });

  it("places the marker below all strikes when the close is below every strike", () => {
    // Descending display ($320, $300); close $1 is below the bottom strike → marker last.
    render(
      <StrikeLadder
        rows={[row(300_000_000), row(320_000_000)]}
        lastClose={1}
      />
    );
    const ids = Array.from(
      document.querySelectorAll(
        "[data-testid^='ladder-row-'], [data-testid='last-close-marker']"
      )
    ).map((el) => el.getAttribute("data-testid"));
    expect(ids[ids.length - 1]).toBe("last-close-marker");
  });

  it("omits the marker when lastClose is null", () => {
    render(<StrikeLadder rows={[row(300_000_000)]} lastClose={null} />);
    expect(screen.queryByTestId("last-close-marker")).not.toBeInTheDocument();
  });
});
