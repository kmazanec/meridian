import { describe, it, expect } from "vitest";
import BN from "bn.js";
import { Outcome, Ticker } from "@meridian/sdk";
import type { FillRecord } from "./tradeStore";
import {
  dailyResults,
  latestTradingDay,
  formatWinRate,
  type SettledMarketInfo,
} from "./results";

const DAY = new BN(1_700_000_000);
const OTHER_DAY = new BN(1_700_086_400);

/** A fill: size in tokens (dollars), price as a fraction (0..1). */
function fill(
  market: string,
  side: "yes" | "no",
  sizeTokens: number,
  priceFrac: number,
  ts = 1
): FillRecord {
  return {
    market,
    side,
    size: new BN(sizeTokens * 1_000_000).toString(),
    price: new BN(Math.round(priceFrac * 1_000_000)).toString(),
    ts,
  };
}

function market(
  ticker: Ticker,
  outcome: Outcome,
  tradingDay = DAY
): SettledMarketInfo {
  return { ticker, outcome, tradingDay };
}

describe("dailyResults", () => {
  it("computes wagered, earned, lost, net, and win rate for the day", () => {
    // AAPL market A: bought 5 Yes @ $0.60 (cost $3.00); Yes wins → earns $5.00 (+$2.00).
    // AAPL market B: bought 4 No @ $0.50 (cost $2.00); Yes wins → No loses → earns $0 (−$2.00).
    const markets = new Map<string, SettledMarketInfo>([
      ["A", market(Ticker.Aapl, Outcome.YesWins)],
      ["B", market(Ticker.Aapl, Outcome.YesWins)],
    ]);
    const fills = [fill("A", "yes", 5, 0.6), fill("B", "no", 4, 0.5)];

    const r = dailyResults(fills, markets, DAY);
    expect(r.wagered.toNumber()).toBe(5_000_000); // $3 + $2
    expect(r.earned.toNumber()).toBe(5_000_000); // $5 from the winner
    expect(r.lost.toNumber()).toBe(2_000_000); // $2 sunk in the loser
    expect(r.netPnl.toNumber()).toBe(0); // $5 earned − $5 wagered
    expect(r.wonCount).toBe(1);
    expect(r.lostCount).toBe(1);
    expect(r.positionCount).toBe(2);
    expect(r.winRate).toBeCloseTo(0.5);
  });

  it("aggregates multiple fills of the same position (size-summed cost)", () => {
    const markets = new Map([["A", market(Ticker.Nvda, Outcome.YesWins)]]);
    // Two buys of the same Yes: 2 @ $0.40 ($0.80) + 3 @ $0.50 ($1.50) = 5 tokens, $2.30 cost.
    const fills = [fill("A", "yes", 2, 0.4), fill("A", "yes", 3, 0.5)];
    const r = dailyResults(fills, markets, DAY);
    expect(r.wagered.toNumber()).toBe(2_300_000); // $2.30
    expect(r.earned.toNumber()).toBe(5_000_000); // 5 winning tokens × $1
    expect(r.netPnl.toNumber()).toBe(2_700_000); // +$2.70
    expect(r.wonCount).toBe(1); // one position, not two fills
  });

  it("ignores fills on other days, open markets, and unknown markets", () => {
    const markets = new Map<string, SettledMarketInfo>([
      ["today", market(Ticker.Aapl, Outcome.YesWins, DAY)],
      ["yesterday", market(Ticker.Aapl, Outcome.YesWins, OTHER_DAY)],
      ["undecided", market(Ticker.Aapl, Outcome.Unsettled, DAY)],
    ]);
    const fills = [
      fill("today", "yes", 1, 0.5),
      fill("yesterday", "yes", 9, 0.5), // different day
      fill("undecided", "yes", 9, 0.5), // not settled
      fill("ghost", "yes", 9, 0.5), // not in the market map
    ];
    const r = dailyResults(fills, markets, DAY);
    expect(r.positionCount).toBe(1);
    expect(r.wagered.toNumber()).toBe(500_000); // only the $0.50 today fill
  });

  it("breaks results down per stock, biggest stake first", () => {
    const markets = new Map<string, SettledMarketInfo>([
      ["a", market(Ticker.Aapl, Outcome.YesWins)],
      ["n", market(Ticker.Nvda, Outcome.NoWins)],
    ]);
    const fills = [
      fill("a", "yes", 10, 0.6), // AAPL: cost $6, wins → earns $10
      fill("n", "yes", 2, 0.5), // NVDA: cost $1, Yes loses → earns $0
    ];
    const r = dailyResults(fills, markets, DAY);
    expect(r.byStock.map((s) => s.symbol)).toEqual(["AAPL", "NVDA"]); // AAPL staked more
    const aapl = r.byStock[0];
    expect(aapl.wagered.toNumber()).toBe(6_000_000);
    expect(aapl.earned.toNumber()).toBe(10_000_000);
    expect(aapl.net.toNumber()).toBe(4_000_000);
    expect(aapl.wonCount).toBe(1);
    const nvda = r.byStock[1];
    expect(nvda.net.toNumber()).toBe(-1_000_000); // lost the $1 stake
    expect(nvda.lostCount).toBe(1);
  });

  it("returns a null win rate and empty breakdown with no settled fills", () => {
    const r = dailyResults([], new Map(), DAY);
    expect(r.positionCount).toBe(0);
    expect(r.winRate).toBeNull();
    expect(r.byStock).toEqual([]);
    expect(r.netPnl.toNumber()).toBe(0);
  });

  it("counts a No position that wins", () => {
    const markets = new Map([["m", market(Ticker.Tsla, Outcome.NoWins)]]);
    const fills = [fill("m", "no", 3, 0.3)]; // bought 3 No @ $0.30 ($0.90); No wins → $3
    const r = dailyResults(fills, markets, DAY);
    expect(r.wonCount).toBe(1);
    expect(r.earned.toNumber()).toBe(3_000_000);
    expect(r.netPnl.toNumber()).toBe(2_100_000); // $3 − $0.90
  });
});

describe("latestTradingDay", () => {
  it("returns the most recent settled day, ignoring unsettled", () => {
    const markets = new Map<string, SettledMarketInfo>([
      ["a", market(Ticker.Aapl, Outcome.YesWins, DAY)],
      ["b", market(Ticker.Nvda, Outcome.NoWins, OTHER_DAY)],
      ["c", market(Ticker.Tsla, Outcome.Unsettled, new BN(1_700_200_000))],
    ]);
    expect(latestTradingDay(markets)?.eq(OTHER_DAY)).toBe(true);
  });

  it("is null when nothing is settled", () => {
    const markets = new Map([["c", market(Ticker.Tsla, Outcome.Unsettled)]]);
    expect(latestTradingDay(markets)).toBeNull();
  });
});

describe("formatWinRate", () => {
  it("rounds to a whole percent, or — when null", () => {
    expect(formatWinRate(0.611)).toBe("61%");
    expect(formatWinRate(1)).toBe("100%");
    expect(formatWinRate(null)).toBe("—");
  });
});
