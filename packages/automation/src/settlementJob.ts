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
import { retryEvery, RetryGaveUp, mapWithConcurrency } from "./retry";

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
  /**
   * Max settles in flight at once, bounding the RPC fan-out against the shared endpoint.
   * Default 5. Must be > 1 so a market stuck in its retry window can't block a ready one.
   */
  maxConcurrency?: number;
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

type Market = { address: PublicKey; account: MarketAccount };

/**
 * Run the settlement job over all discovered markets. Never rejects on one market's failure.
 *
 * Markets are settled **concurrently**, in two phases, so one market stuck in its
 * wide-confidence retry window never delays another market that is ready to settle now
 * (settlement is time-sensitive — users redeem only after a market settles):
 *   1. attempt every due, open market once;
 *   2. for those that came back wide-confidence, run their 30s/15min retry loops; a market
 *      that settles in this phase succeeds, one whose band stays wide for the whole window
 *      alerts the admin to run `admin_settle`.
 *
 * Phase 1 runs through a bounded pool (`maxConcurrency`, default 5) rather than an
 * unbounded `Promise.all`: a single close instant makes dozens of markets due at once, and
 * settling them all simultaneously from one fee-payer floods the shared, rate-limited RPC
 * endpoint. Phase 2's retry loops stay unbounded — each is mostly idle between 30s polls,
 * and bounding them would let a stuck market hold a slot for its whole window, defeating
 * the anti-blocking split.
 */
export async function runSettlementJob(
  opts: SettlementJobOptions
): Promise<SettlementJobSummary> {
  const retryIntervalMs = opts.retryIntervalMs ?? 30_000;
  const retryMaxMs = opts.retryMaxMs ?? 15 * 60_000;
  const maxConcurrency = opts.maxConcurrency ?? 5;

  const markets = await opts.discovery.listMarkets();
  opts.logger.info("settlement job starting", { markets: markets.length });

  const summary: SettlementJobSummary = {
    settled: 0,
    skipped: 0,
    notDue: 0,
    alerted: 0,
  };

  // Partition: settled (skip), not-yet-due (skip), and the due+open set to attempt.
  const due: Market[] = [];
  for (const m of markets) {
    if (m.account.state === "settled") {
      summary.skipped++;
    } else if (opts.nowSeconds() < m.account.tradingDay.toNumber()) {
      // Timing: the program would reject with TooEarlyToSettle anyway; skip the round-trip.
      summary.notDue++;
    } else {
      due.push(m);
    }
  }

  // Phase 1: one settle attempt per due market, through the bounded pool.
  const firstResults = await mapWithConcurrency(
    due,
    maxConcurrency,
    async (m) => ({
      m,
      result: await firstAttempt(m, opts),
    })
  );

  const needRetry: Market[] = [];
  for (const { m, result } of firstResults) {
    const id = m.address.toBase58();
    if (result.status === SettleStatus.Settled) {
      summary.settled++;
      opts.logger.info("market settled", { market: id });
    } else if (result.status === SettleStatus.WideConfidence) {
      opts.logger.warn("wide oracle confidence; entering retry window", {
        market: id,
        intervalMs: retryIntervalMs,
        maxMs: retryMaxMs,
      });
      needRetry.push(m);
    } else {
      summary.alerted++;
      await alertHardError(m, result.error, opts);
    }
  }

  // Phase 2: wide-confidence retry loops, all in parallel (no market blocks another).
  // These are NOT pool-bounded: a retry loop is mostly idle (sleeping 30s between
  // attempts), and bounding them would let a stuck market hold a pool slot for the full
  // 15-min window — exactly the blocking the two-phase split exists to avoid. Wide
  // confidence is rare, so this set is small in practice; and even if a broad oracle
  // outage makes many markets retry at once, each attempt goes through the settler's 429
  // backoff, so the per-tick burst self-throttles under rate pressure rather than
  // hammering the endpoint.
  const retryResults = await Promise.all(
    needRetry.map(async (m) => ({
      m,
      settled: await retryWideConfidence(m, opts, retryIntervalMs, retryMaxMs),
    }))
  );
  for (const { m, settled } of retryResults) {
    if (settled) {
      summary.settled++;
      opts.logger.info("market settled after retry", {
        market: m.address.toBase58(),
      });
    } else {
      summary.alerted++;
    }
  }

  opts.logger.info("settlement job complete", { ...summary });
  return summary;
}

/** One settle attempt, normalizing a thrown error into a `SettleResult`. */
async function firstAttempt(
  m: Market,
  opts: SettlementJobOptions
): Promise<SettleResult> {
  try {
    return await opts.settler.settle(m);
  } catch (err) {
    return { status: SettleStatus.Error, error: errMessage(err) };
  }
}

/**
 * Run the wide-confidence retry loop for one market. Resolves `true` if it settled, `false`
 * if it gave up (and alerts the admin for `admin_settle`) or hit a hard error mid-retry
 * (and alerts). Never rejects. The loop starts with a sleep (the immediate attempt already
 * happened in phase 1), so it does not double-crank the market.
 */
async function retryWideConfidence(
  m: Market,
  opts: SettlementJobOptions,
  retryIntervalMs: number,
  retryMaxMs: number
): Promise<boolean> {
  const id = m.address.toBase58();
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
        sleepFirst: true,
      }
    );
    return true;
  } catch (err) {
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
    return false;
  }
}

/** Alert a hard (non-retryable) settlement failure. */
async function alertHardError(
  m: Market,
  error: string | undefined,
  opts: SettlementJobOptions
): Promise<void> {
  const id = m.address.toBase58();
  await opts.alerter.alert({
    severity: "critical",
    title: `settlement failed for ${id}`,
    detail: error ?? "unknown error",
    context: { market: id, error },
  });
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
