/**
 * Reading helpers: typed account fetchers and the dual-perspective order-book view.
 *
 * The program keeps **one** book per market — Yes traded against USDC. Because
 * `Yes + No = $1.00`, that single book *is* the No book seen from the other side. These
 * helpers expose both perspectives from the one on-chain book (the "one book, two
 * perspectives" architecture concept) plus position/balance/PNL reads, so consumers
 * never re-derive the No side.
 */

import BN from "bn.js";
import { EventParser } from "@anchor-lang/core";
import { Connection, PublicKey } from "@solana/web3.js";
import {
  getAccount as getTokenAccount,
  TokenAccountNotFoundError,
  TokenInvalidAccountOwnerError,
} from "@solana/spl-token";
import type { MeridianProgram } from "./program";
import { PRICE_SCALE } from "./constants";
import {
  configPda,
  marketPda,
  orderBookPda,
  userTokenAccounts,
  type BNLike,
} from "./pdas";
import {
  OrderSide,
  Outcome,
  Ticker,
  tickerFromArg,
  orderSideFromArg,
} from "./types";

// --- Decoded account shapes (Anchor camelCase). ---

export interface ConfigAccount {
  admin: PublicKey;
  usdcMint: PublicKey;
  tickers: { ticker: Ticker; feedId: number[] }[];
  paused: boolean;
  feeAccount: PublicKey | null;
  bump: number;
}

export interface MarketAccount {
  ticker: Ticker;
  strike: BN;
  tradingDay: BN;
  yesMint: PublicKey;
  noMint: PublicKey;
  vault: PublicKey;
  orderBook: PublicKey;
  pairsMinted: BN;
  winningRedeemed: BN;
  state: "open" | "settled";
  outcome: Outcome;
  settlementPrice: BN | null;
  settledAt: BN | null;
  bump: number;
  vaultBump: number;
  mintAuthorityBump: number;
}

/** One resting order, decoded with its enum side normalized. */
export interface OrderEntry {
  owner: PublicKey;
  price: BN;
  size: BN;
  seq: BN;
  side: OrderSide;
  active: boolean;
}

export interface OrderBookAccount {
  market: PublicKey;
  nextSeq: BN;
  bids: OrderEntry[];
  asks: OrderEntry[];
  bump: number;
}

function enumKey(e: Record<string, unknown>): string {
  return Object.keys(e)[0] ?? "";
}

function normalizeOutcome(e: Record<string, unknown>): Outcome {
  switch (enumKey(e)) {
    case "yesWins":
      return Outcome.YesWins;
    case "noWins":
      return Outcome.NoWins;
    default:
      return Outcome.Unsettled;
  }
}

function normalizeOrder(raw: {
  owner: PublicKey;
  price: BN;
  size: BN;
  seq: BN;
  side: Record<string, unknown>;
  active: boolean;
}): OrderEntry {
  return {
    owner: raw.owner,
    price: raw.price,
    size: raw.size,
    seq: raw.seq,
    side: orderSideFromArg(raw.side),
    active: raw.active,
  };
}

// --- Account fetchers ---

/** Fetch and decode the singleton Config (or null if not initialized). */
export async function fetchConfig(
  program: MeridianProgram
): Promise<ConfigAccount | null> {
  const raw = await program.account.config.fetchNullable(configPda());
  if (!raw) return null;
  return {
    admin: raw.admin,
    usdcMint: raw.usdcMint,
    tickers: raw.tickers.map((t) => ({
      ticker: tickerFromArg(t.ticker),
      feedId: t.feedId,
    })),
    paused: raw.paused,
    feeAccount: raw.feeAccount,
    bump: raw.bump,
  };
}

/** Fetch and decode a Market by address (or null if absent). */
export async function fetchMarket(
  program: MeridianProgram,
  market: PublicKey
): Promise<MarketAccount | null> {
  const raw = await program.account.market.fetchNullable(market);
  if (!raw) return null;
  return {
    ticker: tickerFromArg(raw.ticker),
    strike: raw.strike,
    tradingDay: raw.tradingDay,
    yesMint: raw.yesMint,
    noMint: raw.noMint,
    vault: raw.vault,
    orderBook: raw.orderBook,
    pairsMinted: raw.pairsMinted,
    winningRedeemed: raw.winningRedeemed,
    state: enumKey(raw.state) === "settled" ? "settled" : "open",
    outcome: normalizeOutcome(raw.outcome),
    settlementPrice: raw.settlementPrice ?? null,
    settledAt: raw.settledAt ?? null,
    bump: raw.bump,
    vaultBump: raw.vaultBump,
    mintAuthorityBump: raw.mintAuthorityBump,
  };
}

/** Fetch a Market by its identity (ticker/strike/day). */
export function fetchMarketById(
  program: MeridianProgram,
  ticker: Ticker,
  strike: BNLike,
  tradingDay: BNLike
): Promise<MarketAccount | null> {
  return fetchMarket(program, marketPda(ticker, strike, tradingDay));
}

/** Fetch and decode the order book for a market (or null if not yet created). */
export async function fetchOrderBook(
  program: MeridianProgram,
  market: PublicKey
): Promise<OrderBookAccount | null> {
  const raw = await program.account.orderBook.fetchNullable(
    orderBookPda(market)
  );
  if (!raw) return null;
  return {
    market: raw.market,
    nextSeq: raw.nextSeq,
    bids: raw.bids.map(normalizeOrder),
    asks: raw.asks.map(normalizeOrder),
    bump: raw.bump,
  };
}

/**
 * Fetch and decode *every* order book in one `getProgramAccounts` call, keyed by the
 * order book's own account address (base58). This is the batched read behind the
 * Markets-page strike ladder: instead of one `fetchOrderBook` per strike (N RPC calls),
 * one call returns them all. Join to markets via `Market.orderBook`. Orders are
 * normalized identically to {@link fetchOrderBook} (same `normalizeOrder`).
 */
export async function fetchAllOrderBooks(
  program: MeridianProgram
): Promise<Map<string, OrderBookAccount>> {
  const raw = await program.account.orderBook.all();
  const byAddress = new Map<string, OrderBookAccount>();
  for (const { publicKey, account } of raw) {
    byAddress.set(publicKey.toBase58(), {
      market: account.market,
      nextSeq: account.nextSeq,
      bids: account.bids.map(normalizeOrder),
      asks: account.asks.map(normalizeOrder),
      bump: account.bump,
    });
  }
  return byAddress;
}

// --- Dual-perspective book ---

/** A price level aggregated for display (price + total size at that price). */
export interface BookLevel {
  /** Price in USDC-per-token at PRICE_SCALE, in the *requested* perspective. */
  price: BN;
  /** Total size (token base units) resting at this price. */
  size: BN;
  /** Number of distinct orders at this price. */
  count: number;
}

/** One side of a book in a chosen perspective, best price first. */
export interface BookView {
  bids: BookLevel[];
  asks: BookLevel[];
}

/** Both perspectives of the single underlying book. */
export interface DualBook {
  /** The Yes-token perspective (the raw on-chain book). */
  yes: BookView;
  /** The No-token perspective (the `1.00 − price` mirror of the same book). */
  no: BookView;
}

/**
 * Complement a Yes price into the No price: `PRICE_SCALE − p`. Throws if `price` is
 * outside `[0, PRICE_SCALE]`; on-chain order prices are always in range, so this only
 * fires on genuinely corrupt input rather than silently yielding a negative price.
 */
export function complementPrice(price: BNLike): BN {
  const p = BN.isBN(price) ? price : new BN(price);
  if (p.isNeg() || p.gt(PRICE_SCALE)) {
    throw new Error(
      `Price ${p.toString()} out of range [0, ${PRICE_SCALE.toString()}]`
    );
  }
  return PRICE_SCALE.sub(p);
}

/** Aggregate raw orders into price levels, sorted best-first for the given side. */
function aggregate(orders: OrderEntry[], side: OrderSide): BookLevel[] {
  const byPrice = new Map<string, BookLevel>();
  for (const o of orders) {
    if (!o.active || o.size.isZero()) continue;
    const key = o.price.toString();
    const lvl = byPrice.get(key);
    if (lvl) {
      lvl.size = lvl.size.add(o.size);
      lvl.count += 1;
    } else {
      byPrice.set(key, { price: o.price, size: o.size.clone(), count: 1 });
    }
  }
  const levels = [...byPrice.values()];
  // Bids: highest price first. Asks: lowest price first.
  levels.sort((a, b) =>
    side === OrderSide.Bid ? b.price.cmp(a.price) : a.price.cmp(b.price)
  );
  return levels;
}

/**
 * Project the single Yes-vs-USDC book into both perspectives.
 *
 * No-side mirror (because `Yes + No = $1.00`):
 *   - a Yes **bid** @ p (someone paying p to buy Yes) is a No **ask** @ `1−p`;
 *   - a Yes **ask** @ p (someone selling Yes for p) is a No **bid** @ `1−p`.
 * Sizes are identical (one Yes ⇄ one No within a pair); only price reflects.
 */
export function dualBook(book: OrderBookAccount): DualBook {
  // Mirror a Yes order into the opposite-side No order at `1 − price`, preserving size,
  // owner, and seq (time priority). The same `aggregate` then collapses + sorts both
  // perspectives identically — one code path, no risk of the two diverging.
  const mirror = (o: OrderEntry, side: OrderSide): OrderEntry => ({
    ...o,
    price: complementPrice(o.price),
    side,
  });

  return {
    yes: {
      bids: aggregate(book.bids, OrderSide.Bid),
      asks: aggregate(book.asks, OrderSide.Ask),
    },
    no: {
      // No bids come from Yes asks (mirrored); No asks come from Yes bids (mirrored).
      bids: aggregate(
        book.asks.map((o) => mirror(o, OrderSide.Bid)),
        OrderSide.Bid
      ),
      asks: aggregate(
        book.bids.map((o) => mirror(o, OrderSide.Ask)),
        OrderSide.Ask
      ),
    },
  };
}

// --- Positions / balances / PNL ---

/** A user's token balances for one market. */
export interface UserPosition {
  usdc: BN;
  yes: BN;
  no: BN;
}

/**
 * Read a user's USDC / Yes / No balances for a market via RPC (0 for any account that
 * doesn't exist). The USDC mint lives in `Config`, not the market, so it is passed
 * explicitly (callers have it from {@link fetchConfig} or their own config).
 */
export async function fetchUserPosition(
  connection: Connection,
  owner: PublicKey,
  market: MarketAccount,
  usdcMint: PublicKey
): Promise<UserPosition> {
  const { usdc, yes, no } = userTokenAccounts(
    owner,
    usdcMint,
    market.yesMint,
    market.noMint
  );
  const [usdcBal, yesBal, noBal] = await Promise.all([
    fetchBalance(connection, usdc),
    fetchBalance(connection, yes),
    fetchBalance(connection, no),
  ]);
  return { usdc: usdcBal, yes: yesBal, no: noBal };
}

/** Read a single token-account balance (base units); 0 if the account doesn't exist. */
export async function fetchBalance(
  connection: Connection,
  tokenAccount: PublicKey
): Promise<BN> {
  try {
    const acc = await getTokenAccount(connection, tokenAccount);
    return new BN(acc.amount.toString());
  } catch (e) {
    if (
      e instanceof TokenAccountNotFoundError ||
      e instanceof TokenInvalidAccountOwnerError
    ) {
      return new BN(0);
    }
    throw e;
  }
}

/**
 * Settled-market payout for a holding: a winning token is worth `PRICE_SCALE` (=$1.00)
 * base units, a losing token $0. Returns the USDC base units the holding redeems for.
 * Throws if the market is not settled.
 */
export function payoutFor(
  market: MarketAccount,
  side: "yes" | "no",
  amount: BNLike
): BN {
  if (market.state !== "settled" || market.outcome === Outcome.Unsettled) {
    throw new Error("Market is not settled; payout is undefined");
  }
  if (market.settlementPrice === null) {
    // A settled market always has a settlement price written; a null here means a
    // corrupt/inconsistent account, not a valid state to compute a payout from.
    throw new Error(
      "Invariant violation: settled market has no settlement price"
    );
  }
  const amt = BN.isBN(amount) ? amount : new BN(amount);
  const winning =
    (side === "yes" && market.outcome === Outcome.YesWins) ||
    (side === "no" && market.outcome === Outcome.NoWins);
  // tokens are 6dp and a winning token pays PRICE_SCALE (1e6) per 1.0 token → 1:1 base units.
  return winning ? amt.clone() : new BN(0);
}

// --- Redeem history (reconstructing claimed positions after their tokens are burned) ---

/** One `Redeemed` event, decoded from a wallet's transaction logs. */
export interface RedeemRecord {
  /** The market the redemption was against (base58). */
  market: string;
  /** True if the redeemed side won (a claimed winner); false for a burned loser. */
  won: boolean;
  /** Outcome-token base units burned by the redeem (6dp). */
  tokensBurned: BN;
  /** USDC base units paid out (6dp) — `tokensBurned` for a winner, 0 for a loser. */
  usdcPaid: BN;
  /** The transaction signature the event came from. */
  signature: string;
}

/** The decoded-event shape `EventParser.parseLogs` yields (name + data). */
export interface ParsedEvent {
  name: string;
  data: Record<string, unknown>;
}

/**
 * Map already-parsed program events to {@link RedeemRecord}s for one owner. Pure (no RPC) so
 * the filtering + field-mapping is unit-tested directly; {@link fetchRedeemHistory} feeds it
 * the events `EventParser` decodes from each tx's logs. Keeps only `Redeemed` events whose
 * `user` is `ownerB58`, and normalizes the snake/camel field variants Anchor may emit.
 */
export function redeemRecordsFromEvents(
  events: ParsedEvent[],
  ownerB58: string,
  signature: string
): RedeemRecord[] {
  const out: RedeemRecord[] = [];
  for (const ev of events) {
    if (ev.name !== "redeemed" && ev.name !== "Redeemed") continue;
    const d = ev.data as {
      market: PublicKey;
      user: PublicKey;
      won: boolean;
      tokensBurned?: BN | bigint | number;
      usdcPaid?: BN | bigint | number;
      tokens_burned?: BN | bigint | number;
      usdc_paid?: BN | bigint | number;
    };
    if (d.user.toBase58() !== ownerB58) continue; // only this wallet's redeems
    out.push({
      market: d.market.toBase58(),
      won: d.won,
      tokensBurned: new BN((d.tokensBurned ?? d.tokens_burned ?? 0).toString()),
      usdcPaid: new BN((d.usdcPaid ?? d.usdc_paid ?? 0).toString()),
      signature,
    });
  }
  return out;
}

/**
 * Reconstruct a wallet's redeem history by parsing the program's `Redeemed` events from its
 * recent transaction logs. This is how the UI recovers **claimed winners**: redeeming a
 * winning position burns its tokens, so it vanishes from current holdings — but the event
 * persists in the chain's logs. (Losing tokens are normally never redeemed, so they linger in
 * the wallet and are read directly from balances; this fills in the other half of the picture.)
 *
 * Bounded by `limit` recent signatures (default 1000) to keep RPC cost predictable; a wallet
 * with redeems older than that window may miss the oldest — callers wanting completeness can
 * raise the limit or paginate. Best-effort per signature: a transaction whose logs can't be
 * fetched/parsed is skipped, not fatal.
 */
export async function fetchRedeemHistory(
  connection: Connection,
  program: MeridianProgram,
  owner: PublicKey,
  opts: { limit?: number } = {}
): Promise<RedeemRecord[]> {
  const limit = opts.limit ?? 1000;
  const sigs = await connection.getSignaturesForAddress(owner, { limit });
  if (sigs.length === 0) return [];

  const parser = new EventParser(program.programId, program.coder);
  const records: RedeemRecord[] = [];

  // Fetch in modest batches so one big wallet doesn't fire 1000 parallel RPC calls.
  const BATCH = 25;
  const ownerB58 = owner.toBase58();
  for (let i = 0; i < sigs.length; i += BATCH) {
    const slice = sigs.slice(i, i + BATCH).filter((s) => !s.err); // skip failed txs
    const txs = await Promise.all(
      slice.map((s) =>
        connection
          .getTransaction(s.signature, {
            maxSupportedTransactionVersion: 0,
            commitment: "confirmed",
          })
          .catch(() => null)
      )
    );
    for (let j = 0; j < txs.length; j++) {
      const tx = txs[j];
      const logs = tx?.meta?.logMessages;
      if (!logs) continue;
      const events = [...parser.parseLogs(logs)] as ParsedEvent[];
      records.push(
        ...redeemRecordsFromEvents(events, ownerB58, slice[j].signature)
      );
    }
  }
  return records;
}
