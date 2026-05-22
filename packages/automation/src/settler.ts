/**
 * SDK-backed settler: the pull-oracle settlement path.
 *
 * Given an open market, fetch its ticker's signed price from Hermes, post it on-chain via
 * the Pyth Solana Receiver, and crank the permissionless `settle_market`. The on-chain
 * program enforces freshness, full guardian verification, the feed match, and the
 * confidence band; this settler classifies the resulting error so the job can take the
 * right action — a *wide-confidence* rejection is the retryable path, everything else is a
 * hard failure that alerts.
 *
 * It uses the SDK's `settleWithPyth` (which lazily pulls the optional Pyth peer deps), so
 * a deployment that never settles never loads them. The settler holds no privilege beyond
 * the permissionless settle instruction.
 */

import type { MarketAccount, Ticker } from "@meridian/sdk";
import { PublicKey } from "@solana/web3.js";
import type { ChainClient } from "./chain";
import { SettleStatus, type SettleResult, type Settler } from "./settlementJob";

/** A function that runs the SDK pull-oracle settle for a market+feed (injectable for tests). */
export type SettleWithPythFn = (
  feedIdHex: string,
  market: PublicKey
) => Promise<void>;

export interface PythSettlerOptions {
  chain: ChainClient;
  /** Per-ticker Pyth feed ids (hex), matching `Config.tickers[].feed_id`. */
  feedIds: Partial<Record<Ticker, string>>;
  hermesUrl?: string;
  /** Injectable settle fn (defaults to the SDK's `settleWithPyth`). */
  settleFn?: SettleWithPythFn;
}

/**
 * Patterns in a thrown settle error that map to the on-chain `WideConfidence` rejection
 * (the only retryable settlement error). Matched on the Anchor error *name* and its
 * human-readable `#[msg]` ("Oracle confidence band is too wide"), both of which surface in
 * the thrown error / transaction logs — not the numeric code (which is offset by Anchor's
 * 6000 base and is brittle to reorderings).
 */
const WIDE_CONFIDENCE_MARKERS = [
  "WideConfidence",
  "confidence band is too wide",
];

/**
 * Patterns indicating the market is already settled — an idempotent success. `settle_market`
 * itself is a no-op on a settled market (so it won't error), but a concurrent cranker can
 * win the race and surface `MarketSettled` ("Market is already settled"); treat that as done.
 */
const ALREADY_SETTLED_MARKERS = ["MarketSettled", "Market is already settled"];

export class PythSettler implements Settler {
  private readonly chain: ChainClient;
  private readonly feedIds: Partial<Record<Ticker, string>>;
  private readonly hermesUrl?: string;
  private readonly settleFn: SettleWithPythFn;

  constructor(opts: PythSettlerOptions) {
    this.chain = opts.chain;
    this.feedIds = opts.feedIds;
    this.hermesUrl = opts.hermesUrl;
    this.settleFn = opts.settleFn ?? this.defaultSettleFn.bind(this);
  }

  private async defaultSettleFn(
    feedIdHex: string,
    market: PublicKey
  ): Promise<void> {
    const { settleWithPyth } = await import("@meridian/sdk");
    await settleWithPyth(
      this.chain.program,
      this.chain.connection,
      this.chain.keypair,
      market,
      feedIdHex,
      this.hermesUrl
    );
  }

  async settle(m: {
    address: PublicKey;
    account: MarketAccount;
  }): Promise<SettleResult> {
    const feedId = this.feedIds[m.account.ticker];
    if (!feedId) {
      return {
        status: SettleStatus.Error,
        error: `no feed id configured for ticker ${m.account.ticker}`,
      };
    }

    try {
      await this.settleFn(feedId, m.address);
      return { status: SettleStatus.Settled };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (ALREADY_SETTLED_MARKERS.some((marker) => msg.includes(marker))) {
        // Idempotent: a redundant settle on a settled market is success.
        return { status: SettleStatus.Settled };
      }
      if (WIDE_CONFIDENCE_MARKERS.some((marker) => msg.includes(marker))) {
        return { status: SettleStatus.WideConfidence, error: msg };
      }
      return { status: SettleStatus.Error, error: msg };
    }
  }
}
