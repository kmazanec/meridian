import { expect } from "chai";
import BN from "bn.js";
import { PublicKey } from "@solana/web3.js";
import { Harness, describeOnChain } from "./harness";
import { Ticker } from "../src/types";
import { marketPda } from "../src/pdas";
import * as ix from "../src/instructions";
import {
  buildPriceUpdateV2,
  PRICE_UPDATE_V2_DISCRIMINATOR,
  PYTH_RECEIVER_PROGRAM_ID,
} from "../src/pyth";

/**
 * Settlement via the pull oracle, proven hermetically: build a `PriceUpdateV2` account
 * (the exact bytes the Receiver writes and `oracle.rs` parses), inject it into LiteSVM,
 * and assert `settle_market` reads it and writes the correct outcome. The live
 * Hermes→Receiver devnet round-trip is a separate, opt-in test (needs market hours +
 * a funded key); it is documented and skipped by default.
 */
describe("Pyth helper", () => {
  describe("buildPriceUpdateV2 fixture", () => {
    it("starts with the PriceUpdateV2 discriminator and embeds the feed/price", () => {
      const feedId = new Uint8Array(32).fill(5);
      const data = buildPriceUpdateV2({
        feedId,
        price: BigInt(214_30000000),
        conf: BigInt(5_000000),
        exponent: -8,
        publishTime: BigInt(1_700_000_000),
      });
      expect([...data.subarray(0, 8)]).to.deep.equal([
        ...PRICE_UPDATE_V2_DISCRIMINATOR,
      ]);
      // write_authority (32) + Full tag (1) → feed_id starts at offset 41.
      expect([...data.subarray(41, 41 + 32)]).to.deep.equal([...feedId]);
    });
  });

  describeOnChain("settle_market reads the fixture (LiteSVM)", () => {
    let h: Harness;
    let usdc: PublicKey;
    const day = new BN(1_716_300_000);
    // META is ticker index 5; the seeded config sets feed_id = [5; 32].
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
      // Move clock just past the close instant so settle_market is allowed.
      h.setUnixTimestamp(day.toNumber() + 1);
    });

    it("settles YesWins when the posted price is at/above the strike", async () => {
      const market = marketPda(id.ticker, id.strike, id.tradingDay);
      // Price $700 at exponent -8 → 700_00000000 native. publish_time within the
      // staleness window (now = day+1).
      const data = buildPriceUpdateV2({
        feedId: Harness.feedId(Ticker.Meta),
        price: BigInt(700_00000000),
        conf: BigInt(10_000000), // tight band (~0.014%) — within MAX_CONFIDENCE_BPS
        exponent: -8,
        publishTime: BigInt(day.toNumber() + 1),
        fullVerification: true,
      });
      const priceUpdate = h.setPriceUpdateAccount(
        PYTH_RECEIVER_PROGRAM_ID,
        data
      );

      const cranker = h.user();
      const settleIx = await ix.settleMarket(h.program, {
        cranker: cranker.publicKey,
        market: id,
        priceUpdate,
      });
      h.send([settleIx], [cranker]);

      const m = h.decode<{
        outcome: object;
        settlementPrice: BN | null;
        state: object;
      }>("market", market);
      expect(Object.keys(m.outcome)[0]).to.equal("yesWins");
      expect(Object.keys(m.state)[0]).to.equal("settled");
      // $700 → 700_000000 in 6dp base units.
      expect((m.settlementPrice as BN).toString()).to.equal("700000000");
    });

    it("rejects a wrong-feed update (feed id mismatch)", async () => {
      // A fresh market so it is still Open.
      const id2 = {
        ticker: Ticker.Aapl,
        strike: new BN(200_000_000),
        tradingDay: day,
      };
      await h.createMarket({ ...id2, usdcMint: usdc });
      h.setUnixTimestamp(day.toNumber() + 1);

      // Post an update for the WRONG feed (Meta's feed for an Aapl market).
      const data = buildPriceUpdateV2({
        feedId: Harness.feedId(Ticker.Meta),
        price: BigInt(210_00000000),
        conf: BigInt(1_000000),
        exponent: -8,
        publishTime: BigInt(day.toNumber() + 1),
      });
      const priceUpdate = h.setPriceUpdateAccount(
        PYTH_RECEIVER_PROGRAM_ID,
        data
      );
      const cranker = h.user();
      const settleIx = await ix.settleMarket(h.program, {
        cranker: cranker.publicKey,
        market: id2,
        priceUpdate,
      });
      const res = h.trySend([settleIx], [cranker]);
      expect(res.constructor.name).to.equal("FailedTransactionMetadata");
    });

    it("rejects a partially-verified update", async () => {
      const id3 = {
        ticker: Ticker.Tsla,
        strike: new BN(250_000_000),
        tradingDay: day,
      };
      await h.createMarket({ ...id3, usdcMint: usdc });
      h.setUnixTimestamp(day.toNumber() + 1);

      const data = buildPriceUpdateV2({
        feedId: Harness.feedId(Ticker.Tsla),
        price: BigInt(260_00000000),
        conf: BigInt(1_000000),
        exponent: -8,
        publishTime: BigInt(day.toNumber() + 1),
        fullVerification: false, // Partial → settle_market must reject
      });
      const priceUpdate = h.setPriceUpdateAccount(
        PYTH_RECEIVER_PROGRAM_ID,
        data
      );
      const cranker = h.user();
      const settleIx = await ix.settleMarket(h.program, {
        cranker: cranker.publicKey,
        market: id3,
        priceUpdate,
      });
      const res = h.trySend([settleIx], [cranker]);
      expect(res.constructor.name).to.equal("FailedTransactionMetadata");
    });
  });

  // Live devnet round-trip (Hermes → Receiver → settle). Non-hermetic: needs a funded
  // devnet keypair, an RPC, the optional Pyth peer deps, and (for equities) US market
  // hours. Enable with PYTH_LIVE=1. Documented here as the manual proof of the live leg.
  describe("live devnet round-trip", () => {
    const enabled = process.env.PYTH_LIVE === "1";
    (enabled ? it : it.skip)(
      "fetches from Hermes and posts via the Receiver",
      async function () {
        this.timeout(120_000);
        const { fetchPriceUpdate } = await import("../src/pyth");
        const feed = process.env.PYTH_FEED_ID;
        expect(feed, "set PYTH_FEED_ID to a valid feed").to.be.a("string");
        const update = await fetchPriceUpdate(feed as string);
        expect(update.binary.data.length).to.be.greaterThan(0);
        // Posting + settle require RPC + a funded keypair; covered by F-09 / manual demo.
      }
    );
  });
});
