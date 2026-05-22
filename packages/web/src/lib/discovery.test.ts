import { describe, it, expect } from "vitest";
import BN from "bn.js";
import { PublicKey } from "@solana/web3.js";
import { Outcome, Ticker, type MeridianProgram } from "@meridian/sdk";
import {
  discoverMarkets,
  groupByTicker,
  activeCount,
  normalizeDiscovered,
} from "./discovery";

// A raw Anchor `.all()` entry: enum fields are camelCase single-key objects.
function rawMarket(opts: {
  ticker: string;
  strike: number;
  tradingDay: number;
  state?: "open" | "settled";
  outcome?: string;
}) {
  return {
    publicKey: PublicKey.default,
    account: {
      ticker: { [opts.ticker]: {} },
      strike: new BN(opts.strike),
      tradingDay: new BN(opts.tradingDay),
      state: { [opts.state ?? "open"]: {} },
      outcome: { [opts.outcome ?? "unsettled"]: {} },
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
      })
    );
    expect(d.ticker).toBe(Ticker.Meta);
    expect(d.strike.toNumber()).toBe(680_000_000);
    expect(d.state).toBe("settled");
    expect(d.outcome).toBe(Outcome.YesWins);
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
});
