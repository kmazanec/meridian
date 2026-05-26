import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import BN from "bn.js";
import { PublicKey } from "@solana/web3.js";
import {
  dualBook,
  OrderSide,
  TradeAction,
  type OrderBookAccount,
  type OrderEntry,
} from "@meridian/sdk";
import { MergedBookView } from "./MergedBookView";

function order(
  side: OrderSide,
  price: number,
  size: number,
  seq: number
): OrderEntry {
  return {
    owner: PublicKey.default,
    price: new BN(price),
    size: new BN(size),
    seq: new BN(seq),
    side,
    active: true,
  };
}

const book: OrderBookAccount = {
  market: PublicKey.default,
  nextSeq: new BN(5),
  bids: [
    order(OrderSide.Bid, 600_000, 1_000_000, 1), // $0.60, size 1
    order(OrderSide.Bid, 500_000, 4_000_000, 2), // $0.50, size 4  ← biggest
  ],
  asks: [
    order(OrderSide.Ask, 700_000, 2_000_000, 3), // $0.70, size 2
  ],
  bump: 0,
};

describe("MergedBookView", () => {
  it("renders one merged book on a single Yes price axis", () => {
    render(<MergedBookView view={dualBook(book).yes} />);
    expect(screen.getByTestId("merged-book")).toBeInTheDocument();
    // No second "No" column — the No perspective is the 1−price mirror.
    expect(screen.queryByTestId("book-no")).not.toBeInTheDocument();
  });

  it("shows the actual Yes bid and ask prices", () => {
    render(<MergedBookView view={dualBook(book).yes} />);
    expect(screen.getByText("$0.60")).toBeInTheDocument();
    expect(screen.getByText("$0.50")).toBeInTheDocument();
    expect(screen.getByText("$0.70")).toBeInTheDocument();
  });

  it("renders the spread between best bid and best ask", () => {
    render(<MergedBookView view={dualBook(book).yes} />);
    // best ask 0.70 − best bid 0.60 = 0.10
    expect(
      within(screen.getByTestId("spread-band")).getByText(/0\.10/)
    ).toBeInTheDocument();
  });

  it("scales each side against its own largest level", () => {
    render(<MergedBookView view={dualBook(book).yes} />);
    const bidPcts = screen
      .getAllByTestId("row-bid")
      .map((r) => Number(r.dataset.sizePct));
    // Bids scale to the bid max (4): size 4 → 100%, size 1 → 25%.
    expect(bidPcts).toContain(100);
    expect(bidPcts).toContain(25);
    // The lone ask is its own side's max → 100%, even though it's smaller than the
    // biggest bid (per-side, not shared, scaling).
    const askPcts = screen
      .getAllByTestId("row-ask")
      .map((r) => Number(r.dataset.sizePct));
    expect(askPcts).toEqual([100]);
  });

  it("renders empty-side messaging when one side has no orders", () => {
    const oneSided: OrderBookAccount = { ...book, asks: [] };
    render(<MergedBookView view={dualBook(oneSided).yes} />);
    expect(screen.getByText("no asks")).toBeInTheDocument();
  });

  it("opens a Buy Yes limit at the clicked ask price", async () => {
    const onPick = vi.fn();
    render(<MergedBookView view={dualBook(book).yes} onPick={onPick} />);
    // The lone ask is $0.70 → a buyer lifting it is Buy Yes @ 0.70.
    await userEvent.click(
      within(screen.getByTestId("side-ask")).getByTestId("row-ask")
    );
    expect(onPick).toHaveBeenCalledTimes(1);
    const [action, price] = onPick.mock.calls[0];
    expect(action).toBe(TradeAction.BuyYes);
    expect(price.toNumber()).toBe(700_000);
  });

  it("opens a Sell Yes limit at the clicked bid price", async () => {
    const onPick = vi.fn();
    render(<MergedBookView view={dualBook(book).yes} onPick={onPick} />);
    // Click the best bid ($0.60) → a seller hitting it is Sell Yes @ 0.60.
    const bidRows = within(screen.getByTestId("side-bid")).getAllByTestId(
      "row-bid"
    );
    await userEvent.click(bidRows[0]);
    const [action, price] = onPick.mock.calls[0];
    expect(action).toBe(TradeAction.SellYes);
    expect(price.toNumber()).toBe(600_000);
  });

  it("rows are static (not buttons) without an onPick handler", () => {
    render(<MergedBookView view={dualBook(book).yes} />);
    // Read-only context: the price rows must not be clickable.
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });
});
