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

  it("shows each strike's Yes price", () => {
    render(<StrikeLadder rows={[row(680_000_000)]} />);
    const r = screen.getByTestId("ladder-row-680000000");
    expect(within(r).getByText("$0.65")).toBeInTheDocument();
  });

  it("does not render an Implied column (it always equals the Yes price)", () => {
    render(<StrikeLadder rows={[row(680_000_000)]} />);
    const ladder = screen.getByTestId("strike-ladder");
    expect(within(ladder).queryByText("Implied")).not.toBeInTheDocument();
    // The 65% implied value must not appear in the row.
    expect(
      within(screen.getByTestId("ladder-row-680000000")).queryByText("65%")
    ).not.toBeInTheDocument();
  });

  it("does not render a Spread column (kept narrow; spread lives in the book)", () => {
    render(<StrikeLadder rows={[row(680_000_000, { spread: new BN(100_000) })]} />);
    const ladder = screen.getByTestId("strike-ladder");
    expect(within(ladder).queryByText("Spread")).not.toBeInTheDocument();
    // The $0.10 spread value must not appear in the row.
    expect(
      within(screen.getByTestId("ladder-row-680000000")).queryByText("$0.10")
    ).not.toBeInTheDocument();
  });

  it("marks open strikes as Open", () => {
    render(<StrikeLadder rows={[row(660_000_000)]} />);
    const r = screen.getByTestId("ladder-row-660000000");
    expect(within(r).getByText("Open")).toBeInTheDocument();
  });

  it("shows the settled outcome badge without the settlement price in the row", () => {
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
    // The close price moved to the AT CLOSE marker — the status cell stays terse.
    expect(within(r).queryByText(/\$712\.34/)).not.toBeInTheDocument();
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

  it("draws the current-price marker positioned among the strikes", () => {
    // Strikes $300 and $320 (shown $320, $300); current $311.50 → between them.
    render(
      <StrikeLadder
        rows={[row(300_000_000), row(320_000_000)]}
        currentPrice={311.5}
      />
    );
    const marker = screen.getByTestId("current-price-marker");
    expect(marker).toHaveTextContent(/current/i);
    expect(marker).toHaveTextContent("$311.50");

    const ids = Array.from(
      document.querySelectorAll(
        "[data-testid^='ladder-row-'], [data-testid='current-price-marker']"
      )
    ).map((el) => el.getAttribute("data-testid"));
    expect(ids).toEqual([
      "ladder-row-320000000",
      "current-price-marker",
      "ladder-row-300000000",
    ]);
  });

  it("omits the current-price marker when currentPrice is null", () => {
    render(<StrikeLadder rows={[row(300_000_000)]} currentPrice={null} />);
    expect(
      screen.queryByTestId("current-price-marker")
    ).not.toBeInTheDocument();
  });

  it("shows both markers, current above last close when current is higher", () => {
    // Strikes $300 / $320 (descending $320, $300). last close $305, current $315.
    // Both fall between the two strikes; higher price (current) renders first.
    render(
      <StrikeLadder
        rows={[row(300_000_000), row(320_000_000)]}
        lastClose={305}
        currentPrice={315}
      />
    );
    const ids = Array.from(
      document.querySelectorAll(
        "[data-testid^='ladder-row-'], [data-testid='current-price-marker'], [data-testid='last-close-marker']"
      )
    ).map((el) => el.getAttribute("data-testid"));
    expect(ids).toEqual([
      "ladder-row-320000000",
      "current-price-marker",
      "last-close-marker",
      "ladder-row-300000000",
    ]);
  });

  it("shows a single AT CLOSE marker (not live markers) when all strikes are settled", () => {
    // Both strikes settled at $311.50 → one green "AT CLOSE" marker among the strikes,
    // and the live last-close / current markers are suppressed (only useful while open).
    const settled = (strike: number) =>
      row(strike, {
        state: "settled",
        outcome: Outcome.YesWins,
        settlementPrice: new BN(311_500_000),
      });
    render(
      <StrikeLadder
        rows={[settled(300_000_000), settled(320_000_000)]}
        lastClose={305}
        currentPrice={315}
      />
    );
    const marker = screen.getByTestId("at-close-marker");
    expect(marker).toHaveTextContent(/at close/i);
    expect(marker).toHaveTextContent("$311.50");
    expect(screen.queryByTestId("last-close-marker")).not.toBeInTheDocument();
    expect(screen.queryByTestId("current-price-marker")).not.toBeInTheDocument();

    const ids = Array.from(
      document.querySelectorAll(
        "[data-testid^='ladder-row-'], [data-testid='at-close-marker']"
      )
    ).map((el) => el.getAttribute("data-testid"));
    expect(ids).toEqual([
      "ladder-row-320000000",
      "at-close-marker",
      "ladder-row-300000000",
    ]);
  });

  it("keeps live markers (no AT CLOSE) while any strike is still open", () => {
    render(
      <StrikeLadder
        rows={[
          row(300_000_000, {
            state: "settled",
            outcome: Outcome.NoWins,
            settlementPrice: new BN(311_500_000),
          }),
          row(320_000_000), // still open
        ]}
        lastClose={305}
      />
    );
    expect(screen.queryByTestId("at-close-marker")).not.toBeInTheDocument();
    expect(screen.getByTestId("last-close-marker")).toBeInTheDocument();
  });
});
