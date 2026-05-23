import { expect } from "chai";
import BN from "bn.js";
import { Keypair, PublicKey } from "@solana/web3.js";
import {
  OrderSide,
  ata,
  type OrderBookAccount,
  type OrderEntry,
} from "@meridian/sdk";
import { makerAccountsFor } from "../src/crossing";

const USDC = Keypair.generate().publicKey;
const YES = Keypair.generate().publicKey;

function order(
  owner: PublicKey,
  price: number,
  size: number,
  side: OrderSide,
  seq: number
): OrderEntry {
  return {
    owner,
    price: new BN(price),
    size: new BN(size),
    seq: new BN(seq),
    side,
    active: true,
  };
}

function book(bids: OrderEntry[], asks: OrderEntry[]): OrderBookAccount {
  return {
    market: PublicKey.default,
    nextSeq: new BN(99),
    bids,
    asks,
    bump: 0,
  };
}

describe("makerAccountsFor", () => {
  const sellerA = Keypair.generate().publicKey;
  const sellerB = Keypair.generate().publicKey;

  it("a Yes bid crosses asks priced <= limit, makers get their USDC ATA", () => {
    const b = book(
      [],
      [
        order(sellerA, 640_000, 1_000_000, OrderSide.Ask, 1), // 0.64, crossable at 0.65
        order(sellerB, 700_000, 1_000_000, OrderSide.Ask, 2), // 0.70, NOT crossable
      ]
    );
    const makers = makerAccountsFor({
      book: b,
      side: OrderSide.Bid,
      price: new BN(650_000), // 0.65
      size: new BN(1_000_000),
      isMarket: false,
      usdcMint: USDC,
      yesMint: YES,
    });
    expect(makers).to.have.length(1);
    expect(makers[0].equals(ata(USDC, sellerA))).to.equal(true);
  });

  it("stops once enough makers cover the size, cheapest first", () => {
    const b = book(
      [],
      [
        order(sellerB, 660_000, 1_000_000, OrderSide.Ask, 2), // 0.66
        order(sellerA, 640_000, 1_000_000, OrderSide.Ask, 1), // 0.64 — cheaper, filled first
      ]
    );
    const makers = makerAccountsFor({
      book: b,
      side: OrderSide.Bid,
      price: new BN(700_000),
      size: new BN(1_000_000), // only need one maker's worth
      isMarket: false,
      usdcMint: USDC,
      yesMint: YES,
    });
    expect(makers).to.have.length(1);
    expect(makers[0].equals(ata(USDC, sellerA))).to.equal(true); // cheapest ask first
  });

  it("a Yes ask crosses bids priced >= limit, makers get their Yes ATA", () => {
    const buyer = Keypair.generate().publicKey;
    const b = book([order(buyer, 600_000, 2_000_000, OrderSide.Bid, 1)], []);
    const makers = makerAccountsFor({
      book: b,
      side: OrderSide.Ask,
      price: new BN(550_000), // selling at 0.55, crosses the 0.60 bid
      size: new BN(1_000_000),
      isMarket: false,
      usdcMint: USDC,
      yesMint: YES,
    });
    expect(makers).to.have.length(1);
    expect(makers[0].equals(ata(YES, buyer))).to.equal(true);
  });

  it("a market order crosses any resting order regardless of price", () => {
    const b = book([], [order(sellerA, 990_000, 1_000_000, OrderSide.Ask, 1)]);
    const makers = makerAccountsFor({
      book: b,
      side: OrderSide.Bid,
      price: new BN(0),
      size: new BN(1_000_000),
      isMarket: true,
      usdcMint: USDC,
      yesMint: YES,
    });
    expect(makers).to.have.length(1);
  });
});
