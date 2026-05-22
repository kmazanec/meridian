import { describe, it, expect } from "vitest";
import BN from "bn.js";
import {
  dualBook,
  OrderSide,
  PRICE_SCALE,
  type OrderBookAccount,
  type OrderEntry,
} from "@meridian/sdk";
import { PublicKey } from "@solana/web3.js";
import { priceFromBook } from "./market-math";

// Sanity-check that the SDK's dual-perspective projection behaves as the UI relies on:
// the No view is the exact `1 − p` mirror of the one Yes book. This guards the
// contract the frontend leans on (it never re-derives the No side itself).

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
  nextSeq: new BN(10),
  bids: [
    order(OrderSide.Bid, 600_000, 1_000_000, 1),
    order(OrderSide.Bid, 580_000, 2_000_000, 2),
  ],
  asks: [
    order(OrderSide.Ask, 700_000, 1_000_000, 3),
    order(OrderSide.Ask, 720_000, 500_000, 4),
  ],
  bump: 0,
};

describe("dual-perspective book (SDK contract the UI relies on)", () => {
  it("mirrors the Yes book into the No book at 1 − price", () => {
    const { yes, no } = dualBook(book);

    // Best Yes bid is 600_000; it appears as the best No ask at 400_000.
    expect(yes.bids[0].price.toNumber()).toBe(600_000);
    expect(no.asks[0].price.toNumber()).toBe(400_000);
    expect(yes.bids[0].price.add(no.asks[0].price).toNumber()).toBe(
      PRICE_SCALE.toNumber()
    );

    // Best Yes ask 700_000 ↔ best No bid 300_000.
    expect(yes.asks[0].price.toNumber()).toBe(700_000);
    expect(no.bids[0].price.toNumber()).toBe(300_000);

    // Sizes are preserved across the mirror.
    expect(no.asks[0].size.toNumber()).toBe(yes.bids[0].size.toNumber());
  });

  it("derives a complementary live price in each perspective", () => {
    const { yes, no } = dualBook(book);
    const yesPx = priceFromBook(yes); // mid of 600k/700k = 650k
    const noPx = priceFromBook(no); // mid of 300k/400k = 350k
    expect(yesPx.toNumber()).toBe(650_000);
    expect(noPx.toNumber()).toBe(350_000);
    expect(yesPx.add(noPx).toNumber()).toBe(PRICE_SCALE.toNumber());
  });
});
