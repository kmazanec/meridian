import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import BN from "bn.js";
import { PublicKey } from "@solana/web3.js";
import { Outcome, PRICE_SCALE, Ticker, type Ticker as T } from "@meridian/sdk";
import type { MarketsBoardRow, StrikeRow } from "@/lib/marketStats";
import { MarketsBoard } from "./MarketsBoard";

// Strike sub-rows deep-link by pushing to the Next router on click.
const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}));
beforeEach(() => push.mockClear());

function strikeRow(
  strikeDollars: number,
  yesFraction: number,
  depth: StrikeRow["depth"] = { bids: [], asks: [] }
): StrikeRow {
  const yesPrice = new BN(Math.round(yesFraction * PRICE_SCALE.toNumber()));
  return {
    address: PublicKey.unique().toBase58(),
    strike: new BN(strikeDollars * 1_000_000),
    state: "open",
    outcome: Outcome.Unsettled,
    yesPrice,
    noPrice: PRICE_SCALE.sub(yesPrice),
    spread: null,
    restingSize: new BN(0),
    depth,
    settlementPrice: null,
  };
}

/** A book level (price/size in base units) for building a non-empty depth. */
function level(price: number, size: number) {
  return { price: new BN(price), size: new BN(size), count: 1 };
}

function row(
  ticker: T,
  symbol: string,
  overrides: Partial<MarketsBoardRow> = {}
): MarketsBoardRow {
  const rows = overrides.rows ?? [strikeRow(210, 0.5)];
  return {
    ticker,
    symbol,
    displayPrice: 211,
    changePct: -0.01,
    livePrice: 211,
    pctFromOpen: -0.01,
    open: true,
    atmRow: rows.find((r) => r.state === "open") ?? null,
    liquidity: new BN(0),
    tradingDay: new BN(1_700_000_000),
    settlementPrice: null,
    outcome: Outcome.Unsettled,
    rows,
    history: null,
    ...overrides,
  };
}

describe("MarketsBoard", () => {
  it("renders the live price and today's move per row", () => {
    render(
      <MarketsBoard
        rows={[
          row(Ticker.Nvda, "NVDA", { displayPrice: 211.59, changePct: -0.017 }),
        ]}
      />
    );
    const r = screen.getByTestId("board-row-NVDA");
    expect(within(r).getByText("$211.59")).toBeInTheDocument();
    expect(within(r).getByText(/-1\.70%/)).toBeInTheDocument();
  });

  it("features the nearest-the-money bet", () => {
    render(
      <MarketsBoard
        rows={[row(Ticker.Nvda, "NVDA", { rows: [strikeRow(210, 0.66)] })]}
      />
    );
    const r = screen.getByTestId("board-row-NVDA");
    expect(within(r).getByText(/≥\$210/)).toBeInTheDocument();
    expect(within(r).getByText(/Yes \$0\.66/)).toBeInTheDocument();
  });

  it("expands a row to its strike ladder on click", async () => {
    render(
      <MarketsBoard
        rows={[
          row(Ticker.Nvda, "NVDA", {
            rows: [strikeRow(220, 0.3), strikeRow(210, 0.66)],
          }),
        ]}
      />
    );
    expect(screen.queryByTestId("strip-row-210000000")).not.toBeInTheDocument();
    await userEvent.click(screen.getByTestId("board-row-NVDA"));
    expect(screen.getByTestId("strip-row-220000000")).toBeInTheDocument();
    expect(screen.getByTestId("strip-row-210000000")).toBeInTheDocument();
  });

  it("strike rows in the expander deep-link to the trade page on click", async () => {
    render(
      <MarketsBoard
        rows={[row(Ticker.Nvda, "NVDA", { rows: [strikeRow(210, 0.66)] })]}
      />
    );
    await userEvent.click(screen.getByTestId("board-row-NVDA"));
    await userEvent.click(screen.getByTestId("strip-row-210000000"));
    expect(push).toHaveBeenCalledWith("/trade/NVDA?strike=210");
  });

  it("renders a depth bar per strike in the expander", async () => {
    // Bid 75 / ask 25 → the bar should encode a 75% bid share.
    const depth = { bids: [level(60, 75)], asks: [level(70, 25)] };
    render(
      <MarketsBoard
        rows={[row(Ticker.Nvda, "NVDA", { rows: [strikeRow(210, 0.66, depth)] })]}
      />
    );
    await userEvent.click(screen.getByTestId("board-row-NVDA"));
    const strip = screen.getByTestId("strip-row-210000000");
    const bar = within(strip).getByTestId("depth-bar");
    expect(bar).toBeInTheDocument();
    expect(bar).toHaveAttribute("data-bid-pct", "75");
  });

  it("sorts open stocks above closed ones, and re-sorts on control change", async () => {
    const closed = row(Ticker.Aapl, "AAPL", {
      open: false,
      outcome: Outcome.NoWins,
      rows: [
        { ...strikeRow(310, 0.5), state: "settled", outcome: Outcome.NoWins },
      ],
      atmRow: null,
    });
    const openRow = row(Ticker.Tsla, "TSLA", {
      livePrice: 426,
      pctFromOpen: 0.02,
    });
    render(<MarketsBoard rows={[closed, openRow]} />);
    const order = () =>
      screen
        .getAllByTestId(/^board-row-/)
        .map((el) => el.getAttribute("data-testid"));
    // Default "action": open TSLA above closed AAPL.
    expect(order()).toEqual(["board-row-TSLA", "board-row-AAPL"]);
    // Switching to "symbol" still keeps open above closed.
    await userEvent.click(screen.getByTestId("sort-symbol"));
    expect(order()).toEqual(["board-row-TSLA", "board-row-AAPL"]);
  });

  it("shows a closed stock's close price + 'Closed' status, not a per-ticker outcome", () => {
    const closed = row(Ticker.Aapl, "AAPL", {
      open: false,
      displayPrice: 311.5, // settled close
      changePct: 0.013,
      outcome: Outcome.YesWins,
      settlementPrice: new BN(311_500_000),
      atmRow: null,
      rows: [
        {
          ...strikeRow(310, 0.5),
          state: "settled",
          outcome: Outcome.YesWins,
          settlementPrice: new BN(311_500_000),
        },
      ],
    });
    render(<MarketsBoard rows={[closed]} />);
    const r = screen.getByTestId("board-row-AAPL");
    // Close price shows (not a dash); status reads "Closed" (appears under the symbol and
    // in the status column).
    expect(within(r).getByText("$311.50")).toBeInTheDocument();
    expect(within(r).getAllByText(/^Closed$/i).length).toBeGreaterThan(0);
    expect(within(r).getByText(/1 strike/)).toBeInTheDocument();
    // No meaningless per-ticker "Yes won" on the collapsed row.
    expect(within(r).queryByText(/Yes won/i)).not.toBeInTheDocument();
  });

  it("surfaces each strike's Yes/No result in the expander", async () => {
    const closed = row(Ticker.Aapl, "AAPL", {
      open: false,
      displayPrice: 311.5,
      atmRow: null,
      rows: [
        {
          ...strikeRow(310, 0.5),
          state: "settled",
          outcome: Outcome.YesWins,
          settlementPrice: new BN(311_500_000),
        },
        {
          ...strikeRow(320, 0.4),
          state: "settled",
          outcome: Outcome.NoWins,
          settlementPrice: new BN(311_500_000),
        },
      ],
    });
    render(<MarketsBoard rows={[closed]} />);
    await userEvent.click(screen.getByTestId("board-row-AAPL"));
    expect(screen.getByTestId("strip-row-310000000")).toHaveTextContent(
      /Yes won/i
    );
    expect(screen.getByTestId("strip-row-320000000")).toHaveTextContent(
      /No won/i
    );
  });
});
