import { describe, it, expect } from "vitest";
import BN from "bn.js";
import { PublicKey } from "@solana/web3.js";
import { Outcome, Ticker } from "@meridian/sdk";
import type { DiscoveredMarket } from "./discovery";
import { representativeMarkets } from "./useTickerPrices";

function market(
  ticker: Ticker,
  strike: number,
  state: "open" | "settled" = "open"
): DiscoveredMarket {
  return {
    address: PublicKey.unique(),
    ticker,
    strike: new BN(strike),
    tradingDay: new BN(1),
    state,
    outcome: Outcome.Unsettled,
  };
}

describe("representativeMarkets", () => {
  it("picks one median-strike open market per ticker", () => {
    const markets = [
      market(Ticker.Aapl, 100),
      market(Ticker.Aapl, 200),
      market(Ticker.Aapl, 300),
      market(Ticker.Nvda, 500),
    ];
    const reps = representativeMarkets(markets);
    expect(reps.length).toBe(2);
    const aapl = reps.find((m) => m.ticker === Ticker.Aapl)!;
    expect(aapl.strike.toNumber()).toBe(200); // median of 3
  });

  it("falls back to settled markets when no open ones exist", () => {
    const reps = representativeMarkets([
      market(Ticker.Tsla, 100, "settled"),
      market(Ticker.Tsla, 200, "settled"),
    ]);
    expect(reps.length).toBe(1);
    expect(reps[0].ticker).toBe(Ticker.Tsla);
  });

  it("returns nothing for no markets", () => {
    expect(representativeMarkets([])).toEqual([]);
  });
});
