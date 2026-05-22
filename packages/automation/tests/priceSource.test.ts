/**
 * PriceSource tests. The morning job needs each ticker's previous close in USDC base
 * units (6 dp). The source is pluggable: a deterministic mock (for tests and a
 * market-hours-free demo) and a Pyth/Hermes-backed impl (reuses the SDK helper). Tests
 * cover the mock and the Pyth source's native-scale → base-units conversion via an
 * injected fetcher (no network).
 */

import { expect } from "chai";
import BN from "bn.js";
import { Ticker } from "@meridian/sdk";
import {
  MockPriceSource,
  PythPriceSource,
  nativeToUsdcBaseUnits,
} from "../src/priceSource";

describe("MockPriceSource", () => {
  it("returns the configured close for a ticker in base units", async () => {
    const src = new MockPriceSource({
      [Ticker.Meta]: new BN(680).mul(new BN(1_000_000)),
      [Ticker.Aapl]: new BN(214).mul(new BN(1_000_000)),
    });
    const meta = await src.previousClose(Ticker.Meta);
    expect(meta.eq(new BN(680_000_000))).to.be.true;
    const aapl = await src.previousClose(Ticker.Aapl);
    expect(aapl.eq(new BN(214_000_000))).to.be.true;
  });

  it("throws for a ticker with no configured price", async () => {
    const src = new MockPriceSource({});
    let err: unknown;
    try {
      await src.previousClose(Ticker.Tsla);
    } catch (e) {
      err = e;
    }
    expect(err).to.be.instanceOf(Error);
  });
});

describe("nativeToUsdcBaseUnits", () => {
  it("scales an equity exponent -8 price to 6dp base units (truncating)", () => {
    // $214.30 at exponent -8 → 214_30000000 native → 214_300000 base units.
    const v = nativeToUsdcBaseUnits(BigInt(214_30000000), -8);
    expect(v.eq(new BN(214_300000))).to.be.true;
  });

  it("scales a positive shift (exponent -5) by multiplying", () => {
    // $7.00 at exponent -5 → 700000 native → ×10 → 7_000000.
    const v = nativeToUsdcBaseUnits(BigInt(700_000), -5);
    expect(v.eq(new BN(7_000_000))).to.be.true;
  });

  it("rejects a negative price", () => {
    expect(() => nativeToUsdcBaseUnits(BigInt(-1), -8)).to.throw();
  });
});

describe("PythPriceSource", () => {
  it("fetches via the injected fetcher and converts to base units", async () => {
    const src = new PythPriceSource({
      feedIds: { [Ticker.Nvda]: "0xfeed-nvda" },
      // Inject a fetcher standing in for the SDK's Hermes helper.
      fetcher: async (feedId) => {
        expect(feedId).to.equal("0xfeed-nvda");
        return {
          feedId: "feed-nvda",
          price: BigInt(120_50000000), // $120.50 at expo -8
          conf: BigInt(5_000000),
          exponent: -8,
          publishTime: 1_700_000_000,
          binary: { encoding: "hex", data: [] },
        };
      },
    });
    const close = await src.previousClose(Ticker.Nvda);
    expect(close.eq(new BN(120_500000))).to.be.true;
  });

  it("throws a clear error when no feed id is configured for the ticker", async () => {
    const src = new PythPriceSource({
      feedIds: {},
      fetcher: async () => {
        throw new Error("should not be called");
      },
    });
    let err: unknown;
    try {
      await src.previousClose(Ticker.Googl);
    } catch (e) {
      err = e;
    }
    expect((err as Error).message).to.match(/feed id/i);
  });
});
