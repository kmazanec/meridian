/**
 * The settlement job: settle the day's open contracts after the close.
 *
 * Flow (ARCHITECTURE §9, ADR-005):
 *   - discover open markets whose `trading_day` (4:00 PM ET close instant) has passed,
 *   - settle each via the pull oracle (post a Hermes update → `settle_market`),
 *   - **idempotent:** an already-settled market is skipped; even a redundant `settle_market`
 *     is a safe on-chain no-op, so retries are harmless,
 *   - on a **wide-confidence** rejection (the price band straddles certainty), retry every
 *     30s for up to 15 min, then **alert the admin** to run `admin_settle` (the trusted,
 *     time-delayed override),
 *   - **trust-minimized:** the job only ever calls the permissionless `settle_market`; it
 *     never assumes admin power. The admin override is a human-in-the-loop alert, not an
 *     automatic privileged call.
 */

import type { MarketAccount } from "@meridian/sdk";
import { PublicKey } from "@solana/web3.js";
import type { MarketDiscovery } from "./markets";
import type { Alerter } from "./alerter";
import type { Logger } from "./logger";
import { retryEvery, RetryGaveUp } from "./retry";

/** Outcome of a single settle attempt against the chain. */
export enum SettleStatus {
  /** The market is now settled (or was already). */
  Settled = "settled",
  /** Rejected for wide oracle confidence — retryable within the window. */
  WideConfidence = "wide_confidence",
  /** Any other failure (stale price, wrong feed, RPC error) — not the retry path. */
  Error = "error",
}

export interface SettleResult {
  status: SettleStatus;
  /** Error detail when `status === Error` (or a wide-confidence diagnostic). */
  error?: string;
}

/** Settles one market via the pull oracle. Implemented by the SDK-backed settler. */
export interface Settler {
  settle(market: {
    address: PublicKey;
    account: MarketAccount;
  }): Promise<SettleResult>;
}

export interface SettlementJobOptions {
  discovery: MarketDiscovery;
  settler: Settler;
  alerter: Alerter;
  logger: Logger;
  /** On-chain "now" in unix seconds — gates which markets are due (>= trading_day). */
  nowSeconds: () => number;
  /** Wide-confidence retry interval (ms). Default 30_000. */
  retryIntervalMs?: number;
  /** Wide-confidence total budget (ms). Default 15 min. */
  retryMaxMs?: number;
  /** Injectable clock for the retry loop (ms). Default Date.now. */
  now?: () => number;
  /** Injectable sleep for the retry loop. Default real setTimeout. */
  sleep?: (ms: number) => Promise<void>;
}

export interface SettlementJobSummary {
  /** Markets newly settled this run. */
  settled: number;
  /** Already-settled markets skipped. */
  skipped: number;
  /** Open markets not yet due (trading_day in the future). */
  notDue: number;
  /** Markets that triggered an operator alert (gave-up wide confidence, or hard error). */
  alerted: number;
}

/** Run the settlement job over all discovered markets. Never rejects on one market's failure. */
export async function runSettlementJob(
  opts: SettlementJobOptions
): Promise<SettlementJobSummary> {
  const retryIntervalMs = opts.retryIntervalMs ?? 30_000;
  const retryMaxMs = opts.retryMaxMs ?? 15 * 60_000;

  const markets = await opts.discovery.listMarkets();
  opts.logger.info("settlement job starting", { markets: markets.length });

  const summary: SettlementJobSummary = {
    settled: 0,
    skipped: 0,
    notDue: 0,
    alerted: 0,
  };

  for (const m of markets) {
    const id = m.address.toBase58();

    // Idempotent: never re-settle a settled market.
    if (m.account.state === "settled") {
      summary.skipped++;
      continue;
    }

    // Timing: only attempt markets whose close instant has passed (the program would
    // reject earlier ones with TooEarlyToSettle anyway; skip the wasted round-trip).
    if (opts.nowSeconds() < m.account.tradingDay.toNumber()) {
      summary.notDue++;
      continue;
    }

    await settleOne(m, opts, retryIntervalMs, retryMaxMs, summary);
  }

  opts.logger.info("settlement job complete", { ...summary });
  return summary;
}

async function settleOne(
  m: { address: PublicKey; account: MarketAccount },
  opts: SettlementJobOptions,
  retryIntervalMs: number,
  retryMaxMs: number,
  summary: SettlementJobSummary
): Promise<void> {
  const id = m.address.toBase58();

  // First attempt.
  let result: SettleResult;
  try {
    result = await opts.settler.settle(m);
  } catch (err) {
    result = { status: SettleStatus.Error, error: errMessage(err) };
  }

  if (result.status === SettleStatus.Settled) {
    summary.settled++;
    opts.logger.info("market settled", { market: id });
    return;
  }

  if (result.status === SettleStatus.Error) {
    summary.alerted++;
    await opts.alerter.alert({
      severity: "critical",
      title: `settlement failed for ${id}`,
      detail: result.error ?? "unknown error",
      context: { market: id, error: result.error },
    });
    return;
  }

  // Wide confidence: retry every interval within the budget; succeed → settled, else alert.
  opts.logger.warn("wide oracle confidence; entering retry window", {
    market: id,
    intervalMs: retryIntervalMs,
    maxMs: retryMaxMs,
  });
  try {
    await retryEvery(
      async () => {
        const r = await opts.settler.settle(m);
        if (r.status === SettleStatus.Settled) return true;
        if (r.status === SettleStatus.WideConfidence) return false;
        // A different error mid-retry (e.g. stale): stop the loop by throwing.
        throw new Error(r.error ?? "settle error during retry");
      },
      {
        intervalMs: retryIntervalMs,
        maxDurationMs: retryMaxMs,
        now: opts.now,
        sleep: opts.sleep,
        retryOnError: false,
      }
    );
    summary.settled++;
    opts.logger.info("market settled after retry", { market: id });
  } catch (err) {
    summary.alerted++;
    const gaveUp = err instanceof RetryGaveUp;
    await opts.alerter.alert({
      severity: "critical",
      title: gaveUp
        ? `settlement: wide confidence persisted — run admin_settle for ${id}`
        : `settlement failed during retry for ${id}`,
      detail: gaveUp
        ? `Oracle confidence stayed wide for ${Math.round(
            retryMaxMs / 60_000
          )} minutes. ` +
          `Settle manually via admin_settle after the override delay.`
        : errMessage(err),
      context: {
        market: id,
        error: gaveUp ? "WideConfidence" : errMessage(err),
      },
    });
  }
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
