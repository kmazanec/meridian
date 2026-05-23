import { expect } from "chai";
import BN from "bn.js";
import { PublicKey } from "@solana/web3.js";
import {
  OrderSide,
  type OrderBookAccount,
  type OrderEntry,
} from "@meridian/sdk";
import { summarizeBook } from "../src/book";

function order(
  price: number,
  size: number,
  side: OrderSide,
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

describe("summarizeBook", () => {
  it("returns empty summaries for a null (uncreated) book", () => {
    const { yes, no } = summarizeBook(null);
    expect(yes.bestBid).to.equal(null);
    expect(yes.bestAsk).to.equal(null);
    expect(yes.mid).to.equal(null);
    expect(no.bidDepth).to.equal(0);
  });

  it("computes Yes top-of-book and mid from the raw book", () => {
    const book: OrderBookAccount = {
      market: PublicKey.default,
      nextSeq: new BN(10),
      bids: [
        order(600_000, 5_000_000, OrderSide.Bid, 1), // best bid 0.60, 5 tokens
        order(580_000, 3_000_000, OrderSide.Bid, 2),
      ],
      asks: [
        order(640_000, 2_000_000, OrderSide.Ask, 3), // best ask 0.64, 2 tokens
        order(660_000, 4_000_000, OrderSide.Ask, 4),
      ],
      bump: 0,
    };
    const { yes } = summarizeBook(book);
    expect(yes.bestBid).to.equal(0.6);
    expect(yes.bestAsk).to.equal(0.64);
    expect(yes.mid).to.equal(0.62);
    expect(yes.bidDepth).to.equal(8); // 5 + 3
    expect(yes.askDepth).to.equal(6); // 2 + 4
  });

  it("mirrors the No perspective at 1 - price", () => {
    const book: OrderBookAccount = {
      market: PublicKey.default,
      nextSeq: new BN(10),
      bids: [order(600_000, 5_000_000, OrderSide.Bid, 1)], // Yes bid 0.60 → No ask 0.40
      asks: [order(640_000, 2_000_000, OrderSide.Ask, 3)], // Yes ask 0.64 → No bid 0.36
      bump: 0,
    };
    const { no } = summarizeBook(book);
    expect(no.bestBid).to.equal(0.36); // from the Yes ask
    expect(no.bestAsk).to.equal(0.4); // from the Yes bid
    expect(no.mid).to.equal(0.38);
  });
});
