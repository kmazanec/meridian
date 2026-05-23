import { describe, it, expect } from "vitest";
import BN from "bn.js";
import { PublicKey } from "@solana/web3.js";
import {
  dualBook,
  Outcome,
  OrderSide,
  Ticker,
  PRICE_SCALE,
  type OrderBookAccount,
  type OrderEntry,
} from "@meridian/sdk";
import type { DiscoveredMarket } from "./discovery";
import {
  bookStats,
  strikeRow,
  strikeLadderRows,
  tickerAggregate,
  representativeYesPrice,
  type BookMap,
} from "./marketStats";

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

function book(
  bids: OrderEntry[],
  asks: OrderEntry[],
  market = PublicKey.unique()
): OrderBookAccount {
  return { market, nextSeq: new BN(1), bids, asks, bump: 0 };
}

function market(opts: {
  ticker?: Ticker;
  strike: number;
  state?: "open" | "settled";
  outcome?: Outcome;
  orderBook: PublicKey;
  pairsMinted?: number;
  settlementPrice?: number | null;
}): DiscoveredMarket {
  return {
    address: PublicKey.unique(),
    ticker: opts.ticker ?? Ticker.Meta,
    strike: new BN(opts.strike),
    tradingDay: new BN(1),
    state: opts.state ?? "open",
    outcome: opts.outcome ?? Outcome.Unsettled,
    orderBook: opts.orderBook,
    pairsMinted: new BN(opts.pairsMinted ?? 0),
    settlementPrice:
      opts.settlementPrice == null ? null : new BN(opts.settlementPrice),
  };
}

describe("bookStats", () => {
  it("computes best bid/ask, spread, and total resting size", () => {
    const view = dualBook(
      book(
        [order(OrderSide.Bid, 600_000, 1_000_000, 1)],
        [order(OrderSide.Ask, 700_000, 2_000_000, 2)]
      )
    ).yes;
    const s = bookStats(view);
    expect(s.bestBid?.toNumber()).toBe(600_000);
    expect(s.bestAsk?.toNumber()).toBe(700_000);
    expect(s.spread?.toNumber()).toBe(100_000);
    expect(s.restingSize.toNumber()).toBe(3_000_000);
  });

  it("returns null spread when a side is empty", () => {
    const view = dualBook(
      book([order(OrderSide.Bid, 500_000, 1_000_000, 1)], [])
    ).yes;
    const s = bookStats(view);
    expect(s.spread).toBeNull();
    expect(s.bestAsk).toBeNull();
    expect(s.restingSize.toNumber()).toBe(1_000_000);
  });
});

describe("strikeRow", () => {
  it("joins a market to its book and derives Yes/No price + depth", () => {
    const ob = PublicKey.unique();
    const books: BookMap = new Map([
      [
        ob.toBase58(),
        book(
          [order(OrderSide.Bid, 600_000, 1_000_000, 1)],
          [order(OrderSide.Ask, 700_000, 1_000_000, 2)]
        ),
      ],
    ]);
    const row = strikeRow(market({ strike: 680_000_000, orderBook: ob }), books);
    expect(row.yesPrice.toNumber()).toBe(650_000); // mid of 0.60/0.70
    expect(row.noPrice.toNumber()).toBe(PRICE_SCALE.toNumber() - 650_000);
    expect(row.spread?.toNumber()).toBe(100_000);
    expect(row.depth.bids.length).toBe(1);
  });

  it("falls back to 50/50 when no book was fetched", () => {
    const row = strikeRow(
      market({ strike: 680_000_000, orderBook: PublicKey.unique() }),
      new Map()
    );
    expect(row.yesPrice.toNumber()).toBe(PRICE_SCALE.toNumber() / 2);
    expect(row.restingSize.toNumber()).toBe(0);
  });
});

describe("strikeLadderRows", () => {
  it("sorts by strike ascending, open before settled at the same strike", () => {
    const obs = [PublicKey.unique(), PublicKey.unique(), PublicKey.unique()];
    const markets = [
      market({ strike: 700_000_000, orderBook: obs[0] }),
      market({ strike: 660_000_000, orderBook: obs[1] }),
      market({
        strike: 660_000_000,
        state: "settled",
        outcome: Outcome.NoWins,
        orderBook: obs[2],
      }),
    ];
    const rows = strikeLadderRows(markets, new Map());
    expect(rows.map((r) => r.strike.toNumber())).toEqual([
      660_000_000, 660_000_000, 700_000_000,
    ]);
    expect(rows[0].state).toBe("open");
    expect(rows[1].state).toBe("settled");
  });
});

describe("tickerAggregate", () => {
  it("sums open count, resting size, pairs minted, and collateral", () => {
    const ob1 = PublicKey.unique();
    const ob2 = PublicKey.unique();
    const books: BookMap = new Map([
      [ob1.toBase58(), book([order(OrderSide.Bid, 500_000, 2_000_000, 1)], [])],
      [ob2.toBase58(), book([], [order(OrderSide.Ask, 500_000, 3_000_000, 1)])],
    ]);
    const markets = [
      market({ strike: 100, orderBook: ob1, pairsMinted: 4_000_000 }),
      market({
        strike: 200,
        state: "settled",
        orderBook: ob2,
        pairsMinted: 1_000_000,
      }),
    ];
    const agg = tickerAggregate(markets, books);
    expect(agg.openCount).toBe(1);
    expect(agg.totalRestingSize.toNumber()).toBe(5_000_000);
    expect(agg.totalPairsMinted.toNumber()).toBe(5_000_000);
    // Collateral in USDC base units equals pairs minted (shared 6dp scale).
    expect(agg.totalCollateral.toNumber()).toBe(5_000_000);
  });
});

describe("representativeYesPrice", () => {
  it("picks the median-strike open market's price", () => {
    const obs = [PublicKey.unique(), PublicKey.unique(), PublicKey.unique()];
    const books: BookMap = new Map([
      // Median strike (200) book: mid 0.55.
      [
        obs[1].toBase58(),
        book(
          [order(OrderSide.Bid, 500_000, 1_000_000, 1)],
          [order(OrderSide.Ask, 600_000, 1_000_000, 2)]
        ),
      ],
    ]);
    const markets = [
      market({ strike: 100, orderBook: obs[0] }),
      market({ strike: 200, orderBook: obs[1] }),
      market({ strike: 300, orderBook: obs[2] }),
    ];
    expect(representativeYesPrice(markets, books)?.toNumber()).toBe(550_000);
  });

  it("returns null when no open markets exist", () => {
    expect(
      representativeYesPrice(
        [
          market({
            strike: 100,
            state: "settled",
            orderBook: PublicKey.unique(),
          }),
        ],
        new Map()
      )
    ).toBeNull();
  });
});
