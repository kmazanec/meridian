import { describe, it, expect } from "vitest";
import BN from "bn.js";
import { PublicKey } from "@solana/web3.js";
import { Outcome, Ticker, type MeridianProgram } from "@meridian/sdk";
import {
  discoverMarkets,
  groupByTicker,
  groupByTradingDay,
  activeCount,
  maxTradingDay,
  currentTradingDayMarkets,
  normalizeDiscovered,
} from "./discovery";

// A raw Anchor `.all()` entry: enum fields are camelCase single-key objects.
function rawMarket(opts: {
  ticker: string;
  strike: number;
  tradingDay: number;
  state?: "open" | "settled";
  outcome?: string;
  pairsMinted?: number;
  settlementPrice?: number | null;
}) {
  return {
    publicKey: PublicKey.default,
    account: {
      ticker: { [opts.ticker]: {} },
      strike: new BN(opts.strike),
      tradingDay: new BN(opts.tradingDay),
      state: { [opts.state ?? "open"]: {} },
      outcome: { [opts.outcome ?? "unsettled"]: {} },
      orderBook: PublicKey.unique(),
      pairsMinted: new BN(opts.pairsMinted ?? 0),
      settlementPrice:
        opts.settlementPrice == null ? null : new BN(opts.settlementPrice),
    },
  };
}

/** A program stub whose `account.market.all()` returns canned raw markets. */
function programWith(raws: ReturnType<typeof rawMarket>[]): MeridianProgram {
  return {
    account: { market: { all: async () => raws } },
  } as unknown as MeridianProgram;
}

describe("discovery", () => {
  it("normalizes a raw market into typed fields", () => {
    const d = normalizeDiscovered(
      rawMarket({
        ticker: "meta",
        strike: 680_000_000,
        tradingDay: 1_716_321_600,
        state: "settled",
        outcome: "yesWins",
        pairsMinted: 5_000_000,
        settlementPrice: 712_340_000,
      })
    );
    expect(d.ticker).toBe(Ticker.Meta);
    expect(d.strike.toNumber()).toBe(680_000_000);
    expect(d.state).toBe("settled");
    expect(d.outcome).toBe(Outcome.YesWins);
    expect(d.pairsMinted.toNumber()).toBe(5_000_000);
    expect(d.settlementPrice?.toNumber()).toBe(712_340_000);
  });

  it("leaves settlementPrice null while a market is open", () => {
    const d = normalizeDiscovered(
      rawMarket({ ticker: "aapl", strike: 180_000_000, tradingDay: 1 })
    );
    expect(d.settlementPrice).toBeNull();
    expect(d.pairsMinted.toNumber()).toBe(0);
  });

  it("discovers + sorts markets by ticker, strike, then day", async () => {
    const program = programWith([
      rawMarket({ ticker: "tsla", strike: 200_000_000, tradingDay: 100 }),
      rawMarket({ ticker: "aapl", strike: 190_000_000, tradingDay: 100 }),
      rawMarket({ ticker: "aapl", strike: 180_000_000, tradingDay: 100 }),
    ]);
    const markets = await discoverMarkets(program);
    expect(markets.map((m) => m.ticker)).toEqual([
      Ticker.Aapl,
      Ticker.Aapl,
      Ticker.Tsla,
    ]);
    // Within AAPL, lower strike first.
    expect(markets[0].strike.toNumber()).toBe(180_000_000);
    expect(markets[1].strike.toNumber()).toBe(190_000_000);
  });

  it("groups by ticker and counts active (open) markets", async () => {
    const program = programWith([
      rawMarket({ ticker: "aapl", strike: 180_000_000, tradingDay: 1 }),
      rawMarket({
        ticker: "aapl",
        strike: 190_000_000,
        tradingDay: 1,
        state: "settled",
        outcome: "noWins",
      }),
      rawMarket({ ticker: "nvda", strike: 120_000_000, tradingDay: 1 }),
    ]);
    const markets = await discoverMarkets(program);
    const grouped = groupByTicker(markets);
    expect(grouped.get(Ticker.Aapl)!.length).toBe(2);
    expect(activeCount(grouped.get(Ticker.Aapl)!)).toBe(1); // one settled
    expect(activeCount(grouped.get(Ticker.Nvda)!)).toBe(1);
  });

  describe("groupByTradingDay", () => {
    // 4pm ET close instants on two consecutive ET dates.
    const DAY1 = 1_716_499_200; // 2024-05-23 16:00 ET
    const DAY2 = 1_716_585_600; // 2024-05-24 16:00 ET

    it("buckets by ET day, newest first, markets sorted by ticker then strike", async () => {
      const program = programWith([
        rawMarket({ ticker: "aapl", strike: 190_000_000, tradingDay: DAY1 }),
        rawMarket({ ticker: "aapl", strike: 180_000_000, tradingDay: DAY1 }),
        rawMarket({ ticker: "nvda", strike: 120_000_000, tradingDay: DAY2 }),
        rawMarket({ ticker: "aapl", strike: 200_000_000, tradingDay: DAY2 }),
      ]);
      const markets = await discoverMarkets(program);
      const groups = groupByTradingDay(markets);

      expect(groups.map((g) => g.dayKey)).toEqual(["2024-05-24", "2024-05-23"]); // newest first
      // Day 2: AAPL before NVDA (ticker order).
      expect(groups[0].markets.map((m) => m.ticker)).toEqual([
        Ticker.Aapl,
        Ticker.Nvda,
      ]);
      // Day 1: same ticker, ascending strike.
      expect(groups[1].markets.map((m) => m.strike.toNumber())).toEqual([
        180_000_000, 190_000_000,
      ]);
    });

    it("keeps same ticker+strike on different days in separate groups", async () => {
      // The exact bug from the screenshot: AAPL $280 appears on two days.
      const program = programWith([
        rawMarket({
          ticker: "aapl",
          strike: 280_000_000,
          tradingDay: DAY1,
          state: "settled",
          outcome: "yesWins",
        }),
        rawMarket({ ticker: "aapl", strike: 280_000_000, tradingDay: DAY2 }),
      ]);
      const markets = await discoverMarkets(program);
      const groups = groupByTradingDay(markets);
      expect(groups).toHaveLength(2);
      expect(groups.every((g) => g.markets.length === 1)).toBe(true);
    });
  });

  describe("currentTradingDayMarkets", () => {
    const DAY1 = 1_716_499_200; // older
    const DAY2 = 1_716_585_600; // current (latest)

    it("keeps only the latest trading day's markets (drops past-day duplicates)", async () => {
      // The screenshot bug: AAPL $280 settled yesterday + open today; only today's stays.
      const program = programWith([
        rawMarket({
          ticker: "aapl",
          strike: 280_000_000,
          tradingDay: DAY1,
          state: "settled",
          outcome: "yesWins",
        }),
        rawMarket({ ticker: "aapl", strike: 280_000_000, tradingDay: DAY2 }),
        rawMarket({ ticker: "aapl", strike: 300_000_000, tradingDay: DAY2 }),
      ]);
      const markets = await discoverMarkets(program);
      const current = currentTradingDayMarkets(markets);
      expect(current).toHaveLength(2);
      expect(current.every((m) => m.tradingDay.toNumber() === DAY2)).toBe(true);
      // No duplicate strike levels remain.
      const strikes = current.map((m) => m.strike.toNumber());
      expect(new Set(strikes).size).toBe(strikes.length);
    });

    it("returns [] for no markets", () => {
      expect(currentTradingDayMarkets([])).toEqual([]);
    });
  });

  describe("maxTradingDay", () => {
    it("returns the latest trading-day instant, or null when empty", () => {
      const markets = [
        normalizeDiscovered(
          rawMarket({ ticker: "aapl", strike: 1, tradingDay: 100 })
        ),
        normalizeDiscovered(
          rawMarket({ ticker: "aapl", strike: 2, tradingDay: 300 })
        ),
        normalizeDiscovered(
          rawMarket({ ticker: "aapl", strike: 3, tradingDay: 200 })
        ),
      ];
      expect(maxTradingDay(markets)?.toNumber()).toBe(300);
      expect(maxTradingDay([])).toBeNull();
    });
  });
});
