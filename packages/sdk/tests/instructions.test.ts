import { expect } from "chai";
import BN from "bn.js";
import { Keypair, PublicKey } from "@solana/web3.js";
import { Harness, TxError } from "./harness";
import { Ticker, OrderSide, RedeemSide } from "../src/types";
import { PAYOFF_UNIT } from "../src/constants";
import {
  marketPda,
  vaultPda,
  orderBookPda,
  usdcEscrowPda,
  ata,
} from "../src/pdas";
import * as ix from "../src/instructions";

/**
 * Each builder is proven by sending its transaction against the real program in
 * LiteSVM and asserting the on-chain state effect. This is the acceptance criterion
 * "every instruction has a typed builder that produces a valid transaction against
 * the deployed program" — and it locks the SDK surface F-07/F-08 import.
 */
describe("instruction builders (against the real program)", () => {
  const day = new BN(1_716_300_000);

  describe("provisioning: create / add_strike / book", () => {
    let h: Harness;
    let usdc: PublicKey;
    before(async () => {
      h = Harness.create();
      usdc = h.ensureUsdc();
      await h.seedConfig(usdc);
    });

    it("create_strike_market provisions an Open market with mints + vault", async () => {
      const id = {
        ticker: Ticker.Aapl,
        strike: new BN(200_000_000),
        tradingDay: day,
      };
      const i = await ix.createStrikeMarket(h.program, {
        admin: h.admin.publicKey,
        usdcMint: usdc,
        market: id,
      });
      h.send([i], [h.admin]);

      const m = marketPda(id.ticker, id.strike, id.tradingDay);
      const market = h.decode<{ state: object; pairsMinted: BN; strike: BN }>(
        "market",
        m
      );
      expect(Object.keys(market.state)[0]).to.equal("open");
      expect(market.pairsMinted.toString()).to.equal("0");
      expect(market.strike.toString()).to.equal("200000000");
    });

    it("rejects a duplicate create (surfaces the program error)", async () => {
      const id = {
        ticker: Ticker.Aapl,
        strike: new BN(200_000_000),
        tradingDay: day,
      };
      const i = await ix.createStrikeMarket(h.program, {
        admin: h.admin.publicKey,
        usdcMint: usdc,
        market: id,
      });
      const res = h.trySend([i], [h.admin]);
      // Anchor's `init` on an existing PDA fails (account already in use).
      expect(res.constructor.name).to.equal("FailedTransactionMetadata");
    });

    it("rejects create by a non-admin signer", async () => {
      const mallory = h.user();
      const id = {
        ticker: Ticker.Msft,
        strike: new BN(400_000_000),
        tradingDay: day,
      };
      const i = await ix.createStrikeMarket(h.program, {
        admin: mallory.publicKey,
        usdcMint: usdc,
        market: id,
      });
      let threw = false;
      try {
        h.send([i], [mallory]);
      } catch (e) {
        threw = true;
        expect((e as TxError).logs().join("\n")).to.match(
          /Unauthorized|has_one|admin/i
        );
      }
      expect(threw, "non-admin create must fail").to.equal(true);
    });

    it("add_strike provisions another strike for the same ticker/day", async () => {
      const id = {
        ticker: Ticker.Aapl,
        strike: new BN(210_000_000),
        tradingDay: day,
      };
      const i = await ix.addStrike(h.program, {
        admin: h.admin.publicKey,
        usdcMint: usdc,
        market: id,
      });
      h.send([i], [h.admin]);
      expect(h.exists(marketPda(id.ticker, id.strike, id.tradingDay))).to.equal(
        true
      );
    });

    it("init_order_book + grow_order_book wire a tradeable book", async () => {
      const id = {
        ticker: Ticker.Aapl,
        strike: new BN(200_000_000),
        tradingDay: day,
      };
      const m = marketPda(id.ticker, id.strike, id.tradingDay);
      const initIx = await ix.initOrderBook(h.program, {
        payer: h.admin.publicKey,
        usdcMint: usdc,
        market: id,
      });
      h.send([initIx], [h.admin]);
      const growIx = await ix.growOrderBook(h.program, {
        payer: h.admin.publicKey,
        market: id,
      });
      h.send([growIx], [h.admin]);

      const market = h.decode<{ orderBook: PublicKey }>("market", m);
      expect(orderBookPda(m).equals(market.orderBook)).to.equal(true);
      const book = h.decode<{ bids: unknown[]; asks: unknown[] }>(
        "orderBook",
        orderBookPda(m)
      );
      expect(book.bids).to.have.length(0);
      expect(book.asks).to.have.length(0);
    });
  });

  describe("mint / redeem lifecycle", () => {
    let h: Harness;
    let usdc: PublicKey;
    const id = {
      ticker: Ticker.Tsla,
      strike: new BN(250_000_000),
      tradingDay: day,
    };
    let user: Keypair;

    before(async () => {
      h = Harness.create();
      usdc = h.ensureUsdc();
      await h.seedConfig(usdc);
      await h.createMarket({ ...id, usdcMint: usdc });
      user = h.user();
      h.setTokenBalance(usdc, user.publicKey, new BN(10).mul(PAYOFF_UNIT)); // $10
    });

    it("mint_pair deposits $1.00 and issues 1 Yes + 1 No", async () => {
      const i = await ix.mintPair(h.program, {
        user: user.publicKey,
        usdcMint: usdc,
        market: id,
      });
      h.send([i], [user]);

      const m = marketPda(id.ticker, id.strike, id.tradingDay);
      const yesBal = h.tokenBalance(
        ata(
          h.decode<{ yesMint: PublicKey }>("market", m).yesMint,
          user.publicKey
        )
      );
      const noBal = h.tokenBalance(
        ata(h.decode<{ noMint: PublicKey }>("market", m).noMint, user.publicKey)
      );
      expect(yesBal.toString()).to.equal(PAYOFF_UNIT.toString());
      expect(noBal.toString()).to.equal(PAYOFF_UNIT.toString());

      // Vault holds exactly $1.00 (collateralization invariant).
      expect(h.tokenBalance(vaultPda(m)).toString()).to.equal(
        PAYOFF_UNIT.toString()
      );
      expect(
        h.decode<{ pairsMinted: BN }>("market", m).pairsMinted.toString()
      ).to.equal("1");
    });

    it("admin_settle writes the outcome and redeem pays the winner", async () => {
      const m = marketPda(id.ticker, id.strike, id.tradingDay);
      // Move clock past close + the admin override delay (trading_day + 1h).
      h.setUnixTimestamp(day.toNumber() + 3600 + 1);

      // Settle ABOVE strike → Yes wins.
      const settleIx = await ix.adminSettle(h.program, {
        admin: h.admin.publicKey,
        market: id,
        settlementPrice: new BN(260_000_000),
      });
      h.send([settleIx], [h.admin]);
      const settled = h.decode<{ outcome: object; state: object }>("market", m);
      expect(Object.keys(settled.outcome)[0]).to.equal("yesWins");
      expect(Object.keys(settled.state)[0]).to.equal("settled");

      // Redeem the winning Yes for $1.00.
      const before = h.tokenBalance(ata(usdc, user.publicKey));
      const redeemIx = await ix.redeem(h.program, {
        user: user.publicKey,
        market: id,
        side: RedeemSide.Yes,
        amount: PAYOFF_UNIT,
        usdcMint: usdc,
      });
      h.send([redeemIx], [user]);
      const after = h.tokenBalance(ata(usdc, user.publicKey));
      expect((after - before).toString()).to.equal(PAYOFF_UNIT.toString());
    });
  });

  describe("trading: place / cancel / match", () => {
    let h: Harness;
    let usdc: PublicKey;
    const id = {
      ticker: Ticker.Nvda,
      strike: new BN(120_000_000),
      tradingDay: day,
    };
    let maker: Keypair;
    let taker: Keypair;

    before(async () => {
      h = Harness.create();
      usdc = h.ensureUsdc();
      await h.seedConfig(usdc);
      await h.createMarket({ ...id, usdcMint: usdc });

      // Maker mints a pair so they hold Yes to sell; taker holds USDC to buy.
      maker = h.user();
      taker = h.user();
      h.setTokenBalance(usdc, maker.publicKey, new BN(10).mul(PAYOFF_UNIT));
      h.setTokenBalance(usdc, taker.publicKey, new BN(10).mul(PAYOFF_UNIT));
      const mintIx = await ix.mintPair(h.program, {
        user: maker.publicKey,
        usdcMint: usdc,
        market: id,
      });
      h.send([mintIx], [maker]);
    });

    it("place_order rests a limit ask, and cancel_order returns the escrow", async () => {
      const m = marketPda(id.ticker, id.strike, id.tradingDay);
      // Maker posts an ask: sell 0.5 Yes @ $0.60.
      const askIx = await ix.placeOrder(h.program, {
        user: maker.publicKey,
        market: id,
        side: OrderSide.Ask,
        price: new BN(600_000),
        size: new BN(500_000),
        usdcMint: usdc,
      });
      h.send([askIx], [maker]);

      const book = h.decode<{ asks: { seq: BN; size: BN; price: BN }[] }>(
        "orderBook",
        orderBookPda(m)
      );
      expect(book.asks).to.have.length(1);
      const seq = book.asks[0].seq;
      expect(book.asks[0].price.toString()).to.equal("600000");

      // Cancel it → the Yes escrow is returned to the maker.
      const cancelIx = await ix.cancelOrder(h.program, {
        user: maker.publicKey,
        market: id,
        side: OrderSide.Ask,
        seq,
        usdcMint: usdc,
      });
      h.send([cancelIx], [maker]);
      const afterCancel = h.decode<{ asks: unknown[] }>(
        "orderBook",
        orderBookPda(m)
      );
      expect(afterCancel.asks).to.have.length(0);
    });

    it("a crossing taker buy fills against the resting ask (place_order auto-matches)", async () => {
      const m = marketPda(id.ticker, id.strike, id.tradingDay);
      // Re-post a maker ask: sell 0.5 Yes @ $0.60.
      const askIx = await ix.placeOrder(h.program, {
        user: maker.publicKey,
        market: id,
        side: OrderSide.Ask,
        price: new BN(600_000),
        size: new BN(500_000),
        usdcMint: usdc,
      });
      h.send([askIx], [maker]);

      // Taker buys 0.5 Yes @ $0.60 (a marketable limit) → crosses the maker's ask.
      // place_order requires the taker's Yes account to already exist, so prepend an
      // idempotent ATA-create (the SDK helper consumers use for this exact reason).
      // The maker's USDC account is the counterparty payout account (remaining_accounts).
      const yesMintKey = h.decode<{ yesMint: PublicKey }>("market", m).yesMint;
      const createTakerYes = ix.createAtaIfNeeded(
        taker.publicKey,
        taker.publicKey,
        yesMintKey
      );
      const takerBuy = await ix.placeOrder(h.program, {
        user: taker.publicKey,
        market: id,
        side: OrderSide.Bid,
        price: new BN(600_000),
        size: new BN(500_000),
        usdcMint: usdc,
        makerAccounts: [ata(usdc, maker.publicKey)],
      });
      h.send([createTakerYes, takerBuy], [taker]);

      // Taker now holds 0.5 Yes; the book is empty (full fill).
      const yesMint = h.decode<{ yesMint: PublicKey }>("market", m).yesMint;
      expect(h.tokenBalance(ata(yesMint, taker.publicKey)).toString()).to.equal(
        "500000"
      );
      const book = h.decode<{ asks: unknown[]; bids: unknown[] }>(
        "orderBook",
        orderBookPda(m)
      );
      expect(book.asks).to.have.length(0);
      expect(book.bids).to.have.length(0);
    });

    it("match_orders crank builder produces a tx the program accepts (no-op when nothing crosses)", async () => {
      // Because place_order crosses on placement, a sorted book never holds a crossing
      // bid/ask pair at rest; the crank's job is a permissionless safety re-check. With
      // no crossable pair it is a valid no-op — proving the builder wires the accounts
      // correctly (cranker/config/book/escrows/mints) is what this asserts.
      const crank = await ix.matchOrders(h.program, {
        cranker: taker.publicKey,
        market: id,
        maxFills: 4,
      });
      const res = h.trySend([crank], [taker]);
      expect(res.constructor.name).to.not.equal("FailedTransactionMetadata");
    });
  });

  describe("admin: pause / unpause", () => {
    let h: Harness;
    let usdc: PublicKey;
    before(async () => {
      h = Harness.create();
      usdc = h.ensureUsdc();
      await h.seedConfig(usdc);
    });

    it("pause sets the flag and unpause clears it", async () => {
      const pauseIx = await ix.pause(h.program, { admin: h.admin.publicKey });
      h.send([pauseIx], [h.admin]);
      const cfg = () =>
        h.decode<{ paused: boolean }>(
          "config",
          new PublicKey(
            PublicKey.findProgramAddressSync(
              [Buffer.from("config")],
              h.program.programId
            )[0]
          )
        );
      expect(cfg().paused).to.equal(true);

      const unpauseIx = await ix.unpause(h.program, {
        admin: h.admin.publicKey,
      });
      h.send([unpauseIx], [h.admin]);
      expect(cfg().paused).to.equal(false);
    });

    it("rejects pause by a non-admin", async () => {
      const mallory = h.user();
      const pauseIx = await ix.pause(h.program, { admin: mallory.publicKey });
      const res = h.trySend([pauseIx], [mallory]);
      expect(res.constructor.name).to.equal("FailedTransactionMetadata");
    });
  });

  describe("placeOrder client-side validation (fail fast, no wasted round-trip)", () => {
    const h = Harness.create();
    const user = Keypair.generate().publicKey;
    const usdc = PublicKey.unique();
    const id = {
      ticker: Ticker.Aapl,
      strike: new BN(200_000_000),
      tradingDay: day,
    };
    const base = { user, market: id, usdcMint: usdc, size: new BN(1_000) };

    it("rejects a zero size", async () => {
      let threw = false;
      try {
        await ix.placeOrder(h.program, {
          ...base,
          side: OrderSide.Bid,
          price: new BN(500_000),
          size: new BN(0),
        });
      } catch (e) {
        threw = true;
        expect((e as Error).message).to.match(
          /size must be greater than zero/i
        );
      }
      expect(threw).to.equal(true);
    });

    it("rejects a limit price of 0 or above PRICE_SCALE", async () => {
      let zero = false;
      try {
        await ix.placeOrder(h.program, {
          ...base,
          side: OrderSide.Bid,
          price: new BN(0),
        });
      } catch {
        zero = true;
      }
      expect(zero, "price 0 rejected").to.equal(true);

      let over = false;
      try {
        await ix.placeOrder(h.program, {
          ...base,
          side: OrderSide.Ask,
          price: PAYOFF_UNIT.addn(1),
        });
      } catch {
        over = true;
      }
      expect(over, "price > PRICE_SCALE rejected").to.equal(true);
    });

    it("allows price 0 for a market order (price is ignored)", async () => {
      // Should build without throwing — market orders cross at any price.
      const i = await ix.placeOrder(h.program, {
        ...base,
        side: OrderSide.Bid,
        price: new BN(0),
        isMarket: true,
      });
      expect(i.programId.toBase58()).to.equal(h.program.programId.toBase58());
    });
  });
});
