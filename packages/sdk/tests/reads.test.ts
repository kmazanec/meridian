import { expect } from "chai";
import BN from "bn.js";
import { Keypair, PublicKey } from "@solana/web3.js";
import { Harness, describeOnChain } from "./harness";
import { Ticker, OrderSide, Outcome } from "../src/types";
import { PAYOFF_UNIT, PRICE_SCALE } from "../src/constants";
import { marketPda, orderBookPda, ata } from "../src/pdas";
import * as ix from "../src/instructions";
import {
  dualBook,
  complementPrice,
  payoutFor,
  redeemRecordsFromEvents,
  type OrderBookAccount,
  type OrderEntry,
  type MarketAccount,
  type ParsedEvent,
} from "../src/reads";

/** Decode the order book straight from LiteSVM into the reads-module shape. */
function readBook(h: Harness, market: PublicKey): OrderBookAccount {
  const raw = h.decode<{
    market: PublicKey;
    nextSeq: BN;
    bids: {
      owner: PublicKey;
      price: BN;
      size: BN;
      seq: BN;
      side: Record<string, unknown>;
      active: boolean;
    }[];
    asks: {
      owner: PublicKey;
      price: BN;
      size: BN;
      seq: BN;
      side: Record<string, unknown>;
      active: boolean;
    }[];
    bump: number;
  }>("orderBook", orderBookPda(market));
  const norm = (o: (typeof raw.bids)[number]): OrderEntry => ({
    owner: o.owner,
    price: o.price,
    size: o.size,
    seq: o.seq,
    side: Object.keys(o.side)[0] === "ask" ? OrderSide.Ask : OrderSide.Bid,
    active: o.active,
  });
  return {
    market: raw.market,
    nextSeq: raw.nextSeq,
    bids: raw.bids.map(norm),
    asks: raw.asks.map(norm),
    bump: raw.bump,
  };
}

describe("reads: dual-perspective book + payouts", () => {
  describe("complementPrice", () => {
    it("mirrors a Yes price into the No price (PRICE_SCALE − p)", () => {
      expect(complementPrice(650_000).toString()).to.equal("350000"); // $0.65 → $0.35
      expect(complementPrice(0).eq(PRICE_SCALE)).to.equal(true);
      expect(complementPrice(PRICE_SCALE).isZero()).to.equal(true);
    });
  });

  // dualBook is pure: it takes a decoded OrderBookAccount and computes both perspectives.
  // These hand-build a book (no chain), so the aggregation + No-side mirror run in CI —
  // the on-chain block below exercises the same paths against a real LiteSVM book.
  describe("dualBook (pure aggregation)", () => {
    const order = (
      price: number,
      size: number,
      seq: number,
      side: OrderSide
    ): OrderEntry => ({
      owner: PublicKey.default,
      price: new BN(price),
      size: new BN(size),
      seq: new BN(seq),
      side,
      active: true,
    });
    const book = (
      bids: OrderEntry[],
      asks: OrderEntry[]
    ): OrderBookAccount => ({
      market: PublicKey.default,
      nextSeq: new BN(0),
      bids,
      asks,
      bump: 0,
    });

    it("collapses same-price orders into one level with summed size and count", () => {
      const dual = dualBook(
        book(
          [
            order(400_000, 1_000_000, 0, OrderSide.Bid),
            order(400_000, 2_500_000, 1, OrderSide.Bid),
          ],
          []
        )
      );
      expect(dual.yes.bids).to.have.length(1);
      expect(dual.yes.bids[0].price.toString()).to.equal("400000");
      expect(dual.yes.bids[0].size.toString()).to.equal("3500000"); // 1.0 + 2.5
      expect(dual.yes.bids[0].count).to.equal(2);
    });

    it("sorts levels best-first per side (bids high→low, asks low→high)", () => {
      const dual = dualBook(
        book(
          [
            order(300_000, 1, 0, OrderSide.Bid),
            order(500_000, 1, 1, OrderSide.Bid),
          ],
          [
            order(800_000, 1, 2, OrderSide.Ask),
            order(700_000, 1, 3, OrderSide.Ask),
          ]
        )
      );
      expect(dual.yes.bids.map((l) => l.price.toString())).to.deep.equal([
        "500000",
        "300000",
      ]);
      expect(dual.yes.asks.map((l) => l.price.toString())).to.deep.equal([
        "700000",
        "800000",
      ]);
    });

    it("mirrors the No side: a Yes bid @ p becomes a No ask @ 1−p, size preserved", () => {
      const dual = dualBook(
        book([order(400_000, 1_000_000, 0, OrderSide.Bid)], [])
      );
      // No asks come from Yes bids, mirrored to 1 − price.
      expect(dual.no.asks).to.have.length(1);
      expect(dual.no.asks[0].price.toString()).to.equal("600000"); // 1.00 − 0.40
      expect(dual.no.asks[0].size.toString()).to.equal("1000000"); // size unchanged
    });

    it("drops inactive and zero-size orders from the aggregation", () => {
      const dual = dualBook(
        book(
          [
            { ...order(400_000, 1_000_000, 0, OrderSide.Bid), active: false },
            order(400_000, 0, 1, OrderSide.Bid),
            order(400_000, 500_000, 2, OrderSide.Bid),
          ],
          []
        )
      );
      expect(dual.yes.bids).to.have.length(1);
      expect(dual.yes.bids[0].size.toString()).to.equal("500000");
      expect(dual.yes.bids[0].count).to.equal(1);
    });
  });

  describeOnChain("dualBook on a real book (LiteSVM)", () => {
    let h: Harness;
    let usdc: PublicKey;
    let market: PublicKey;
    const day = new BN(1_716_300_000);
    const id = {
      ticker: Ticker.Meta,
      strike: new BN(680_000_000),
      tradingDay: day,
    };

    before(async () => {
      h = Harness.create();
      usdc = h.ensureUsdc();
      await h.seedConfig(usdc);
      await h.createMarket({ ...id, usdcMint: usdc });
      market = marketPda(id.ticker, id.strike, id.tradingDay);

      // Build a two-sided book that does NOT cross:
      //   maker A: bid 0.4 Yes @ $0.40   (buy Yes)
      //   maker B: ask 0.3 Yes @ $0.70   (sell Yes; needs Yes from a mint)
      const a = h.user();
      const b = h.user();
      const mints = h.decode<{ yesMint: PublicKey; noMint: PublicKey }>(
        "market",
        market
      );
      h.setTokenBalance(usdc, a.publicKey, new BN(10).mul(PAYOFF_UNIT));
      h.setTokenBalance(usdc, b.publicKey, new BN(10).mul(PAYOFF_UNIT));
      // place_order requires user_yes to already exist (even for a bid).
      h.ensureUserAtas(a.publicKey, mints, usdc);
      h.ensureUserAtas(b.publicKey, mints, usdc);
      // A bids (escrows USDC).
      h.send(
        [
          await ix.placeOrder(h.program, {
            user: a.publicKey,
            market: id,
            side: OrderSide.Bid,
            price: new BN(400_000),
            size: new BN(400_000),
            usdcMint: usdc,
          }),
        ],
        [a]
      );
      // B mints a pair to get Yes, then asks.
      h.send(
        [
          await ix.mintPair(h.program, {
            user: b.publicKey,
            usdcMint: usdc,
            market: id,
          }),
        ],
        [b]
      );
      h.send(
        [
          await ix.placeOrder(h.program, {
            user: b.publicKey,
            market: id,
            side: OrderSide.Ask,
            price: new BN(700_000),
            size: new BN(300_000),
            usdcMint: usdc,
          }),
        ],
        [b]
      );
    });

    it("yes view matches the raw book", () => {
      const book = readBook(h, market);
      const dual = dualBook(book);
      expect(dual.yes.bids).to.have.length(1);
      expect(dual.yes.asks).to.have.length(1);
      expect(dual.yes.bids[0].price.toString()).to.equal("400000");
      expect(dual.yes.bids[0].size.toString()).to.equal("400000");
      expect(dual.yes.asks[0].price.toString()).to.equal("700000");
      expect(dual.yes.asks[0].size.toString()).to.equal("300000");
    });

    it("no view is the exact 1.00 − price mirror of the same book", () => {
      const book = readBook(h, market);
      const dual = dualBook(book);
      // A Yes ask @ $0.70 becomes a No bid @ $0.30; a Yes bid @ $0.40 → No ask @ $0.60.
      expect(dual.no.bids).to.have.length(1);
      expect(dual.no.asks).to.have.length(1);
      expect(dual.no.bids[0].price.toString()).to.equal("300000"); // 1.00 − 0.70
      expect(dual.no.bids[0].size.toString()).to.equal("300000");
      expect(dual.no.asks[0].price.toString()).to.equal("600000"); // 1.00 − 0.40
      expect(dual.no.asks[0].size.toString()).to.equal("400000");
    });

    it("preserves the cross-perspective invariant: best Yes bid + best No ask = $1.00", () => {
      const book = readBook(h, market);
      const dual = dualBook(book);
      const sum = dual.yes.bids[0].price.add(dual.no.asks[0].price);
      expect(sum.eq(PRICE_SCALE)).to.equal(true);
    });
  });

  describeOnChain("aggregation across multiple orders at one price", () => {
    let h: Harness;
    let usdc: PublicKey;
    let market: PublicKey;
    const day = new BN(1_716_300_000);
    const id = {
      ticker: Ticker.Googl,
      strike: new BN(150_000_000),
      tradingDay: day,
    };

    before(async () => {
      h = Harness.create();
      usdc = h.ensureUsdc();
      await h.seedConfig(usdc);
      await h.createMarket({ ...id, usdcMint: usdc });
      market = marketPda(id.ticker, id.strike, id.tradingDay);
      const mints = h.decode<{ yesMint: PublicKey; noMint: PublicKey }>(
        "market",
        market
      );
      // Two bidders at the same price → one aggregated level, count 2.
      for (const _ of [0, 1]) {
        const u = h.user();
        h.setTokenBalance(usdc, u.publicKey, new BN(10).mul(PAYOFF_UNIT));
        h.ensureUserAtas(u.publicKey, mints, usdc);
        h.send(
          [
            await ix.placeOrder(h.program, {
              user: u.publicKey,
              market: id,
              side: OrderSide.Bid,
              price: new BN(500_000),
              size: new BN(200_000),
              usdcMint: usdc,
            }),
          ],
          [u]
        );
      }
    });

    it("collapses same-price orders into one level with summed size and count", () => {
      const dual = dualBook(readBook(h, market));
      expect(dual.yes.bids).to.have.length(1);
      expect(dual.yes.bids[0].price.toString()).to.equal("500000");
      expect(dual.yes.bids[0].size.toString()).to.equal("400000"); // 0.2 + 0.2
      expect(dual.yes.bids[0].count).to.equal(2);
    });
  });

  describe("payoutFor (settled-market PNL)", () => {
    const base: MarketAccount = {
      ticker: Ticker.Aapl,
      strike: new BN(200_000_000),
      tradingDay: new BN(1),
      yesMint: PublicKey.default,
      noMint: PublicKey.default,
      vault: PublicKey.default,
      orderBook: PublicKey.default,
      pairsMinted: new BN(0),
      winningRedeemed: new BN(0),
      state: "settled",
      outcome: Outcome.YesWins,
      settlementPrice: new BN(210_000_000),
      settledAt: new BN(2),
      bump: 0,
      vaultBump: 0,
      mintAuthorityBump: 0,
    };

    it("pays $1.00 per winning token and $0 per losing token", () => {
      expect(payoutFor(base, "yes", PAYOFF_UNIT).toString()).to.equal(
        PAYOFF_UNIT.toString()
      );
      expect(payoutFor(base, "no", PAYOFF_UNIT).toString()).to.equal("0");
      const noWins = { ...base, outcome: Outcome.NoWins };
      expect(payoutFor(noWins, "no", PAYOFF_UNIT).toString()).to.equal(
        PAYOFF_UNIT.toString()
      );
      expect(payoutFor(noWins, "yes", PAYOFF_UNIT).toString()).to.equal("0");
    });

    it("throws for an unsettled market", () => {
      const open = {
        ...base,
        state: "open" as const,
        outcome: Outcome.Unsettled,
      };
      expect(() => payoutFor(open, "yes", PAYOFF_UNIT)).to.throw(
        /not settled/i
      );
    });

    it("throws on the inconsistent settled-but-no-price state", () => {
      const corrupt = { ...base, settlementPrice: null };
      expect(() => payoutFor(corrupt, "yes", PAYOFF_UNIT)).to.throw(
        /settlement price/i
      );
    });
  });
});

describe("redeemRecordsFromEvents (claimed-position reconstruction)", () => {
  const me = Keypair.generate().publicKey;
  const other = Keypair.generate().publicKey;
  const mkt = Keypair.generate().publicKey;
  const SIG = "5sig";

  const ev = (
    data: Record<string, unknown>,
    name = "Redeemed"
  ): ParsedEvent => ({
    name,
    data,
  });

  it("keeps only this owner's Redeemed events", () => {
    const events = [
      ev({
        market: mkt,
        user: me,
        won: true,
        tokensBurned: new BN(6_000_000),
        usdcPaid: new BN(6_000_000),
      }),
      ev({
        market: mkt,
        user: other,
        won: true,
        tokensBurned: new BN(9),
        usdcPaid: new BN(9),
      }),
    ];
    const recs = redeemRecordsFromEvents(events, me.toBase58(), SIG);
    expect(recs).to.have.length(1);
    expect(recs[0].market).to.equal(mkt.toBase58());
    expect(recs[0].won).to.equal(true);
    expect(recs[0].usdcPaid.toString()).to.equal("6000000");
    expect(recs[0].signature).to.equal(SIG);
  });

  it("ignores non-Redeemed events", () => {
    const events = [
      ev({ market: mkt, user: me, amount: new BN(1) }, "PairMinted"),
      ev({
        market: mkt,
        user: me,
        won: false,
        tokensBurned: new BN(5),
        usdcPaid: new BN(0),
      }),
    ];
    const recs = redeemRecordsFromEvents(events, me.toBase58(), SIG);
    expect(recs).to.have.length(1);
    expect(recs[0].won).to.equal(false);
    expect(recs[0].usdcPaid.toString()).to.equal("0");
  });

  it("accepts both snake_case and camelCase field variants", () => {
    const snake = ev({
      market: mkt,
      user: me,
      won: true,
      tokens_burned: 3_000_000,
      usdc_paid: 3_000_000,
    });
    const recs = redeemRecordsFromEvents([snake], me.toBase58(), SIG);
    expect(recs[0].tokensBurned.toString()).to.equal("3000000");
    expect(recs[0].usdcPaid.toString()).to.equal("3000000");
  });

  it("returns [] when the owner has no matching events", () => {
    const events = [
      ev({
        market: mkt,
        user: other,
        won: true,
        tokensBurned: new BN(1),
        usdcPaid: new BN(1),
      }),
    ];
    expect(redeemRecordsFromEvents(events, me.toBase58(), SIG)).to.deep.equal(
      []
    );
  });
});
