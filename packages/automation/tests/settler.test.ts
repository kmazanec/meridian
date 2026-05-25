/**
 * PythSettler error-classification tests (injected settle fn, no chain).
 *
 * The settler maps a thrown on-chain error to the job's three outcomes: a wide-confidence
 * rejection is retryable, an already-settled race is success, and everything else is a hard
 * error. Classification keys off the Anchor error name / `#[msg]` text in the thrown error.
 */

import { expect } from "chai";
import BN from "bn.js";
import { Ticker, Outcome, type MarketAccount } from "@meridian/sdk";
import { PublicKey } from "@solana/web3.js";
import { PythSettler } from "../src/settler";
import { SettleStatus } from "../src/settlementJob";
import type { ChainClient } from "../src/chain";

/** A no-op chain client (the settler only uses it via the injected settle fn here). */
const fakeChain = {} as ChainClient;

function market(ticker = Ticker.Meta): {
  address: PublicKey;
  account: MarketAccount;
} {
  return {
    address: new PublicKey(new Uint8Array(32).fill(7)),
    account: {
      ticker,
      strike: new BN(620_000_000),
      tradingDay: new BN(1000),
      yesMint: PublicKey.default,
      noMint: PublicKey.default,
      vault: PublicKey.default,
      orderBook: PublicKey.default,
      pairsMinted: new BN(0),
      winningRedeemed: new BN(0),
      state: "open",
      outcome: Outcome.Unsettled,
      settlementPrice: null,
      settledAt: null,
      bump: 0,
      vaultBump: 0,
      mintAuthorityBump: 0,
    },
  };
}

describe("PythSettler classification", () => {
  it("returns Settled on success", async () => {
    const settler = new PythSettler({
      chain: fakeChain,
      feedIds: { [Ticker.Meta]: "0xmeta" },
      settleFn: async () => {},
    });
    const r = await settler.settle(market());
    expect(r.status).to.equal(SettleStatus.Settled);
  });

  it("maps a WideConfidence error to the retryable status", async () => {
    const settler = new PythSettler({
      chain: fakeChain,
      feedIds: { [Ticker.Meta]: "0xmeta" },
      settleFn: async () => {
        throw new Error(
          "Transaction failed: Error Code: WideConfidence. Error Message: Oracle confidence band is too wide."
        );
      },
    });
    const r = await settler.settle(market());
    expect(r.status).to.equal(SettleStatus.WideConfidence);
  });

  it("maps a logs-less WideConfidence (numeric code only) to retryable", async () => {
    // Some RPCs return only `custom program error: 0x<code>` without the program logs/name.
    // 0x1781 = 6017 = WideConfidence. Must still be classified as retryable, not a hard error.
    const settler = new PythSettler({
      chain: fakeChain,
      feedIds: { [Ticker.Meta]: "0xmeta" },
      settleFn: async () => {
        throw new Error(
          "failed to send transaction: custom program error: 0x1781"
        );
      },
    });
    const r = await settler.settle(market());
    expect(r.status).to.equal(SettleStatus.WideConfidence);
  });

  it("does not false-match WideConfidence on an unrelated number in the message", async () => {
    // A slot/timestamp containing '6017' must NOT be read as the WideConfidence code.
    const settler = new PythSettler({
      chain: fakeChain,
      feedIds: { [Ticker.Meta]: "0xmeta" },
      settleFn: async () => {
        throw new Error("RPC error at slot 260175 while confirming");
      },
    });
    const r = await settler.settle(market());
    expect(r.status).to.equal(SettleStatus.Error);
  });

  it("treats an already-settled race as success (idempotent)", async () => {
    const settler = new PythSettler({
      chain: fakeChain,
      feedIds: { [Ticker.Meta]: "0xmeta" },
      settleFn: async () => {
        throw new Error("Error Message: Market is already settled");
      },
    });
    const r = await settler.settle(market());
    expect(r.status).to.equal(SettleStatus.Settled);
  });

  it("maps a stale-price error to a hard Error (not retryable)", async () => {
    const settler = new PythSettler({
      chain: fakeChain,
      feedIds: { [Ticker.Meta]: "0xmeta" },
      settleFn: async () => {
        throw new Error("Error Code: StalePrice. Oracle price is stale");
      },
    });
    const r = await settler.settle(market());
    expect(r.status).to.equal(SettleStatus.Error);
    expect(r.error).to.match(/stale/i);
  });

  it("errors when the ticker has no configured feed id", async () => {
    const settler = new PythSettler({
      chain: fakeChain,
      feedIds: {}, // none
      settleFn: async () => {},
    });
    const r = await settler.settle(market(Ticker.Tsla));
    expect(r.status).to.equal(SettleStatus.Error);
    expect(r.error).to.match(/feed id/i);
  });

  it("retries a 429 and succeeds without paging the operator", async () => {
    let calls = 0;
    const settler = new PythSettler({
      chain: fakeChain,
      feedIds: { [Ticker.Meta]: "0xmeta" },
      settleFn: async () => {
        calls++;
        if (calls < 3) throw new Error("failed to send: 429 Too Many Requests");
      },
      sleep: async () => {}, // instant backoff in tests
    });
    const r = await settler.settle(market());
    expect(r.status).to.equal(SettleStatus.Settled);
    expect(calls).to.equal(3); // two 429s, then success
  });

  it("gives up on a persistent 429 after exhausting retries (hard error)", async () => {
    let calls = 0;
    const settler = new PythSettler({
      chain: fakeChain,
      feedIds: { [Ticker.Meta]: "0xmeta" },
      settleFn: async () => {
        calls++;
        throw new Error("429 Too Many Requests");
      },
      rateLimitRetries: 2,
      sleep: async () => {},
    });
    const r = await settler.settle(market());
    expect(r.status).to.equal(SettleStatus.Error);
    expect(calls).to.equal(3); // initial + 2 retries
  });

  it("does NOT retry a wide-confidence rejection as if it were a 429", async () => {
    let calls = 0;
    const settler = new PythSettler({
      chain: fakeChain,
      feedIds: { [Ticker.Meta]: "0xmeta" },
      settleFn: async () => {
        calls++;
        throw new Error("Error Code: WideConfidence.");
      },
      sleep: async () => {},
    });
    const r = await settler.settle(market());
    expect(r.status).to.equal(SettleStatus.WideConfidence);
    expect(calls).to.equal(1); // classified on first attempt, no rate-limit retry
  });
});
