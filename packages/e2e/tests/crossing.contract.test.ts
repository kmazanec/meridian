/**
 * Pure contract test for the vendored crossing helpers — runs in CI (no validator).
 *
 * `src/crossing.ts` copies the frontend's maker-account computation and four-button→Yes-book
 * mapping so the convergence suite proves the same crossing logic the UI relies on. Copying
 * risks drift, so this test pins both halves:
 *   1. `makerAccountsFor` selects/orders maker payout accounts exactly as the program matches
 *      (best price first, time priority, only enough to fill, correct payout mint per side);
 *   2. `yesSideFor` / `yesPriceFor` agree with the SDK's own `buildTradeIntent` about which
 *      Yes-book side and price each action lands on — so if the SDK ever changes the mapping,
 *      this fails instead of the suite silently feeding wrong `remaining_accounts`.
 *
 * Mirrors packages/web/src/lib/{crossing,tradeForm.contract}.test.ts (their reference impl).
 */

import { expect } from "chai";
import BN from "bn.js";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import {
  OrderSide,
  TradeAction,
  Ticker,
  ata,
  getProgram,
  buildTradeIntent,
  PRICE_SCALE,
  type OrderBookAccount,
  type OrderEntry,
} from "@meridian/sdk";
import { makerAccountsFor, yesSideFor, yesPriceFor } from "../src/crossing";

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

describe("crossing helpers (contract)", () => {
  it("a Yes bid crossing asks lists each maker's USDC account (they receive USDC)", () => {
    const accts = makerAccountsFor({
      book,
      side: OrderSide.Bid,
      price: new BN(720_000),
      size: new BN(2_000_000),
      isMarket: false,
      usdcMint,
      yesMint,
    });
    expect(accts.map((a) => a.toBase58())).to.deep.equal([
      ata(usdcMint, makerA).toBase58(),
      ata(usdcMint, makerB).toBase58(),
    ]);
  });

  it("only includes makers needed to fill the size, cheapest first", () => {
    const accts = makerAccountsFor({
      book,
      side: OrderSide.Bid,
      price: new BN(720_000),
      size: new BN(1_000_000),
      isMarket: false,
      usdcMint,
      yesMint,
    });
    expect(accts.map((a) => a.toBase58())).to.deep.equal([
      ata(usdcMint, makerA).toBase58(),
    ]);
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
    expect(accts.map((a) => a.toBase58())).to.deep.equal([
      ata(yesMint, makerA).toBase58(),
    ]);
  });

  it("a non-crossing limit lists no makers", () => {
    const accts = makerAccountsFor({
      book,
      side: OrderSide.Bid,
      price: new BN(650_000),
      size: new BN(1_000_000),
      isMarket: false,
      usdcMint,
      yesMint,
    });
    expect(accts).to.deep.equal([]);
  });

  it("a market order crosses the whole opposite side", () => {
    const accts = makerAccountsFor({
      book,
      side: OrderSide.Bid,
      price: new BN(0),
      size: new BN(2_000_000),
      isMarket: true,
      usdcMint,
      yesMint,
    });
    expect(accts.map((a) => a.toBase58())).to.deep.equal([
      ata(usdcMint, makerA).toBase58(),
      ata(usdcMint, makerB).toBase58(),
    ]);
  });

  it("yesPriceFor reflects No-action prices and passes Yes-action prices through", () => {
    const p = new BN(300_000);
    expect(yesPriceFor(TradeAction.BuyYes, p).toString()).to.equal(
      p.toString()
    );
    expect(yesPriceFor(TradeAction.SellYes, p).toString()).to.equal(
      p.toString()
    );
    expect(yesPriceFor(TradeAction.BuyNo, p).toString()).to.equal(
      PRICE_SCALE.sub(p).toString()
    );
    expect(yesPriceFor(TradeAction.SellNo, p).toString()).to.equal(
      PRICE_SCALE.sub(p).toString()
    );
  });
});

/**
 * Anti-drift: yesSideFor / yesPriceFor MUST agree with the SDK's buildTradeIntent about the
 * Yes-book side and price each action lands on. A connection-only provider is enough for the
 * Anchor client to *build* (not send) instructions, so this needs no validator.
 */
describe("crossing mapping agrees with the SDK's buildTradeIntent (contract)", () => {
  const program = getProgram({
    connection: new Connection("http://127.0.0.1:8899"),
    publicKey: Keypair.generate().publicKey,
  } as never);
  const user = Keypair.generate().publicKey;
  const usdc = Keypair.generate().publicKey;
  const market = { ticker: Ticker.Meta, strike: 680_000_000, tradingDay: 1 };
  const price = new BN(500_000); // mid price so the No reflection (1 − p) stays in range

  for (const action of [
    TradeAction.BuyYes,
    TradeAction.SellYes,
    TradeAction.BuyNo,
    TradeAction.SellNo,
  ]) {
    it(`${action}: side and Yes price match the SDK`, async () => {
      const built = await buildTradeIntent(program, user, {
        market,
        action,
        price,
        size: new BN(1_000_000),
        usdcMint: usdc,
      });
      expect(yesSideFor(action), "bookSide").to.equal(built.bookSide);
      expect(yesPriceFor(action, price).toString(), "yesPrice").to.equal(
        built.yesPrice.toString()
      );
    });
  }
});
