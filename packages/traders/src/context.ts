/**
 * The shared runtime context the tools close over.
 *
 * A bot's tools all need the same handful of things — the chain client, the resolved
 * collateral mint, the on-chain Config (for per-ticker oracle feed ids), the environment
 * (history/Hermes URLs, dry-run flag), and the logger. Rather than thread these through
 * every tool, we build one {@link BotContext} per bot and bind it into the tools.
 *
 * This module also owns the small bits of read logic more than one tool relies on:
 * discovering the open markets and resolving a ticker's Hermes feed id from Config.
 */

import { PublicKey } from "@solana/web3.js";
import {
  Ticker,
  tickerFromArg,
  symbolToTicker,
  tickerToSymbol,
  type ConfigAccount,
  type MeridianProgram,
} from "@meridian/sdk";
import type BN from "bn.js";
import type { BotChain } from "./chain";
import type { Environment } from "./config";
import type { Logger } from "./logger";

export interface BotContext {
  chain: BotChain;
  usdcMint: PublicKey;
  config: ConfigAccount;
  env: Environment;
  log: Logger;
}

/** An open market the bot can trade, with the fields the tools and runner display. */
export interface OpenMarket {
  address: PublicKey;
  ticker: Ticker;
  symbol: string;
  strike: BN;
  tradingDay: BN;
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

/**
 * Discover every *open* market via `getProgramAccounts` (Anchor's `.all()` filters by the
 * Market discriminator). This mirrors the web app's discovery but is the bots' own code —
 * settled markets are filtered out since you can't open new positions on them.
 */
export async function discoverOpenMarkets(
  program: MeridianProgram
): Promise<OpenMarket[]> {
  const raw = (await program.account.market.all()) as unknown as RawMarketAll[];
  const open: OpenMarket[] = [];
  for (const r of raw) {
    const state = Object.keys(r.account.state)[0] ?? "";
    if (state === "settled") continue;
    const ticker = tickerFromArg(r.account.ticker);
    open.push({
      address: r.publicKey,
      ticker,
      symbol: tickerToSymbol(ticker),
      strike: r.account.strike,
      tradingDay: r.account.tradingDay,
    });
  }
  // Stable order: by symbol, then strike.
  open.sort(
    (a, b) => a.symbol.localeCompare(b.symbol) || a.strike.cmp(b.strike)
  );
  return open;
}

/**
 * The 32-byte Pyth feed id for a ticker, as a hex string Hermes accepts, read from the
 * on-chain Config. Returns null if the ticker has no feed configured (a mock-only setup).
 */
export function feedIdHex(
  config: ConfigAccount,
  ticker: Ticker
): string | null {
  const entry = config.tickers.find((t) => t.ticker === ticker);
  if (!entry || entry.feedId.length !== 32) return null;
  // All-zero feed id means "unset" (mock close used instead of a real oracle).
  if (entry.feedId.every((b) => b === 0)) return null;
  return Buffer.from(entry.feedId).toString("hex");
}

/** Resolve a user-supplied symbol string (e.g. "META") to a {@link Ticker}; throws if unknown. */
export function resolveSymbol(symbol: string): Ticker {
  return symbolToTicker(symbol);
}
