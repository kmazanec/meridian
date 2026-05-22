/**
 * Create the day's markets on the deployed + bootstrapped program.
 *
 * For each selected ticker, compute the strikes from a previous close (the same
 * `computeStrikes` the automation morning job uses — ±3/6/9% rounded to $10, deduped) and
 * provision each strike with the SDK's three-step creation (`create_strike_market` →
 * `init_order_book` → `grow_order_book`, the order-book realloc cap requires the split).
 * The provisioning reuses the convergence `Fixture.createMarket`, so it matches the proven
 * lifecycle path exactly and is idempotent — a strike that already exists is skipped.
 *
 * The previous close per ticker comes from `MOCK_CLOSE_<SYMBOL>` (env); a ticker without one
 * is skipped with a clear log line (there is nothing to derive strikes from). This is the
 * deterministic, offline-friendly source appropriate for a reproducible demo; the live
 * morning job (pulling real prices) is a separate path owned by the automation service.
 */

import BN from "bn.js";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { computeStrikes } from "@meridian/automation";
import {
  Ticker,
  TickerSymbol,
  tickerToSymbol,
  marketPda,
  fetchMarket,
  getProgram,
} from "@meridian/sdk";
import { Fixture } from "@meridian/e2e";
import type { ConsoleLog } from "./log";

export interface CreateMarketsOptions {
  rpcUrl: string;
  deployer: Keypair;
  usdcMint: PublicKey;
  tickers: Ticker[];
  /** Per-ticker previous close in USDC base units (drives the strike computation). */
  mockCloses: Partial<Record<TickerSymbol, BN>>;
  includeClose: boolean;
  /**
   * The trading-day timestamp (unix seconds) the markets settle for. The program gates
   * mint/trade on `state == Open`, not the clock, so any value is tradable; the lifecycle
   * uses a past value when it wants `admin_settle` callable immediately.
   */
  tradingDay: number;
  log?: ConsoleLog;
}

export interface CreatedMarket {
  ticker: Ticker;
  symbol: TickerSymbol;
  strike: BN;
  address: PublicKey;
  created: boolean;
}

/**
 * Provision the day's markets. Returns one entry per (ticker, strike), flagging whether it
 * was newly created or already existed. Idempotent.
 */
export async function createMarkets(
  opts: CreateMarketsOptions
): Promise<CreatedMarket[]> {
  const connection = new Connection(opts.rpcUrl, "confirmed");
  const program = getProgram({
    connection,
    publicKey: opts.deployer.publicKey,
  } as never);
  const fixture = Fixture.attach(connection, opts.deployer, opts.usdcMint);

  const results: CreatedMarket[] = [];
  for (const ticker of opts.tickers) {
    const symbol = tickerToSymbol(ticker);
    const prevClose = opts.mockCloses[symbol];
    if (!prevClose) {
      opts.log?.warn(
        `No MOCK_CLOSE_${symbol} set — skipping ${symbol} (no close to derive strikes from).`
      );
      continue;
    }
    const strikes = computeStrikes(prevClose, {
      includeClose: opts.includeClose,
    });
    opts.log?.step(
      `${symbol}: ${strikes.length} strike(s) from close ${baseUnitsToDollars(
        prevClose
      )}`
    );
    for (const strike of strikes) {
      const address = marketPda(ticker, strike, new BN(opts.tradingDay));
      const exists = (await fetchMarket(program, address)) !== null;
      if (exists) {
        opts.log?.detail(
          `  ${symbol} $${baseUnitsToDollars(strike)}`,
          `exists ${address.toBase58()}`
        );
        results.push({ ticker, symbol, strike, address, created: false });
        continue;
      }
      await fixture.createMarket({
        ticker,
        strike,
        tradingDay: opts.tradingDay,
      });
      opts.log?.detail(
        `  ${symbol} $${baseUnitsToDollars(strike)}`,
        `created ${address.toBase58()}`
      );
      results.push({ ticker, symbol, strike, address, created: true });
    }
  }
  return results;
}

/** Format USDC base units (6 dp) as a dollar string for logging. */
function baseUnitsToDollars(baseUnits: BN): string {
  const unit = new BN(1_000_000);
  const dollars = baseUnits.div(unit).toString();
  const cents = baseUnits.mod(unit).toString().padStart(6, "0").slice(0, 2);
  return cents === "00" ? `${dollars}` : `${dollars}.${cents}`;
}

export { baseUnitsToDollars };
