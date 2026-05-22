// @vitest-environment node
// ATA derivation (`getAssociatedTokenAddressSync` → on-curve check) needs Node's
// crypto path; jsdom lacks it and throws "Unable to find a viable program address
// nonce". This is pure chain logic with no DOM, so run it in the node environment
// (the real browser has the curve primitive — only jsdom doesn't).
import { describe, it, expect } from "vitest";
import BN from "bn.js";
import { Keypair, PublicKey } from "@solana/web3.js";
import {
  OrderSide,
  ata,
  type OrderBookAccount,
  type OrderEntry,
} from "@meridian/sdk";
import { makerAccountsFor, isMarketable } from "./crossing";

const usdcMint = Keypair.generate().publicKey;
const yesMint = Keypair.generate().publicKey;
const makerA = Keypair.generate().publicKey;
const makerB = Keypair.generate().publicKey;

function order(
  owner: PublicKey,
  side: OrderSide,
  price: number,
  size: number,
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

const book: OrderBookAccount = {
  market: PublicKey.default,
  nextSeq: new BN(10),
  bids: [order(makerA, OrderSide.Bid, 600_000, 1_000_000, 1)],
  asks: [
    order(makerA, OrderSide.Ask, 700_000, 1_000_000, 2),
    order(makerB, OrderSide.Ask, 720_000, 1_000_000, 3),
  ],
  bump: 0,
};

describe("crossing", () => {
  it("a Yes bid crossing asks lists each maker's USDC account (they receive USDC)", () => {
    // Bid at 0.72 for 2 tokens crosses both asks (0.70 then 0.72).
    const accts = makerAccountsFor({
      book,
      side: OrderSide.Bid,
      price: new BN(720_000),
      size: new BN(2_000_000),
      isMarket: false,
      usdcMint,
      yesMint,
    });
    expect(accts).toEqual([ata(usdcMint, makerA), ata(usdcMint, makerB)]);
  });

  it("only includes makers needed to fill the size, cheapest first", () => {
    // Bid for just 1 token fills only the cheapest ask (maker A @ 0.70).
    const accts = makerAccountsFor({
      book,
      side: OrderSide.Bid,
      price: new BN(720_000),
      size: new BN(1_000_000),
      isMarket: false,
      usdcMint,
      yesMint,
    });
    expect(accts).toEqual([ata(usdcMint, makerA)]);
  });

  it("a Yes ask crossing bids lists makers' Yes accounts (they receive Yes)", () => {
    const accts = makerAccountsFor({
      book,
      side: OrderSide.Ask,
      price: new BN(600_000),
      size: new BN(1_000_000),
      isMarket: false,
      usdcMint,
      yesMint,
    });
    expect(accts).toEqual([ata(yesMint, makerA)]);
  });

  it("a non-crossing limit lists no makers", () => {
    // Bid below the best ask doesn't cross.
    const accts = makerAccountsFor({
      book,
      side: OrderSide.Bid,
      price: new BN(650_000),
      size: new BN(1_000_000),
      isMarket: false,
      usdcMint,
      yesMint,
    });
    expect(accts).toEqual([]);
  });

  it("isMarketable detects when an order crosses resting liquidity", () => {
    expect(
      isMarketable({
        book,
        side: OrderSide.Bid,
        price: new BN(700_000),
        isMarket: false,
      })
    ).toBe(true);
    expect(
      isMarketable({
        book,
        side: OrderSide.Bid,
        price: new BN(650_000),
        isMarket: false,
      })
    ).toBe(false);
    // A market order always crosses if there's anything resting.
    expect(
      isMarketable({
        book,
        side: OrderSide.Bid,
        price: new BN(0),
        isMarket: true,
      })
    ).toBe(true);
  });
});
