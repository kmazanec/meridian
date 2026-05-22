import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import BN from "bn.js";
import { PublicKey } from "@solana/web3.js";
import {
  dualBook,
  OrderSide,
  type OrderBookAccount,
  type OrderEntry,
} from "@meridian/sdk";
import { DualBookView } from "./DualBookView";

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
  bids: [order(OrderSide.Bid, 600_000, 1_000_000, 1)],
  asks: [order(OrderSide.Ask, 700_000, 2_000_000, 2)],
  bump: 0,
};

describe("DualBookView", () => {
  it("renders both the Yes and No perspectives of the one book", () => {
    render(<DualBookView book={dualBook(book)} />);
    expect(screen.getByTestId("book-yes")).toBeInTheDocument();
    expect(screen.getByTestId("book-no")).toBeInTheDocument();
  });

  it("shows the Yes book's actual prices", () => {
    render(<DualBookView book={dualBook(book)} />);
    const yes = screen.getByTestId("book-yes");
    expect(within(yes).getByText("$0.60")).toBeInTheDocument(); // bid
    expect(within(yes).getByText("$0.70")).toBeInTheDocument(); // ask
  });

  it("renders the No book as the 1 − price mirror", () => {
    render(<DualBookView book={dualBook(book)} />);
    const no = screen.getByTestId("book-no");
    // Yes bid 0.60 → No ask 0.40; Yes ask 0.70 → No bid 0.30.
    expect(within(no).getByText("$0.40")).toBeInTheDocument();
    expect(within(no).getByText("$0.30")).toBeInTheDocument();
  });
});
