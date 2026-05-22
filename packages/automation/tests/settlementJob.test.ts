/**
 * Settlement-job orchestration tests (chain + oracle boundary mocked).
 *
 * The job, after the close:
 *   - discovers open markets whose trading_day has passed,
 *   - settles each via the pull oracle (post Hermes update → settle_market),
 *   - is idempotent: an already-settled market is skipped (a re-settle is a safe on-chain
 *     no-op anyway),
 *   - on a *wide-confidence* rejection, retries every 30s up to 15 min, then alerts the
 *     admin for `admin_settle`,
 *   - never assumes privilege beyond the permissioned instructions.
 * A virtual clock makes the retry loop instant and deterministic.
 */

import { expect } from "chai";
import BN from "bn.js";
import { Ticker, Outcome, type MarketAccount } from "@meridian/sdk";
import { PublicKey } from "@solana/web3.js";
import {
  runSettlementJob,
  type Settler,
  SettleStatus,
} from "../src/settlementJob";
import { createLogger, type LogLine } from "../src/logger";
import type { Alerter, AlertPayload } from "../src/alerter";
import type { MarketDiscovery } from "../src/markets";

function captureLogger() {
  const lines: LogLine[] = [];
  return { logger: createLogger({ sink: (l) => lines.push(l) }), lines };
}

class RecordingAlerter implements Alerter {
  readonly alerts: AlertPayload[] = [];
  async alert(p: AlertPayload): Promise<void> {
    this.alerts.push(p);
  }
}

/** Virtual clock so the 30s/15min loop runs instantly. */
function virtualClock(startMs = 0) {
  let nowMs = startMs;
  return {
    now: () => nowMs,
    sleep: async (ms: number) => {
      nowMs += ms;
    },
  };
}

let addrCounter = 0;
function freshMarket(overrides: Partial<MarketAccount> = {}): {
  address: PublicKey;
  account: MarketAccount;
} {
  const address = new PublicKey(new Uint8Array(32).fill(++addrCounter));
  const account: MarketAccount = {
    ticker: Ticker.Meta,
    strike: new BN(620_000_000),
    tradingDay: new BN(1_000), // already in the past relative to `now`
    yesMint: PublicKey.default,
    noMint: PublicKey.default,
    vault: PublicKey.default,
    orderBook: new PublicKey(new Uint8Array(32).fill(200)),
    pairsMinted: new BN(0),
    winningRedeemed: new BN(0),
    state: "open",
    outcome: Outcome.Unsettled,
    settlementPrice: null,
    settledAt: null,
    bump: 0,
    vaultBump: 0,
    mintAuthorityBump: 0,
    ...overrides,
  };
  return { address, account };
}

function discoveryOf(
  markets: { address: PublicKey; account: MarketAccount }[]
): MarketDiscovery {
  return { listMarkets: async () => markets };
}

const NOW_SECONDS = 2_000; // > trading_day above, so markets are due

describe("runSettlementJob", () => {
  it("settles each open, due market once", async () => {
    const { logger } = captureLogger();
    const alerter = new RecordingAlerter();
    const markets = [freshMarket(), freshMarket()];
    const settled: string[] = [];
    const settler: Settler = {
      settle: async (m) => {
        settled.push(m.address.toBase58());
        return { status: SettleStatus.Settled };
      },
    };

    const summary = await runSettlementJob({
      discovery: discoveryOf(markets),
      settler,
      alerter,
      logger,
      nowSeconds: () => NOW_SECONDS,
    });

    expect(settled).to.have.length(2);
    expect(summary.settled).to.equal(2);
    expect(summary.alerted).to.equal(0);
    expect(alerter.alerts).to.have.length(0);
  });

  it("skips an already-settled market (idempotent) without calling the settler", async () => {
    const { logger } = captureLogger();
    const alerter = new RecordingAlerter();
    const already = freshMarket({ state: "settled", outcome: Outcome.YesWins });
    let settleCalls = 0;
    const settler: Settler = {
      settle: async () => {
        settleCalls++;
        return { status: SettleStatus.Settled };
      },
    };

    const summary = await runSettlementJob({
      discovery: discoveryOf([already]),
      settler,
      alerter,
      logger,
      nowSeconds: () => NOW_SECONDS,
    });

    expect(settleCalls).to.equal(0);
    expect(summary.skipped).to.equal(1);
    expect(summary.settled).to.equal(0);
  });

  it("skips a market whose trading_day has not yet passed (too early)", async () => {
    const { logger } = captureLogger();
    const alerter = new RecordingAlerter();
    const future = freshMarket({ tradingDay: new BN(NOW_SECONDS + 10_000) });
    let settleCalls = 0;
    const settler: Settler = {
      settle: async () => {
        settleCalls++;
        return { status: SettleStatus.Settled };
      },
    };

    const summary = await runSettlementJob({
      discovery: discoveryOf([future]),
      settler,
      alerter,
      logger,
      nowSeconds: () => NOW_SECONDS,
    });

    expect(settleCalls).to.equal(0);
    expect(summary.notDue).to.equal(1);
  });

  it("retries on wide confidence and succeeds within the window", async () => {
    const { logger } = captureLogger();
    const alerter = new RecordingAlerter();
    const market = freshMarket();
    const clock = virtualClock();
    let attempts = 0;
    const settler: Settler = {
      settle: async () => {
        attempts++;
        return attempts < 4
          ? { status: SettleStatus.WideConfidence }
          : { status: SettleStatus.Settled };
      },
    };

    const summary = await runSettlementJob({
      discovery: discoveryOf([market]),
      settler,
      alerter,
      logger,
      nowSeconds: () => NOW_SECONDS,
      retryIntervalMs: 30_000,
      retryMaxMs: 15 * 60_000,
      now: clock.now,
      sleep: clock.sleep,
    });

    expect(attempts).to.equal(4);
    expect(summary.settled).to.equal(1);
    expect(alerter.alerts).to.have.length(0);
  });

  it("alerts the admin for admin_settle when wide confidence persists past the window", async () => {
    const { logger } = captureLogger();
    const alerter = new RecordingAlerter();
    const market = freshMarket();
    const clock = virtualClock();
    const settler: Settler = {
      settle: async () => ({ status: SettleStatus.WideConfidence }),
    };

    const summary = await runSettlementJob({
      discovery: discoveryOf([market]),
      settler,
      alerter,
      logger,
      nowSeconds: () => NOW_SECONDS,
      retryIntervalMs: 30_000,
      retryMaxMs: 15 * 60_000,
      now: clock.now,
      sleep: clock.sleep,
    });

    expect(summary.settled).to.equal(0);
    expect(summary.alerted).to.equal(1);
    expect(alerter.alerts).to.have.length(1);
    expect(alerter.alerts[0].title).to.match(/admin_settle/i);
    expect(alerter.alerts[0].context?.market).to.equal(
      market.address.toBase58()
    );
  });

  it("alerts (not retries) on a non-wide-confidence settle error", async () => {
    const { logger } = captureLogger();
    const alerter = new RecordingAlerter();
    const market = freshMarket();
    let attempts = 0;
    const settler: Settler = {
      settle: async () => {
        attempts++;
        return {
          status: SettleStatus.Error,
          error: "StalePrice",
        };
      },
    };

    const summary = await runSettlementJob({
      discovery: discoveryOf([market]),
      settler,
      alerter,
      logger,
      nowSeconds: () => NOW_SECONDS,
    });

    // A stale-price error is not the wide-confidence retry path; it alerts and moves on.
    expect(attempts).to.equal(1);
    expect(summary.alerted).to.equal(1);
    expect(alerter.alerts[0].context?.error).to.equal("StalePrice");
  });

  it("continues to later markets after one fails", async () => {
    const { logger } = captureLogger();
    const alerter = new RecordingAlerter();
    const bad = freshMarket();
    const good = freshMarket();
    const settler: Settler = {
      settle: async (m) =>
        m.address.equals(bad.address)
          ? { status: SettleStatus.Error, error: "boom" }
          : { status: SettleStatus.Settled },
    };

    const summary = await runSettlementJob({
      discovery: discoveryOf([bad, good]),
      settler,
      alerter,
      logger,
      nowSeconds: () => NOW_SECONDS,
    });

    expect(summary.settled).to.equal(1);
    expect(summary.alerted).to.equal(1);
  });
});
