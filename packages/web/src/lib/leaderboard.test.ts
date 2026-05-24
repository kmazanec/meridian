import { describe, it, expect } from "vitest";
import BN from "bn.js";
import { PublicKey } from "@solana/web3.js";
import { Outcome, OrderSide, type OrderBookAccount } from "@meridian/sdk";
import { Ticker } from "@meridian/sdk";
import {
  foldLeaderboard,
  foldMarketDrilldown,
  valueOfHolding,
  type LeaderboardInputs,
  type MarketHolding,
} from "./leaderboard";
import type { DiscoveredMarket } from "./discovery";
import type { BookMap } from "./marketStats";

// Deterministic fake pubkeys.
const pk = (n: number) => new PublicKey(new Uint8Array(32).fill(n));
const OWNER_A = pk(1).toBase58();
const OWNER_B = pk(2).toBase58();

const MKT_SETTLED = pk(10);
const OB_SETTLED = pk(11);
const MKT_OPEN = pk(20);
const OB_OPEN = pk(21);

function market(overrides: Partial<DiscoveredMarket>): DiscoveredMarket {
  return {
    address: MKT_SETTLED,
    ticker: Ticker.Meta,
    strike: new BN(680_000_000),
    tradingDay: new BN(1_700_000_000),
    state: "settled",
    outcome: Outcome.YesWins,
    orderBook: OB_SETTLED,
    pairsMinted: new BN(0),
    settlementPrice: new BN(700_000_000),
    ...overrides,
  };
}

function emptyBook(market: PublicKey): OrderBookAccount {
  return {
    market,
    nextSeq: new BN(0),
    bids: [],
    asks: [],
    bump: 0,
  };
}

function order(
  owner: PublicKey,
  side: OrderSide,
  price: number,
  size: number
): OrderBookAccount["bids"][number] {
  return {
    owner,
    price: new BN(price),
    size: new BN(size),
    seq: new BN(0),
    side,
    active: true,
  };
}

function baseInputs(over: Partial<LeaderboardInputs> = {}): LeaderboardInputs {
  return {
    markets: [],
    books: new Map() as BookMap,
    ownerUsdc: new Map(),
    holdingsByOwner: new Map(),
    yesMarkByMarket: new Map(),
    ...over,
  };
}

describe("valueOfHolding", () => {
  it("settled: winning side pays 1:1, loser pays 0", () => {
    const yesWins = market({ state: "settled", outcome: Outcome.YesWins });
    expect(
      valueOfHolding(yesWins, "yes", new BN(3_000_000), null)!.toNumber()
    ).toBe(3_000_000);
    expect(
      valueOfHolding(yesWins, "no", new BN(3_000_000), null)!.toNumber()
    ).toBe(0);
  });

  it("open: marks to market at the side's mark", () => {
    const open = market({
      address: MKT_OPEN,
      orderBook: OB_OPEN,
      state: "open",
      outcome: Outcome.Unsettled,
      settlementPrice: null,
    });
    // yes mark 0.60 → 2 yes tokens worth $1.20; no worth complement 0.40 → $0.80
    expect(
      valueOfHolding(
        open,
        "yes",
        new BN(2_000_000),
        new BN(600_000)
      )!.toNumber()
    ).toBe(1_200_000);
    expect(
      valueOfHolding(open, "no", new BN(2_000_000), new BN(600_000))!.toNumber()
    ).toBe(800_000);
  });

  it("open with no mark → unpriceable (null)", () => {
    const open = market({
      address: MKT_OPEN,
      state: "open",
      outcome: Outcome.Unsettled,
      settlementPrice: null,
    });
    expect(valueOfHolding(open, "yes", new BN(1_000_000), null)).toBeNull();
  });

  it("zero amount → zero (not null), even when unmarked", () => {
    const open = market({ state: "open", outcome: Outcome.Unsettled });
    expect(valueOfHolding(open, "yes", new BN(0), null)!.toNumber()).toBe(0);
  });
});

describe("foldLeaderboard", () => {
  it("net = usdc + token value + escrow; ranks desc", () => {
    const settled = market({}); // YesWins
    const holdings = new Map<string, MarketHolding[]>([
      // A holds 5 winning YES = $5
      [
        OWNER_A,
        [
          {
            market: MKT_SETTLED.toBase58(),
            side: "yes",
            amount: new BN(5_000_000),
          },
        ],
      ],
      // B holds 5 losing NO = $0
      [
        OWNER_B,
        [
          {
            market: MKT_SETTLED.toBase58(),
            side: "no",
            amount: new BN(5_000_000),
          },
        ],
      ],
    ]);
    const rows = foldLeaderboard(
      baseInputs({
        markets: [settled],
        ownerUsdc: new Map([
          [OWNER_A, new BN(10_000_000)], // $10
          [OWNER_B, new BN(10_000_000)], // $10
        ]),
        holdingsByOwner: holdings,
      })
    );
    expect(rows.map((r) => r.owner)).toEqual([OWNER_A, OWNER_B]); // A ahead
    expect(rows[0].net.toNumber()).toBe(15_000_000); // $10 + $5
    expect(rows[1].net.toNumber()).toBe(10_000_000); // $10 + $0
  });

  it("credits escrowed order collateral back to the owner", () => {
    const settled = market({}); // YesWins
    const book = emptyBook(OB_SETTLED);
    // A bid: price 0.50, size 4 tokens → escrow ceil(0.5*4)=$2.00
    book.bids.push(order(pk(1), OrderSide.Bid, 500_000, 4_000_000));
    // A ask: 3 YES tokens on a YesWins market → worth $3
    book.asks.push(order(pk(1), OrderSide.Ask, 600_000, 3_000_000));
    const books = new Map([[OB_SETTLED.toBase58(), book]]) as BookMap;
    const rows = foldLeaderboard(baseInputs({ markets: [settled], books }));
    const a = rows.find((r) => r.owner === OWNER_A)!;
    expect(a.escrowValue.toNumber()).toBe(5_000_000); // $2 bid + $3 ask
    expect(a.openOrders).toBe(2);
    expect(a.net.toNumber()).toBe(5_000_000);
  });

  it("bid escrow rounds UP (ceil) like the program", () => {
    const settled = market({});
    const book = emptyBook(OB_SETTLED);
    // price 0.333333, size 1 token → 0.333333 → ceil = 333334? numer=333333*1e6/1e6 → 333333
    book.bids.push(order(pk(1), OrderSide.Bid, 333_333, 1_000_001));
    const books = new Map([[OB_SETTLED.toBase58(), book]]) as BookMap;
    const rows = foldLeaderboard(baseInputs({ markets: [settled], books }));
    // ceil(333333 * 1000001 / 1e6) = ceil(333333.333333) = 333334
    expect(rows[0].escrowValue.toNumber()).toBe(333_334);
  });

  it("flags unpriceable open holdings, excludes them from net", () => {
    const open = market({
      address: MKT_OPEN,
      orderBook: OB_OPEN,
      state: "open",
      outcome: Outcome.Unsettled,
      settlementPrice: null,
    });
    const rows = foldLeaderboard(
      baseInputs({
        markets: [open],
        ownerUsdc: new Map([[OWNER_A, new BN(7_000_000)]]),
        holdingsByOwner: new Map([
          [
            OWNER_A,
            [
              {
                market: MKT_OPEN.toBase58(),
                side: "yes",
                amount: new BN(9_000_000),
              },
            ],
          ],
        ]),
        yesMarkByMarket: new Map([[MKT_OPEN.toBase58(), null]]),
      })
    );
    const a = rows[0];
    expect(a.unpriceableCount).toBe(1);
    expect(a.tokenValue.toNumber()).toBe(0);
    expect(a.net.toNumber()).toBe(7_000_000); // only the USDC counts
  });

  it("folds an owner across multiple markets into one row", () => {
    const m1 = market({
      address: MKT_SETTLED,
      orderBook: OB_SETTLED,
      outcome: Outcome.YesWins,
    });
    const m2 = market({
      address: MKT_OPEN,
      orderBook: OB_OPEN,
      state: "settled",
      outcome: Outcome.NoWins,
    });
    const rows = foldLeaderboard(
      baseInputs({
        markets: [m1, m2],
        holdingsByOwner: new Map([
          [
            OWNER_A,
            [
              {
                market: MKT_SETTLED.toBase58(),
                side: "yes",
                amount: new BN(2_000_000),
              }, // $2 win
              {
                market: MKT_OPEN.toBase58(),
                side: "no",
                amount: new BN(4_000_000),
              }, // $4 win
            ],
          ],
        ]),
      })
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].tokenValue.toNumber()).toBe(6_000_000);
    expect(rows[0].positions).toHaveLength(2);
  });
});

describe("foldMarketDrilldown", () => {
  const book = {
    bestBid: new BN(500_000),
    bestAsk: new BN(550_000),
    restingSize: new BN(7),
  };

  it("ranks holders by value, values settled winners 1:1 and losers 0", () => {
    const yesWins = market({}); // YesWins
    const view = foldMarketDrilldown(
      yesWins,
      [
        { owner: pk(1), side: "yes", amount: new BN(2_000_000) }, // win → $2
        { owner: pk(2), side: "no", amount: new BN(9_000_000) }, // lose → $0
        { owner: pk(3), side: "yes", amount: new BN(5_000_000) }, // win → $5
      ],
      null,
      book
    );
    expect(view.holders.map((h) => h.value.toNumber())).toEqual([
      5_000_000, 2_000_000, 0,
    ]);
    expect(view.holders[0].owner).toBe(pk(3).toBase58());
    expect(view.bestBid!.toNumber()).toBe(500_000);
    expect(view.restingSize.toNumber()).toBe(7);
  });

  it("marks open holdings to market, flags unpriceable when no mark", () => {
    const open = market({
      state: "open",
      outcome: Outcome.Unsettled,
      settlementPrice: null,
    });
    const marked = foldMarketDrilldown(
      open,
      [{ owner: pk(1), side: "yes", amount: new BN(2_000_000) }],
      new BN(600_000),
      book
    );
    expect(marked.holders[0].value.toNumber()).toBe(1_200_000);
    expect(marked.holders[0].unpriceable).toBe(false);

    const unmarked = foldMarketDrilldown(
      open,
      [{ owner: pk(1), side: "yes", amount: new BN(2_000_000) }],
      null,
      book
    );
    expect(unmarked.holders[0].unpriceable).toBe(true);
    expect(unmarked.holders[0].value.toNumber()).toBe(0);
  });

  it("drops zero-amount holders", () => {
    const yesWins = market({});
    const view = foldMarketDrilldown(
      yesWins,
      [{ owner: pk(1), side: "yes", amount: new BN(0) }],
      null,
      book
    );
    expect(view.holders).toHaveLength(0);
  });
});
