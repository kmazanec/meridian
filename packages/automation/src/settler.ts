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

// Anchor offsets custom error codes by 6000; these are the deployed program's ordinals
// (see programs/meridian/src/error.rs — counted from AlreadyInitialized = 6000). Matching
// the *code* in addition to the name/msg makes classification robust to an RPC that returns
// only a numeric `custom program error` without the program logs (some providers do), where
// a name/msg-only match would misclassify a retryable WideConfidence as a hard error and
// alert the admin prematurely.
const WIDE_CONFIDENCE_CODE = 6000 + 17; // WideConfidence
const MARKET_SETTLED_CODE = 6000 + 3; // MarketSettled

/**
 * Code markers, written in the *specific* forms Anchor/web3.js actually emit so a bare digit
 * run elsewhere in the message (a slot, a timestamp) can't false-match: the hex
 * `custom program error: 0x…` form and the `Error Number: …` (decimal) form.
 */
function codeMarkers(code: number): string[] {
  return [`0x${code.toString(16)}`, `Error Number: ${code}`];
}

/**
 * Markers that map a thrown settle error to the on-chain `WideConfidence` rejection (the
 * only retryable settlement error): the Anchor error *name*, its `#[msg]` text, and the
 * numeric error code (hex + `Error Number:`) as a fallback for logs-less RPC errors.
 */
const WIDE_CONFIDENCE_MARKERS = [
  "WideConfidence",
  "confidence band is too wide",
  ...codeMarkers(WIDE_CONFIDENCE_CODE),
];

/**
 * Markers indicating the market is already settled — an idempotent success. `settle_market`
 * itself is a no-op on a settled market (so it won't error), but a concurrent cranker can
 * win the race and surface `MarketSettled`; treat that (by name, msg, or code) as done.
 */
const ALREADY_SETTLED_MARKERS = [
  "MarketSettled",
  "Market is already settled",
  ...codeMarkers(MARKET_SETTLED_CODE),
];

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
