/**
 * Previous-close price source for the morning job (pluggable).
 *
 * The morning job needs each ticker's previous close in USDC base units (6 dp) to compute
 * strikes. The source is an interface with two implementations:
 *   - {@link MockPriceSource} — a deterministic configured map, for tests and a demo that
 *     must run without US market hours;
 *   - {@link PythPriceSource} — fetches a signed price from Pyth's Hermes service via the
 *     SDK's `fetchPriceUpdate` helper and converts the native-scale price to base units.
 *
 * Keeping this behind an interface means a real end-of-day equities API can drop in later
 * without touching the job logic. (A live Pyth equity feed only carries data during market
 * hours; the chosen impl is an operational decision made via config.)
 */

import BN from "bn.js";
import { Ticker } from "@meridian/sdk";

/** Reads a ticker's previous close, in USDC base units (6 dp). */
export interface PriceSource {
  previousClose(ticker: Ticker): Promise<BN>;
}

/**
 * Convert a Pyth native-scale price (`price × 10^exponent`) to USDC base units (6 dp),
 * using the same truncating integer math as the on-chain `oracle.rs::to_usdc_base_units`
 * so an off-chain strike lines up with what settlement would compute. Rejects a negative
 * price (a malformed feed).
 */
export function nativeToUsdcBaseUnits(price: bigint, exponent: number): BN {
  if (price < BigInt(0)) {
    throw new Error(`price must be non-negative (got ${price})`);
  }
  const USDC_DECIMALS = 6;
  const shift = exponent + USDC_DECIMALS;
  const p = new BN(price.toString());
  if (shift >= 0) {
    return p.mul(new BN(10).pow(new BN(shift)));
  }
  return p.div(new BN(10).pow(new BN(-shift)));
}

/** A deterministic price source backed by a configured `ticker → base units` map. */
export class MockPriceSource implements PriceSource {
  private readonly prices: Partial<Record<Ticker, BN>>;

  constructor(prices: Partial<Record<Ticker, BN>>) {
    this.prices = prices;
  }

  async previousClose(ticker: Ticker): Promise<BN> {
    const p = this.prices[ticker];
    if (!p) {
      throw new Error(`MockPriceSource has no price configured for ticker ${ticker}`);
    }
    return p;
  }
}

/** The shape the Pyth fetcher returns (mirrors the SDK's `HermesPriceUpdate`). */
export interface FetchedPrice {
  price: bigint;
  exponent: number;
  publishTime: number;
}

/** Fetches a signed price for a feed id (defaults to the SDK's Hermes helper). */
export type PriceFetcher = (feedId: string) => Promise<FetchedPrice>;

export interface PythPriceSourceOptions {
  /** Per-ticker Pyth feed ids (hex). Must match `Config.tickers[].feed_id`. */
  feedIds: Partial<Record<Ticker, string>>;
  /** Hermes endpoint (passed to the default fetcher). */
  hermesUrl?: string;
  /** Injectable fetcher (defaults to the SDK's lazy Hermes helper). */
  fetcher?: PriceFetcher;
}

/**
 * Pyth/Hermes-backed previous-close source. Uses the SDK's `fetchPriceUpdate` (lazy Pyth
 * peer dep) by default; an injected fetcher is used in tests. The fetched native-scale
 * price is converted to USDC base units.
 */
export class PythPriceSource implements PriceSource {
  private readonly feedIds: Partial<Record<Ticker, string>>;
  private readonly hermesUrl?: string;
  private readonly fetcher: PriceFetcher;

  constructor(opts: PythPriceSourceOptions) {
    this.feedIds = opts.feedIds;
    this.hermesUrl = opts.hermesUrl;
    this.fetcher = opts.fetcher ?? this.defaultFetcher.bind(this);
  }

  private async defaultFetcher(feedId: string): Promise<FetchedPrice> {
    // Lazy import: the Pyth Hermes client is an optional peer dep, only pulled when a
    // live Pyth source is actually used (a mock-source demo never loads it).
    const { fetchPriceUpdate } = await import("@meridian/sdk");
    const update = this.hermesUrl
      ? await fetchPriceUpdate(feedId, this.hermesUrl)
      : await fetchPriceUpdate(feedId);
    return {
      price: update.price,
      exponent: update.exponent,
      publishTime: update.publishTime,
    };
  }

  async previousClose(ticker: Ticker): Promise<BN> {
    const feedId = this.feedIds[ticker];
    if (!feedId) {
      throw new Error(
        `PythPriceSource has no feed id configured for ticker ${ticker}`
      );
    }
    const fetched = await this.fetcher(feedId);
    return nativeToUsdcBaseUnits(fetched.price, fetched.exponent);
  }
}
