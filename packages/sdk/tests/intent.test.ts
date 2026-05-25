import { expect } from "chai";
import BN from "bn.js";
import { Keypair, PublicKey, TransactionInstruction } from "@solana/web3.js";
import { Harness, describeOnChain } from "./harness";
import { Ticker, OrderSide } from "../src/types";
import { PAYOFF_UNIT, PRICE_SCALE } from "../src/constants";
import { marketPda, ata } from "../src/pdas";
import * as ix from "../src/instructions";
import {
  buildTradeIntent,
  reflectPrice,
  TradeAction,
  MAX_BUY_NO_MINT_PAIRS,
} from "../src/intent";

/**
 * The instruction coder's `decode` exists at runtime but isn't on the public type in
 * this Anchor version; narrow it here.
 */
type IxDecoder = {
  decode(data: Buffer): { name: string; data: unknown } | null;
};
function ixName(
  h: Harness,
  instruction: TransactionInstruction
): string | undefined {
  const coder = h.program.coder.instruction as unknown as IxDecoder;
  return coder.decode(Buffer.from(instruction.data))?.name;
}

/**
 * Decode a place_order instruction's args, to assert the intent translation maps each
 * action to the correct side/price/size — checking the *actual encoded bytes*.
 */
function decodePlaceOrder(h: Harness, instruction: TransactionInstruction) {
  const coder = h.program.coder.instruction as unknown as IxDecoder;
  const decoded = coder.decode(Buffer.from(instruction.data));
  if (!decoded || decoded.name !== "placeOrder") return null;
  const args = (
    decoded.data as {
      args: { side: Record<string, unknown>; price: BN; size: BN };
    }
  ).args;
  return {
    side: Object.keys(args.side)[0] === "ask" ? OrderSide.Ask : OrderSide.Bid,
    price: args.price,
    size: args.size,
  };
}

function countMintPairs(h: Harness, list: TransactionInstruction[]): number {
  return list.filter((i) => ixName(h, i) === "mintPair").length;
}

function placeOrderIxs(
  h: Harness,
  list: TransactionInstruction[]
): TransactionInstruction[] {
  return list.filter((i) => ixName(h, i) === "placeOrder");
}

// Creates a LiteSVM harness (even the pure-mapping tests build via a real coder),
// so the whole block is gated off in CI via SDK_SKIP_LITESVM (see describeOnChain).
describeOnChain("four-button intent translation", () => {
  const day = new BN(1_716_300_000);
  const id = {
    ticker: Ticker.Meta,
    strike: new BN(680_000_000),
    tradingDay: day,
  };
  const usdc = PublicKey.unique();
  let h: Harness;
  const user = Keypair.generate().publicKey;

  before(() => {
    // No on-chain state needed for the pure mapping assertions; just a program coder.
    h = Harness.create();
  });

  describe("maps each action to the correct on-chain instruction(s)", () => {
    it("BUY_YES → a single bid at the Yes price", async () => {
      const built = await buildTradeIntent(h.program, user, {
        market: id,
        action: TradeAction.BuyYes,
        price: new BN(650_000),
        size: new BN(500_000),
        usdcMint: usdc,
      });
      expect(built.bookSide).to.equal(OrderSide.Bid);
      expect(built.mintPairs).to.equal(0);
      const orders = placeOrderIxs(h, built.instructions);
      expect(orders).to.have.length(1);
      const a = decodePlaceOrder(h, orders[0])!;
      expect(a.side).to.equal(OrderSide.Bid);
      expect(a.price.toString()).to.equal("650000");
      expect(a.size.toString()).to.equal("500000");
    });

    it("SELL_YES → a single ask at the Yes price", async () => {
      const built = await buildTradeIntent(h.program, user, {
        market: id,
        action: TradeAction.SellYes,
        price: new BN(700_000),
        size: new BN(300_000),
        usdcMint: usdc,
      });
      expect(built.bookSide).to.equal(OrderSide.Ask);
      const a = decodePlaceOrder(h, placeOrderIxs(h, built.instructions)[0])!;
      expect(a.side).to.equal(OrderSide.Ask);
      expect(a.price.toString()).to.equal("700000");
      expect(a.size.toString()).to.equal("300000");
    });

    it("BUY_NO → mint_pair(s) + sell Yes at 1 − noPrice", async () => {
      // No price $0.30 → sell Yes at $0.70. Size = 2 whole tokens → 2 mint_pairs.
      const noPrice = new BN(300_000);
      const built = await buildTradeIntent(h.program, user, {
        market: id,
        action: TradeAction.BuyNo,
        price: noPrice,
        size: PAYOFF_UNIT.muln(2),
        usdcMint: usdc,
      });
      expect(built.bookSide).to.equal(OrderSide.Ask);
      expect(built.mintPairs).to.equal(2);
      expect(countMintPairs(h, built.instructions)).to.equal(2);
      const a = decodePlaceOrder(h, placeOrderIxs(h, built.instructions)[0])!;
      expect(a.side).to.equal(OrderSide.Ask);
      // Yes price = 1.00 − 0.30 = 0.70.
      expect(a.price.toString()).to.equal(reflectPrice(noPrice).toString());
      expect(a.price.toString()).to.equal("700000");
      expect(a.size.toString()).to.equal(PAYOFF_UNIT.muln(2).toString());
    });

    it("BUY_NO rejects a fractional (non-whole-token) size", async () => {
      let threw = false;
      try {
        await buildTradeIntent(h.program, user, {
          market: id,
          action: TradeAction.BuyNo,
          price: new BN(300_000),
          size: new BN(500_000),
          usdcMint: usdc,
        });
      } catch (e) {
        threw = true;
        expect((e as Error).message).to.match(/whole multiple of PAYOFF_UNIT/);
      }
      expect(threw).to.equal(true);
    });

    it("SELL_NO → buy Yes at 1 − noPrice", async () => {
      const noPrice = new BN(400_000);
      const built = await buildTradeIntent(h.program, user, {
        market: id,
        action: TradeAction.SellNo,
        price: noPrice,
        size: new BN(250_000),
        usdcMint: usdc,
      });
      expect(built.bookSide).to.equal(OrderSide.Bid);
      expect(built.mintPairs).to.equal(0);
      const a = decodePlaceOrder(h, placeOrderIxs(h, built.instructions)[0])!;
      expect(a.side).to.equal(OrderSide.Bid);
      expect(a.price.toString()).to.equal("600000"); // 1.00 − 0.40
      expect(a.size.toString()).to.equal("250000");
    });

    it("BUY_NO rejects a size exceeding the per-transaction mint cap", async () => {
      let threw = false;
      try {
        await buildTradeIntent(h.program, user, {
          market: id,
          action: TradeAction.BuyNo,
          price: new BN(300_000),
          size: PAYOFF_UNIT.muln(MAX_BUY_NO_MINT_PAIRS + 1),
          usdcMint: usdc,
        });
      } catch (e) {
        threw = true;
        expect((e as Error).message).to.match(/per-transaction mint cap/);
      }
      expect(threw).to.equal(true);
    });
  });

  describe("end-to-end BUY_NO / SELL_NO (LiteSVM)", () => {
    let hh: Harness;
    let usdcMint: PublicKey;
    let market: PublicKey;
    let mints: { yesMint: PublicKey; noMint: PublicKey };
    let liquidityMaker: Keypair;
    let trader: Keypair;

    before(async () => {
      hh = Harness.create();
      usdcMint = hh.ensureUsdc();
      await hh.seedConfig(usdcMint);
      await hh.createMarket({ ...id, usdcMint });
      market = marketPda(id.ticker, id.strike, id.tradingDay);
      mints = hh.decode<{ yesMint: PublicKey; noMint: PublicKey }>(
        "market",
        market
      );

      // Maker provides Yes liquidity (a resting bid to buy Yes) so a BUY_NO's
      // sell-Yes leg can fill, and resting ask liquidity so SELL_NO's buy-Yes can fill.
      liquidityMaker = hh.user();
      trader = hh.user();
      hh.setTokenBalance(
        usdcMint,
        liquidityMaker.publicKey,
        new BN(100).mul(PAYOFF_UNIT)
      );
      hh.setTokenBalance(
        usdcMint,
        trader.publicKey,
        new BN(100).mul(PAYOFF_UNIT)
      );
      hh.ensureUserAtas(liquidityMaker.publicKey, mints, usdcMint);
      hh.ensureUserAtas(trader.publicKey, mints, usdcMint);
    });

    it("BUY_NO leaves the trader holding No, having sold the minted Yes", async () => {
      // Maker rests a bid to BUY Yes @ $0.70 (so the trader's BUY_NO sell-Yes @ $0.70 fills).
      hh.send(
        [
          await ix.placeOrder(hh.program, {
            user: liquidityMaker.publicKey,
            market: id,
            side: OrderSide.Bid,
            price: new BN(700_000),
            size: PAYOFF_UNIT,
            usdcMint,
          }),
        ],
        [liquidityMaker]
      );

      // Trader BUY_NO at No price $0.30, size 1.0 token → mint 1 pair, sell Yes @ $0.70.
      const built = await buildTradeIntent(hh.program, trader.publicKey, {
        market: id,
        action: TradeAction.BuyNo,
        price: new BN(300_000),
        size: PAYOFF_UNIT,
        usdcMint,
      });
      // The intent maps BUY_NO to: ensure-ATAs + mint_pair + sell-Yes ask @ $0.70.
      // The sell-Yes leg crosses the maker's resting bid; the crossing counterparty's
      // payout account is supplied at send time (intent keeps builders book-agnostic).
      // Take the intent's non-order setup ixs verbatim, then attach maker accounts to the
      // sell-Yes leg (taker Ask → maker, the buyer, receives Yes).
      const setupIxs = built.instructions.filter(
        (i) => ixName(hh, i) !== "placeOrder"
      );
      const sellYes = await ix.placeOrder(hh.program, {
        user: trader.publicKey,
        market: id,
        side: OrderSide.Ask,
        price: built.yesPrice,
        size: PAYOFF_UNIT,
        usdcMint,
        makerAccounts: [ata(mints.yesMint, liquidityMaker.publicKey)],
      });
      hh.send([...setupIxs, sellYes], [trader]);

      // Trader holds 1.0 No, 0 Yes (minted 1 Yes+No, sold the Yes).
      expect(
        hh.tokenBalance(ata(mints.noMint, trader.publicKey)).toString()
      ).to.equal(PAYOFF_UNIT.toString());
      expect(
        hh.tokenBalance(ata(mints.yesMint, trader.publicKey)).toString()
      ).to.equal("0");
    });

    it("SELL_NO buys Yes so the trader nets a redeemable Yes+No pair", async () => {
      // Maker rests an ask to SELL Yes @ $0.60 (trader's SELL_NO buys Yes @ $0.60).
      // Maker needs Yes: mint a pair first.
      hh.send(
        [
          await ix.mintPair(hh.program, {
            user: liquidityMaker.publicKey,
            usdcMint,
            market: id,
          }),
        ],
        [liquidityMaker]
      );
      hh.send(
        [
          await ix.placeOrder(hh.program, {
            user: liquidityMaker.publicKey,
            market: id,
            side: OrderSide.Ask,
            price: new BN(600_000),
            size: PAYOFF_UNIT,
            usdcMint,
          }),
        ],
        [liquidityMaker]
      );

      const yesBefore = hh.tokenBalance(ata(mints.yesMint, trader.publicKey));
      // SELL_NO at No price $0.40 → buy Yes @ $0.60. Supply maker's USDC as counterparty.
      const buyYes = await ix.placeOrder(hh.program, {
        user: trader.publicKey,
        market: id,
        side: OrderSide.Bid,
        price: new BN(600_000),
        size: PAYOFF_UNIT,
        usdcMint,
        makerAccounts: [ata(usdcMint, liquidityMaker.publicKey)],
      });
      hh.send([buyYes], [trader]);

      const yesAfter = hh.tokenBalance(ata(mints.yesMint, trader.publicKey));
      expect((yesAfter - yesBefore).toString()).to.equal(
        PAYOFF_UNIT.toString()
      );
    });
  });
});

// reflectPrice is pure (no chain), so it runs in CI unconditionally — outside the
// LiteSVM-gated block above. It is the No↔Yes price mirror the four-button intent relies on.
describe("reflectPrice", () => {
  it("is its own inverse (No↔Yes)", () => {
    const p = new BN(370_000);
    expect(reflectPrice(reflectPrice(p)).toString()).to.equal(p.toString());
    expect(reflectPrice(p).add(p).eq(PRICE_SCALE)).to.equal(true);
  });

  it("rejects prices outside [0, PRICE_SCALE] (no negative order price)", () => {
    expect(() => reflectPrice(PRICE_SCALE.addn(1))).to.throw(/out of range/);
    expect(() => reflectPrice(new BN(-1))).to.throw(/out of range/);
    // Boundaries are allowed: 0 → PRICE_SCALE, PRICE_SCALE → 0.
    expect(reflectPrice(0).eq(PRICE_SCALE)).to.equal(true);
    expect(reflectPrice(PRICE_SCALE).isZero()).to.equal(true);
  });
});
