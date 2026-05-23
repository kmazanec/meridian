/**
 * Close (settle) the day's markets after the (compressed) trading day ends — the demo/dev
 * equivalent of the production settlement cron.
 *
 * Production settles via the permissionless `settle_market` + a real Pyth price posted through
 * the Pyth Receiver. That path can't run here: the Receiver isn't on localnet, and even on
 * devnet it only emits *real* Hermes prices — not the synthetic feed the bots traded against.
 * So the demo closes via `admin_settle` (the admin override, the one instruction that accepts an
 * arbitrary settlement price), feeding it the **synthetic close** from `/api/price` at
 * progress=1 — the same curve endpoint the bots saw, so the market resolves coherently with how
 * they traded. Outcome is the program's rule: settlementPrice ≥ strike → Yes wins.
 *
 * `admin_settle` is time-gated on-chain (`trading_day + ADMIN_OVERRIDE_DELAY`); build the program
 * with the `demo-fast-settle` feature (5-minute delay) so a market is closeable shortly after a
 * compressed day. Idempotent: already-settled markets are skipped.
 */

import BN from "bn.js";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import {
  PAYOFF_UNIT,
  Ticker,
  tickerFromArg,
  tickerToSymbol,
  getProgram,
  fetchMarket,
  type TickerSymbol,
} from "@meridian/sdk";
import { Fixture } from "@meridian/e2e";
import type { ConsoleLog } from "./log";

export interface SettleDueOptions {
  rpcUrl: string;
  deployer: Keypair;
  usdcMint: PublicKey;
  /** Web base URL serving /api/price (the synthetic close source). */
  webBaseUrl?: string;
  /** Treat markets with `trading_day <= now + graceSeconds` as due (default 0). */
  graceSeconds?: number;
  /** Clock for "now" (unix seconds); injectable for tests. */
  nowSeconds?: () => number;
  log?: ConsoleLog;
}

export interface SettledMarket {
  address: PublicKey;
  symbol: TickerSymbol;
  strike: BN;
  settlementPrice: BN;
  outcome: "YesWins" | "NoWins";
  alreadySettled: boolean;
}

interface RawMarketAll {
  publicKey: PublicKey;
  account: {
    ticker: Record<string, unknown>;
    strike: BN;
    tradingDay: BN;
    state: Record<string, unknown>;
  };
}

const SCALE = Number(PAYOFF_UNIT.toString());
const dollarsToBaseUnits = (d: number): BN => new BN(Math.round(d * SCALE));

/** Fetch the synthetic close (curve end, progress=1) for one symbol's market, or null. */
async function fetchSyntheticClose(
  baseUrl: string,
  symbol: TickerSymbol,
  tradingDay: number
): Promise<number | null> {
  const url =
    `${baseUrl.replace(/\/$/, "")}/api/price?symbol=${encodeURIComponent(
      symbol
    )}` + `&tradingDay=${tradingDay}`;
  try {
    const res = await fetch(url, { headers: { accept: "application/json" } });
    if (!res.ok) return null;
    const body = (await res.json()) as { price?: unknown };
    const price = Number(body.price);
    return Number.isFinite(price) && price > 0 ? price : null;
  } catch {
    return null;
  }
}

/**
 * Settle every open market whose trading day has passed, via `admin_settle` at the synthetic
 * close. Returns one entry per settled (or already-settled) market.
 */
export async function settleDue(
  opts: SettleDueOptions
): Promise<SettledMarket[]> {
  const now = (opts.nowSeconds ?? (() => Math.floor(Date.now() / 1000)))();
  const grace = opts.graceSeconds ?? 0;
  const connection = new Connection(opts.rpcUrl, "confirmed");
  const program = getProgram({
    connection,
    publicKey: opts.deployer.publicKey,
  } as never);
  const fx = Fixture.attach(connection, opts.deployer, opts.usdcMint);

  const all = (await program.account.market.all()) as unknown as RawMarketAll[];
  const results: SettledMarket[] = [];

  for (const raw of all) {
    const state = Object.keys(raw.account.state)[0] ?? "";
    const tradingDay = raw.account.tradingDay.toNumber();
    const strike = raw.account.strike;
    const ticker: Ticker = tickerFromArg(raw.account.ticker);
    const symbol = tickerToSymbol(ticker);

    if (state === "settled") continue; // idempotent: skip already-settled
    if (tradingDay > now + grace) continue; // not due yet

    if (!opts.webBaseUrl) {
      opts.log?.warn(
        `${symbol} $${strike
          .div(PAYOFF_UNIT)
          .toString()} due but WEB_BASE_URL not set — skipped (no synthetic close).`
      );
      continue;
    }
    const close = await fetchSyntheticClose(
      opts.webBaseUrl,
      symbol,
      tradingDay
    );
    if (close === null) {
      opts.log?.warn(
        `${symbol} due but no synthetic close from /api/price — skipped.`
      );
      continue;
    }
    const settlementPrice = dollarsToBaseUnits(close);

    try {
      await fx.settleAdmin(
        { ticker, strike, tradingDay: raw.account.tradingDay },
        settlementPrice
      );
      const settled = await fetchMarket(program, raw.publicKey);
      const outcome = settled?.outcome === "yesWins" ? "YesWins" : "NoWins";
      results.push({
        address: raw.publicKey,
        symbol,
        strike,
        settlementPrice,
        outcome,
        alreadySettled: false,
      });
      opts.log?.step(
        `settled ${symbol} $${strike
          .div(PAYOFF_UNIT)
          .toString()} @ $${close} → ${outcome}`
      );
    } catch (err) {
      opts.log?.warn(
        `failed to settle ${symbol}: ${
          err instanceof Error ? err.message : String(err)
        }`
      );
    }
  }
  return results;
}
