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
  livePricesByTicker,
  nearestTheMoneyRow,
  featuredCalls,
  activitySummary,
  recentWins,
  buildBoardRow,
  sortBoardRows,
  type BookMap,
  type StrikeRow,
  type TickerView,
  type MarketsBoardRow,
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
    const row = strikeRow(
      market({ strike: 680_000_000, orderBook: ob }),
      books
    );
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

describe("livePricesByTicker", () => {
  it("maps each ticker to its representative open price from the shared books", () => {
    const aaplOb = PublicKey.unique();
    const tslaOb = PublicKey.unique();
    const books: BookMap = new Map([
      [
        aaplOb.toBase58(),
        book(
          [order(OrderSide.Bid, 400_000, 1_000_000, 1)],
          [order(OrderSide.Ask, 500_000, 1_000_000, 2)]
        ),
      ],
      // TSLA's only open market has an empty book → 50/50 fallback.
      [tslaOb.toBase58(), book([], [])],
    ]);
    const markets = [
      market({ ticker: Ticker.Aapl, strike: 100, orderBook: aaplOb }),
      market({ ticker: Ticker.Tsla, strike: 200, orderBook: tslaOb }),
    ];
    const prices = livePricesByTicker(markets, books);
    expect(prices[Ticker.Aapl]?.toNumber()).toBe(450_000); // mid 0.40/0.50
    expect(prices[Ticker.Tsla]?.toNumber()).toBe(PRICE_SCALE.toNumber() / 2);
  });

  it("omits tickers with no open market", () => {
    const prices = livePricesByTicker(
      [
        market({
          ticker: Ticker.Nvda,
          strike: 100,
          state: "settled",
          orderBook: PublicKey.unique(),
        }),
      ],
      new Map()
    );
    expect(prices[Ticker.Nvda]).toBeUndefined();
  });
});

// --- Home page selectors: nearestTheMoneyRow / featuredCalls / activitySummary ---

const HALF = PRICE_SCALE.divn(2).toNumber(); // 50¢ in price-scale units

/** A minimal open StrikeRow at a dollar strike with a Yes price as a fraction (0..1). */
function strikeRowAt(strikeDollars: number, yesFraction: number): StrikeRow {
  const yesPrice = new BN(Math.round(yesFraction * PRICE_SCALE.toNumber()));
  return {
    address: PublicKey.unique().toBase58(),
    strike: new BN(strikeDollars * 1_000_000),
    state: "open",
    outcome: Outcome.Unsettled,
    yesPrice,
    noPrice: PRICE_SCALE.sub(yesPrice),
    spread: null,
    restingSize: new BN(0),
    depth: { bids: [], asks: [] },
    settlementPrice: null,
  };
}

function tickerView(
  ticker: Ticker,
  symbol: string,
  rows: StrikeRow[],
  opts: { openInterest?: number; activeCount?: number } = {}
): TickerView {
  return {
    ticker,
    symbol,
    tradingDay: new BN(1_700_000_000),
    activeCount:
      opts.activeCount ?? rows.filter((r) => r.state === "open").length,
    repYesPrice: rows[0]?.yesPrice ?? null,
    repStrikeDollars: rows[0] ? rows[0].strike.toNumber() / 1_000_000 : null,
    totalRestingSize: new BN(0),
    totalPairsMinted: new BN(opts.openInterest ?? 0),
    totalCollateral: new BN(opts.openInterest ?? 0),
    rows,
    history: null,
  };
}

describe("nearestTheMoneyRow", () => {
  const view = tickerView(Ticker.Nvda, "NVDA", [
    strikeRowAt(200, 0.92),
    strikeRowAt(210, 0.6),
    strikeRowAt(220, 0.3),
    strikeRowAt(230, 0.07),
  ]);

  it("picks the strike closest to spot", () => {
    expect(nearestTheMoneyRow(view, 212)?.strike.toNumber()).toBe(210 * 1e6);
    expect(nearestTheMoneyRow(view, 228)?.strike.toNumber()).toBe(230 * 1e6);
  });

  it("returns null without a spot or open rows", () => {
    expect(nearestTheMoneyRow(view, null)).toBeNull();
    const settled = tickerView(Ticker.Nvda, "NVDA", [
      { ...strikeRowAt(210, 0.5), state: "settled" },
    ]);
    expect(nearestTheMoneyRow(settled, 210)).toBeNull();
  });
});

describe("featuredCalls", () => {
  // NVDA's near-money strike is a near coin-flip; AAPL's is lopsided; MSFT has no spot.
  const nvda = tickerView(
    Ticker.Nvda,
    "NVDA",
    [strikeRowAt(210, 0.52), strikeRowAt(220, 0.2)],
    { openInterest: 9_400_000000 }
  );
  const aapl = tickerView(Ticker.Aapl, "AAPL", [strikeRowAt(310, 0.78)], {
    openInterest: 6_000_000000,
  });
  const tsla = tickerView(Ticker.Tsla, "TSLA", [strikeRowAt(430, 0.46)], {
    openInterest: 7_000_000000,
  });

  const spots = {
    [Ticker.Nvda]: { close: 211, changePct: -0.019 },
    [Ticker.Aapl]: { close: 308, changePct: 0.013 },
    [Ticker.Tsla]: { close: 431, changePct: 0.02 },
  };

  it("features the nearest-the-money strike per ticker, ranked by closeness to 50/50", () => {
    // NVDA Yes 0.52 (|Δ|=0.02) is closer to a coin-flip than TSLA 0.46 (|Δ|=0.04); AAPL 0.78 last.
    const calls = featuredCalls([nvda, aapl, tsla], spots, 3);
    expect(calls.map((c) => c.symbol)).toEqual(["NVDA", "TSLA", "AAPL"]);
    // NVDA features the $210 strike (nearest its $211 spot), not the $220.
    expect(calls.find((c) => c.symbol === "NVDA")?.strike.toNumber()).toBe(
      210 * 1e6
    );
  });

  it("respects the count and skips tickers without a spot or open market", () => {
    const msft = tickerView(Ticker.Msft, "MSFT", [strikeRowAt(400, 0.5)]); // no spot provided
    const calls = featuredCalls([nvda, aapl, tsla, msft], spots, 2);
    expect(calls).toHaveLength(2);
    expect(calls.some((c) => c.symbol === "MSFT")).toBe(false);
  });

  it("uses each featured call's distance from the 50¢ midpoint", () => {
    const calls = featuredCalls([nvda], spots, 1);
    expect(Math.abs(calls[0].yesPrice.toNumber() - HALF)).toBeLessThan(
      0.05 * PRICE_SCALE.toNumber()
    );
  });
});

describe("activitySummary", () => {
  it("sums open interest and counts open markets / active stocks", () => {
    const nvda = tickerView(
      Ticker.Nvda,
      "NVDA",
      [strikeRowAt(210, 0.5), strikeRowAt(220, 0.3)],
      { openInterest: 9_000_000000, activeCount: 2 }
    );
    const aapl = tickerView(Ticker.Aapl, "AAPL", [strikeRowAt(310, 0.6)], {
      openInterest: 6_000_000000,
      activeCount: 1,
    });
    const tsla = tickerView(Ticker.Tsla, "TSLA", [], {
      openInterest: 0,
      activeCount: 0,
    });
    const sum = activitySummary([nvda, aapl, tsla]);
    expect(sum.openInterest.toNumber()).toBe(15_000_000000);
    expect(sum.openMarkets).toBe(3);
    expect(sum.stockCount).toBe(2); // TSLA has no open markets
    expect(sum.tradingDay).not.toBeNull();
  });
});

describe("recentWins", () => {
  const ob = () => PublicKey.unique();

  it("keeps only settled markets with a real outcome and a stake, newest first", () => {
    const open = market({ strike: 300_000_000, orderBook: ob() });
    const noStake = {
      ...market({
        strike: 310_000_000,
        state: "settled",
        outcome: Outcome.YesWins,
        orderBook: ob(),
        pairsMinted: 0,
      }),
    };
    const day1 = {
      ...market({
        ticker: Ticker.Tsla,
        strike: 300_000_000,
        state: "settled",
        outcome: Outcome.YesWins,
        orderBook: ob(),
        pairsMinted: 1_000_000,
        settlementPrice: 312_400_000,
      }),
      tradingDay: new BN(1000),
    };
    const day2 = {
      ...market({
        ticker: Ticker.Aapl,
        strike: 210_000_000,
        state: "settled",
        outcome: Outcome.NoWins,
        orderBook: ob(),
        pairsMinted: 5_000_000,
        settlementPrice: 205_000_000,
      }),
      tradingDay: new BN(2000),
    };

    const wins = recentWins([open, noStake, day1, day2]);
    // Open + zero-stake markets are dropped; newest settlement day leads.
    expect(wins.map((w) => w.symbol)).toEqual(["AAPL", "TSLA"]);
    expect(wins[0].outcome).toBe(Outcome.NoWins);
    expect(wins[0].settlementPrice?.toNumber()).toBe(205_000_000);
    expect(wins[0].payout.toNumber()).toBe(5_000_000);
  });

  it("respects the count cap", () => {
    const settled = Array.from({ length: 5 }, (_, i) => ({
      ...market({
        strike: 300_000_000,
        state: "settled",
        outcome: Outcome.YesWins,
        orderBook: ob(),
        pairsMinted: 1_000_000,
        settlementPrice: 305_000_000,
      }),
      tradingDay: new BN(i + 1),
    }));
    expect(recentWins(settled, 3)).toHaveLength(3);
  });
});

describe("buildBoardRow", () => {
  it("joins the live price and features the nearest-the-money strike", () => {
    const view = tickerView(Ticker.Nvda, "NVDA", [
      strikeRowAt(200, 0.92),
      strikeRowAt(210, 0.6),
      strikeRowAt(220, 0.3),
    ]);
    const rowData = buildBoardRow(view, { price: 211, pctFromOpen: -0.017 });
    expect(rowData.livePrice).toBe(211);
    expect(rowData.pctFromOpen).toBeCloseTo(-0.017);
    expect(rowData.open).toBe(true);
    // Open: display columns track the live quote.
    expect(rowData.displayPrice).toBe(211);
    expect(rowData.changePct).toBeCloseTo(-0.017);
    // Live price 211 → nearest strike is $210.
    expect(rowData.atmRow?.strike.toNumber()).toBe(210_000_000);
  });

  it("closed: displays the settled close and the day's open→close move (not a dash)", () => {
    const settled: StrikeRow = {
      ...strikeRowAt(210, 0.6),
      state: "settled",
      outcome: Outcome.YesWins,
      settlementPrice: new BN(211_890_000), // closed at $211.89
    };
    const view: TickerView = {
      ...tickerView(Ticker.Nvda, "NVDA", [settled], { activeCount: 0 }),
      history: [{ date: "2026-05-23", open: 215.0, close: 211.89 }],
    };
    // No live quote for a past day → live price is null.
    const rowData = buildBoardRow(view, { price: null, pctFromOpen: null });
    expect(rowData.open).toBe(false);
    expect(rowData.outcome).toBe(Outcome.YesWins);
    expect(rowData.settlementPrice?.toNumber()).toBe(211_890_000);
    // Closed row still shows a real price (the close) and a real move (215 → 211.89).
    expect(rowData.displayPrice).toBeCloseTo(211.89);
    expect(rowData.changePct).toBeCloseTo(211.89 / 215.0 - 1);
  });
});

describe("sortBoardRows", () => {
  const open = (
    symbol: string,
    ticker: Ticker,
    yes: number,
    price: number,
    pct: number,
    liq = 0
  ): MarketsBoardRow => {
    const view = tickerView(ticker, symbol, [strikeRowAt(100, yes)]);
    return {
      ...buildBoardRow(view, { price, pctFromOpen: pct }),
      liquidity: new BN(liq),
    };
  };
  const closed = (symbol: string, ticker: Ticker): MarketsBoardRow => {
    const settled: StrikeRow = {
      ...strikeRowAt(100, 0.5),
      state: "settled",
      outcome: Outcome.NoWins,
    };
    const view = tickerView(ticker, symbol, [settled], { activeCount: 0 });
    return buildBoardRow(view, { price: 99, pctFromOpen: 0 });
  };

  it("keeps open stocks above closed ones regardless of key", () => {
    const rows = [
      closed("AAPL", Ticker.Aapl),
      open("NVDA", Ticker.Nvda, 0.5, 100, 0),
    ];
    const sorted = sortBoardRows(rows, "action");
    expect(sorted.map((r) => r.symbol)).toEqual(["NVDA", "AAPL"]);
  });

  it("action: ranks the nearest coin-flip first, ties broken by liquidity", () => {
    const flip = open("NVDA", Ticker.Nvda, 0.5, 100, 0, 10); // exactly 50/50
    const decided = open("MSFT", Ticker.Msft, 0.9, 100, 0, 999); // lopsided
    const flip2 = open("AAPL", Ticker.Aapl, 0.5, 100, 0, 50); // 50/50, more liquid
    const sorted = sortBoardRows([decided, flip, flip2], "action");
    // Both coin-flips beat the decided bet; among them the deeper book (AAPL) leads.
    expect(sorted.map((r) => r.symbol)).toEqual(["AAPL", "NVDA", "MSFT"]);
  });

  it("mover: ranks the biggest absolute move first", () => {
    const a = open("NVDA", Ticker.Nvda, 0.5, 100, -0.03);
    const b = open("MSFT", Ticker.Msft, 0.5, 100, 0.01);
    const c = open("AAPL", Ticker.Aapl, 0.5, 100, 0.05);
    expect(sortBoardRows([a, b, c], "mover").map((r) => r.symbol)).toEqual([
      "AAPL",
      "NVDA",
      "MSFT",
    ]);
  });

  it("symbol: sorts A→Z", () => {
    const rows = [
      open("TSLA", Ticker.Tsla, 0.5, 100, 0),
      open("AAPL", Ticker.Aapl, 0.5, 100, 0),
      open("MSFT", Ticker.Msft, 0.5, 100, 0),
    ];
    expect(sortBoardRows(rows, "symbol").map((r) => r.symbol)).toEqual([
      "AAPL",
      "MSFT",
      "TSLA",
    ]);
  });

  it("does not mutate the input array", () => {
    const rows = [
      open("TSLA", Ticker.Tsla, 0.5, 100, 0),
      open("AAPL", Ticker.Aapl, 0.5, 100, 0),
    ];
    const before = rows.map((r) => r.symbol);
    sortBoardRows(rows, "symbol");
    expect(rows.map((r) => r.symbol)).toEqual(before);
  });
});
