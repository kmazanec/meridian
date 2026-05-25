import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import BN from "bn.js";
import { Ticker } from "@meridian/sdk";
import type { OpenRow, SettledRow } from "@/lib/portfolio";
import type { HistoryEntry } from "@/lib/history";
import { PortfolioView } from "./PortfolioView";

const openRow: OpenRow = {
  kind: "open",
  market: "MKT",
  ticker: Ticker.Meta,
  strike: new BN(680_000_000),
  side: "yes",
  amount: new BN(2_000_000),
  tradingDay: new BN(1_700_000_000),
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
  tradingDay: new BN(1_700_000_000),
  payout: new BN(3_000_000),
  redeemable: true,
  redeemed: false,
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
        rows={[
          {
            ...settledWinner,
            payout: new BN(0),
            redeemable: false,
            redeemed: false,
          },
        ]}
        onRedeem={() => {}}
        connected
      />
    );
    expect(screen.getAllByText("Lost").length).toBeGreaterThan(0);
    expect(screen.queryByTestId("redeem-MKT2:yes")).not.toBeInTheDocument();
  });

  it("shows a claimed winner as Won (not Lost, no redeem button)", () => {
    render(
      <PortfolioView
        rows={[{ ...settledWinner, redeemable: false, redeemed: true }]}
        onRedeem={() => {}}
        connected
      />
    );
    expect(screen.getAllByText(/Won · claimed/).length).toBeGreaterThan(0);
    expect(screen.queryByTestId("redeem-MKT2:yes")).not.toBeInTheDocument();
    expect(screen.queryAllByText("Lost")).toHaveLength(0);
  });

  it("always shows the wallet strip (USDC + SOL) when connected", () => {
    render(
      <PortfolioView
        rows={[]}
        onRedeem={() => {}}
        connected
        usdcBalance={new BN(1_240_000_000)} // $1,240
        solLamports={2_413_000_000} // 2.413 SOL
      />
    );
    const strip = screen.getByTestId("wallet-strip");
    expect(strip).toHaveTextContent("$1,240.00");
    expect(strip).toHaveTextContent("2.413 SOL");
  });

  it("shows a dash for unknown balances rather than $0", () => {
    render(<PortfolioView rows={[]} onRedeem={() => {}} connected />);
    const strip = screen.getByTestId("wallet-strip");
    expect(strip).toHaveTextContent("USDC balance");
    // null balances render as em-dashes, not a misleading zero.
    expect(strip.textContent).toContain("—");
  });

  it("invites the next trade when there are no open positions and the board is live", () => {
    render(<PortfolioView rows={[]} onRedeem={() => {}} connected boardOpen />);
    const empty = screen.getByTestId("open-empty");
    expect(empty).toHaveTextContent(/board is live/i);
    expect(
      screen.getByRole("link", { name: /browse markets/i })
    ).toHaveAttribute("href", "/markets");
  });

  it("frames the wait when the board is closed", () => {
    render(
      <PortfolioView
        rows={[]}
        onRedeem={() => {}}
        connected
        boardOpen={false}
      />
    );
    expect(screen.getByTestId("open-empty")).toHaveTextContent(
      /board is closed/i
    );
  });

  it("shows a lifetime record once anything has settled", () => {
    render(
      <PortfolioView
        rows={[
          settledWinner,
          {
            ...settledWinner,
            market: "MKT3",
            payout: new BN(0),
            redeemable: false,
          },
        ]}
        onRedeem={() => {}}
        connected
      />
    );
    const stats = screen.getByTestId("lifetime-stats");
    expect(stats).toHaveTextContent(/win rate/i);
    expect(stats).toHaveTextContent("50%"); // 1 of 2 won
    expect(stats).toHaveTextContent("$3.00"); // total won
    expect(stats).toHaveTextContent("2"); // markets traded
  });

  it("hides the lifetime record when nothing has settled", () => {
    render(<PortfolioView rows={[openRow]} onRedeem={() => {}} connected />);
    expect(screen.queryByTestId("lifetime-stats")).not.toBeInTheDocument();
  });

  it("previews recent activity with a link to the full history", () => {
    const entry: HistoryEntry = {
      kind: "redeemed",
      signature: "sig123",
      blockTime: 1_700_000_000,
      market: "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU",
      summary: "Redeemed NVDA Yes",
      price: null,
      size: new BN(5_000_000),
      asset: "tok",
    };
    render(
      <PortfolioView
        rows={[]}
        onRedeem={() => {}}
        connected
        recentActivity={[entry]}
      />
    );
    const feed = screen.getByTestId("recent-activity");
    expect(feed).toHaveTextContent("Redeemed NVDA Yes");
    expect(screen.getByRole("link", { name: /view all/i })).toHaveAttribute(
      "href",
      "/history"
    );
  });
});
