/**
 * Morning-job orchestration tests (chain boundary mocked).
 *
 * The job, for each supported ticker on a trading day:
 *   prev close → computeStrikes → for each strike: create_strike_market, then the
 *   two-step order-book provisioning (init_order_book, grow_order_book).
 * It logs per-strike outcomes, alerts on failures (after retries), and is a no-op on a
 * non-session date. These tests assert the orchestration against a recording chain stub —
 * the SDK builders and real program are exercised in the LiteSVM integration test.
 */

import { expect } from "chai";
import BN from "bn.js";
import { Ticker, PAYOFF_UNIT } from "@meridian/sdk";
import { runMorningJob } from "../src/morningJob";
import { MockPriceSource } from "../src/priceSource";
import { createLogger, LogLevel, type LogLine } from "../src/logger";
import type { Alerter, AlertPayload } from "../src/alerter";
import type { ProvisionResult } from "../src/morningJob";
import type { MarketProvisioner } from "../src/markets";
import type { MarketId } from "@meridian/sdk";

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

/** A provisioner that records each market it was asked to create. */
class RecordingProvisioner implements MarketProvisioner {
  readonly created: MarketId[] = [];
  failOn?: (id: MarketId) => boolean;
  async provisionMarket(id: MarketId): Promise<ProvisionResult> {
    if (this.failOn?.(id)) {
      throw new Error(`provision failed for strike ${id.strike.toString()}`);
    }
    this.created.push(id);
    return { market: id, created: true };
  }
}

const usd = (n: number) => new BN(n).mul(PAYOFF_UNIT);
const TRADING_DAY = 1_900_000_000; // arbitrary fixed close instant

describe("runMorningJob", () => {
  it("creates one market per computed strike for each ticker", async () => {
    const { logger } = captureLogger();
    const alerter = new RecordingAlerter();
    const provisioner = new RecordingProvisioner();
    const priceSource = new MockPriceSource({ [Ticker.Meta]: usd(680) });

    const summary = await runMorningJob({
      tickers: [Ticker.Meta],
      priceSource,
      provisioner,
      alerter,
      logger,
      tradingDay: TRADING_DAY,
      retries: 0,
    });

    // META $680 → 7 strikes (620,640,660,680,700,720,740) — the close (680) is always included.
    expect(provisioner.created).to.have.length(7);
    expect(summary.created).to.equal(7);
    expect(summary.failed).to.equal(0);
    // every created market carries the same trading_day (the close instant) and ticker.
    for (const m of provisioner.created) {
      expect(m.ticker).to.equal(Ticker.Meta);
      expect(new BN(m.tradingDay).eq(new BN(TRADING_DAY))).to.be.true;
    }
    expect(alerter.alerts).to.have.length(0);
  });

  it("alerts (and counts) a strike that fails to provision, but continues the rest", async () => {
    const { logger } = captureLogger();
    const alerter = new RecordingAlerter();
    const provisioner = new RecordingProvisioner();
    // Fail exactly the $700 strike.
    provisioner.failOn = (id) => new BN(id.strike).eq(usd(700));
    const priceSource = new MockPriceSource({ [Ticker.Meta]: usd(680) });

    const summary = await runMorningJob({
      tickers: [Ticker.Meta],
      priceSource,
      provisioner,
      alerter,
      logger,
      tradingDay: TRADING_DAY,
      retries: 0,
    });

    // 7 strikes total (incl. the 680 close); the $700 strike fails → 6 created, 1 failed.
    expect(summary.created).to.equal(6);
    expect(summary.failed).to.equal(1);
    expect(alerter.alerts).to.have.length(1);
    expect(alerter.alerts[0].severity).to.equal("critical");
    expect(alerter.alerts[0].context?.strike).to.equal(usd(700).toString());
  });

  it("alerts when a ticker's price cannot be read, and does not abort other tickers", async () => {
    const { logger } = captureLogger();
    const alerter = new RecordingAlerter();
    const provisioner = new RecordingProvisioner();
    // Meta has a price; Aapl does not → its price read throws.
    const priceSource = new MockPriceSource({ [Ticker.Meta]: usd(680) });

    const summary = await runMorningJob({
      tickers: [Ticker.Aapl, Ticker.Meta],
      priceSource,
      provisioner,
      alerter,
      logger,
      tradingDay: TRADING_DAY,
      retries: 0,
    });

    // Aapl alerted (no price); Meta still produced its 7 strikes.
    expect(provisioner.created).to.have.length(7);
    expect(summary.created).to.equal(7);
    expect(alerter.alerts.some((a) => a.context?.ticker === "AAPL")).to.be.true;
  });

  it("is a no-op (and logs) when the date is not a trading session", async () => {
    const { logger, lines } = captureLogger();
    const alerter = new RecordingAlerter();
    const provisioner = new RecordingProvisioner();
    const priceSource = new MockPriceSource({ [Ticker.Meta]: usd(680) });

    // A Saturday — runForDate decides there is no session, so nothing is provisioned.
    const summary = await runMorningJob({
      tickers: [Ticker.Meta],
      priceSource,
      provisioner,
      alerter,
      logger,
      date: new Date("2026-05-23T12:00:00Z"),
      retries: 0,
    });

    expect(summary.skipped).to.be.true;
    expect(provisioner.created).to.have.length(0);
    expect(
      lines.some(
        (l) => l.level === LogLevel.Info && /no session|skip/i.test(l.msg)
      )
    ).to.be.true;
  });

  it("derives trading_day from the date's close instant when no explicit value is given", async () => {
    const { logger } = captureLogger();
    const alerter = new RecordingAlerter();
    const provisioner = new RecordingProvisioner();
    const priceSource = new MockPriceSource({ [Ticker.Meta]: usd(680) });

    await runMorningJob({
      tickers: [Ticker.Meta],
      priceSource,
      provisioner,
      alerter,
      logger,
      date: new Date("2026-07-01T12:00:00Z"), // a normal summer session
      retries: 0,
    });

    // 4 PM EDT on 2026-07-01 = 20:00 UTC = 1782763200.
    const expected = Math.floor(Date.UTC(2026, 6, 1, 20, 0, 0) / 1000);
    for (const m of provisioner.created) {
      expect(new BN(m.tradingDay).eq(new BN(expected))).to.be.true;
    }
  });
});
