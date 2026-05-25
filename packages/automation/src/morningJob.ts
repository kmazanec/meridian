/**
 * The morning job: create the day's markets.
 *
 * For each supported ticker on a trading day, read the previous close, compute the
 * strikes, and provision one market per strike (create + order-book). Each strike's
 * outcome is logged; a strike (or a ticker's price read) that fails after retries is
 * alerted but does not abort the rest of the run. On a non-session date the job is a
 * logged no-op.
 *
 * `Market.trading_day` is the session's 4:00 PM ET close instant (the F-04 timing
 * sub-contract): either supplied explicitly or derived from the run date via the
 * calendar. The program later gates settlement on `now >= trading_day`.
 */

import {
  Ticker,
  tickerToSymbol,
  closeInstant,
  isTradingDay,
  type MarketId,
} from "@meridian/sdk";
import BN from "bn.js";
import { computeStrikes } from "./strikes";
import type { PriceSource } from "./priceSource";
import type { MarketProvisioner, ProvisionResult } from "./markets";
import type { Alerter } from "./alerter";
import type { Logger } from "./logger";
import { withBackoff } from "./retry";

export type { ProvisionResult } from "./markets";

export interface MorningJobOptions {
  /** Tickers to create markets for. */
  tickers: Ticker[];
  priceSource: PriceSource;
  provisioner: MarketProvisioner;
  alerter: Alerter;
  logger: Logger;
  /**
   * The close instant (unix seconds) to stamp as `trading_day`. If omitted, it is derived
   * from `date` via the calendar (the 4:00 PM ET close, 1:00 PM on half-days).
   */
  tradingDay?: number;
  /** The session date; defaults to now. Used to derive `tradingDay` and the no-session skip. */
  date?: Date;
  /** Include the rounded close as an at-the-money strike. Default false. */
  includeClose?: boolean;
  /** Retries per provisioning attempt (exponential backoff). Default 3. */
  retries?: number;
  /** Base backoff delay (ms). Default 1000. */
  baseDelayMs?: number;
}

export interface MorningJobSummary {
  /** True if the run was skipped because the date was not a trading session. */
  skipped: boolean;
  /** Markets successfully provisioned. */
  created: number;
  /** Strikes that failed to provision (after retries). */
  failed: number;
}

/** Run the morning job. Resolves with a summary; never rejects on a single-strike failure. */
export async function runMorningJob(
  opts: MorningJobOptions
): Promise<MorningJobSummary> {
  const date = opts.date ?? new Date();
  const retries = opts.retries ?? 3;
  const baseDelayMs = opts.baseDelayMs ?? 1000;

  // No-session guard: when an explicit tradingDay is given we trust the caller (a CLI may
  // force a run); otherwise the calendar decides.
  if (opts.tradingDay === undefined && !isTradingDay(date)) {
    opts.logger.info("no session today; morning job is a no-op", {
      date: date.toISOString(),
    });
    return { skipped: true, created: 0, failed: 0 };
  }

  const tradingDay = opts.tradingDay ?? closeInstant(date);
  opts.logger.info("morning job starting", {
    tradingDay,
    tickers: opts.tickers.map(tickerToSymbol),
  });

  let created = 0;
  let failed = 0;

  for (const ticker of opts.tickers) {
    const symbol = tickerToSymbol(ticker);
    let prevClose: BN;
    try {
      prevClose = await opts.priceSource.previousClose(ticker);
    } catch (err) {
      failed++;
      await opts.alerter.alert({
        severity: "critical",
        title: `morning job: no previous close for ${symbol}`,
        detail: errMessage(err),
        context: { ticker: symbol },
      });
      continue;
    }

    const strikes = computeStrikes(prevClose, {
      includeClose: opts.includeClose ?? false,
    });
    opts.logger.info("computed strikes", {
      ticker: symbol,
      prevClose: prevClose.toString(),
      strikes: strikes.map((s) => s.toString()),
    });

    for (const strike of strikes) {
      const market: MarketId = {
        ticker,
        strike,
        tradingDay: new BN(tradingDay),
      };
      try {
        const result: ProvisionResult = await withBackoff(
          () => opts.provisioner.provisionMarket(market),
          { retries, baseDelayMs }
        );
        created++;
        opts.logger.info("market provisioned", {
          ticker: symbol,
          strike: strike.toString(),
          created: result.created,
        });
      } catch (err) {
        failed++;
        await opts.alerter.alert({
          severity: "critical",
          title: `morning job: failed to create ${symbol} strike`,
          detail: errMessage(err),
          context: { ticker: symbol, strike: strike.toString() },
        });
      }
    }
  }

  opts.logger.info("morning job complete", { created, failed });
  return { skipped: false, created, failed };
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
