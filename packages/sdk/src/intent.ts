/**
 * The "four buttons → one book" intent translation — the single place this mapping
 * lives, so the automation service and frontend never re-implement it.
 *
 * There is exactly one on-chain book per market: **Yes traded against USDC**. Because
 * `Yes + No = $1.00`, all four user actions resolve onto that one book:
 *
 *   | Action   | On the Yes-vs-USDC book                                            |
 *   |----------|-------------------------------------------------------------------|
 *   | BUY_YES  | place a **bid** (buy Yes) at the Yes price                          |
 *   | SELL_YES | place an **ask** (sell Yes) at the Yes price                        |
 *   | BUY_NO   | **mint a pair** ($1 → 1 Yes + 1 No), then **sell the Yes** (ask) at |
 *   |          | `1 − noPrice`; you are left holding No. Effective No cost =         |
 *   |          | `$1.00 − Yes sale proceeds`.                                        |
 *   | SELL_NO  | **buy Yes** (bid) at `1 − noPrice`; holding Yes+No nets a           |
 *   |          | redeemable $1.00, closing the No exposure.                          |
 *
 * Prices are integers in `[0, PRICE_SCALE]`. For No actions the caller passes the **No**
 * price; this module reflects it to the Yes price via `PRICE_SCALE − noPrice`.
 *
 * The returned instruction list is meant to be sent as **one transaction** (one wallet
 * approval), matching the architecture's "one wallet approval" requirement. Any required
 * token-account creations are prepended (idempotent), since `place_order` requires the
 * user's Yes/USDC accounts to already exist.
 */

import BN from "bn.js";
import { PublicKey, TransactionInstruction } from "@solana/web3.js";
import type { MeridianProgram } from "./program";
import { PRICE_SCALE, PAYOFF_UNIT } from "./constants";
import {
  deriveMarketPdas,
  marketPda,
  type BNLike,
  type MarketPdas,
} from "./pdas";
import { OrderSide } from "./types";
import {
  type MarketId,
  createAtaIfNeeded,
  placeOrder,
  mintPair,
} from "./instructions";

/** The four user-facing trade actions. */
export enum TradeAction {
  BuyYes = "BUY_YES",
  SellYes = "SELL_YES",
  BuyNo = "BUY_NO",
  SellNo = "SELL_NO",
}

/**
 * Max `mint_pair` instructions a single BUY_NO transaction may carry. Each pair mints 1.0
 * Yes+No (~13 accounts); beyond this a single transaction risks the size/compute limits.
 * Larger BUY_NO must be split across transactions by the caller.
 */
export const MAX_BUY_NO_MINT_PAIRS = 6;

export interface TradeIntent {
  market: MarketId | PublicKey;
  action: TradeAction;
  /**
   * Limit price in `[0, PRICE_SCALE]`, in the action's *own* perspective:
   * the Yes price for BUY_YES/SELL_YES, the No price for BUY_NO/SELL_NO.
   * Ignored when `isMarket` is true.
   */
  price: BNLike;
  /** Size in token base units (the outcome token being acquired/sold). */
  size: BNLike;
  /** Market order: cross at any price, fill-or-cancel the remainder. */
  isMarket?: boolean;
  /** The collateral (USDC) mint, from Config. */
  usdcMint: PublicKey;
  /**
   * Maker counterparty token accounts for any resting orders this action will cross,
   * in fill order (best price/time first). Required only when the order is marketable
   * (it crosses existing liquidity); compute them from the current book (see `reads`):
   * for a Yes **bid** that crosses asks, each maker (seller) receives **USDC**; for a
   * Yes **ask** that crosses bids, each maker (buyer) receives **Yes**. The order leg
   * is the BUY_YES/SELL_YES order, the SELL_NO buy-Yes, or the BUY_NO sell-Yes.
   */
  makerAccounts?: PublicKey[];
}

export interface BuiltIntent {
  /** Instructions to send as one transaction (one wallet approval). */
  instructions: TransactionInstruction[];
  /** The Yes-book side actually used (what the action reduces to). */
  bookSide: OrderSide;
  /** The Yes-book price actually used (post-reflection for No actions). */
  yesPrice: BN;
  /** How many `mint_pair` calls were prepended (BUY_NO only). */
  mintPairs: number;
}

function toBN(v: BNLike): BN {
  return BN.isBN(v) ? v : new BN(v);
}

function resolvePdas(market: MarketId | PublicKey): MarketPdas {
  return market instanceof PublicKey
    ? deriveMarketPdas(market)
    : deriveMarketPdas(
        marketPda(market.ticker, market.strike, market.tradingDay)
      );
}

/**
 * Reflect a No price to its Yes price (and vice-versa): `PRICE_SCALE − p`.
 * Throws if `price` is outside `[0, PRICE_SCALE]` — a reflected price outside that range
 * is meaningless and would otherwise become a negative/garbage order price.
 */
export function reflectPrice(price: BNLike): BN {
  const p = toBN(price);
  if (p.isNeg() || p.gt(PRICE_SCALE)) {
    throw new Error(
      `Price ${p.toString()} out of range [0, ${PRICE_SCALE.toString()}]; cannot reflect`
    );
  }
  return PRICE_SCALE.sub(p);
}

/**
 * Translate a four-button trade intent into the ordered on-chain instruction(s).
 *
 * For BUY_NO, `size` must be a whole multiple of `PAYOFF_UNIT` (a whole number of
 * tokens): minting yields 1.0 Yes + 1.0 No per pair, and the Yes is sold in full, so a
 * fractional No can't be acquired without leaving stranded Yes. The function throws on a
 * non-multiple size rather than silently leaving dust.
 */
export async function buildTradeIntent(
  program: MeridianProgram,
  user: PublicKey,
  intent: TradeIntent
): Promise<BuiltIntent> {
  const k = resolvePdas(intent.market);
  const size = toBN(intent.size);
  if (size.lten(0)) {
    throw new Error("Trade size must be positive");
  }

  const ensureYes = createAtaIfNeeded(user, user, k.yesMint);
  const ensureUsdc = createAtaIfNeeded(user, user, intent.usdcMint);
  const ensureNo = createAtaIfNeeded(user, user, k.noMint);

  switch (intent.action) {
    case TradeAction.BuyYes: {
      // Bid on the Yes book at the Yes price.
      const ix = await placeOrder(program, {
        user,
        market: intent.market,
        side: OrderSide.Bid,
        price: toBN(intent.price),
        size,
        isMarket: intent.isMarket,
        usdcMint: intent.usdcMint,
        makerAccounts: intent.makerAccounts,
      });
      return {
        instructions: [ensureUsdc, ensureYes, ix],
        bookSide: OrderSide.Bid,
        yesPrice: toBN(intent.price),
        mintPairs: 0,
      };
    }

    case TradeAction.SellYes: {
      // Ask on the Yes book at the Yes price.
      const ix = await placeOrder(program, {
        user,
        market: intent.market,
        side: OrderSide.Ask,
        price: toBN(intent.price),
        size,
        isMarket: intent.isMarket,
        usdcMint: intent.usdcMint,
        makerAccounts: intent.makerAccounts,
      });
      return {
        instructions: [ensureUsdc, ensureYes, ix],
        bookSide: OrderSide.Ask,
        yesPrice: toBN(intent.price),
        mintPairs: 0,
      };
    }

    case TradeAction.BuyNo: {
      // Mint pair(s) to obtain Yes, then sell the Yes (ask) at 1 − noPrice; keep the No.
      if (!size.mod(PAYOFF_UNIT).isZero()) {
        throw new Error(
          `BUY_NO size must be a whole multiple of PAYOFF_UNIT (${PAYOFF_UNIT.toString()}); ` +
            `got ${size.toString()}. Minting yields whole-token pairs.`
        );
      }
      const pairs = size.div(PAYOFF_UNIT).toNumber();
      // Each pair is a separate mint_pair instruction (~13 accounts). Too many in one
      // transaction blow the 1232-byte / compute limits, and one transaction is the
      // "one wallet approval" contract here — so cap and tell the caller to batch larger
      // BUY_NO across multiple transactions rather than silently building an invalid one.
      if (pairs > MAX_BUY_NO_MINT_PAIRS) {
        throw new Error(
          `BUY_NO of ${pairs} tokens exceeds the per-transaction mint cap ` +
            `(${MAX_BUY_NO_MINT_PAIRS}); split it across multiple transactions.`
        );
      }
      const yesPrice = reflectPrice(intent.price);
      const mints: TransactionInstruction[] = [];
      for (let i = 0; i < pairs; i++) {
        mints.push(
          await mintPair(program, {
            user,
            usdcMint: intent.usdcMint,
            market: intent.market,
          })
        );
      }
      const sellYes = await placeOrder(program, {
        user,
        market: intent.market,
        side: OrderSide.Ask,
        price: yesPrice,
        size,
        isMarket: intent.isMarket,
        usdcMint: intent.usdcMint,
        makerAccounts: intent.makerAccounts,
      });
      return {
        // mint_pair creates Yes/No ATAs itself; ensure USDC exists for the deposit.
        instructions: [ensureUsdc, ensureYes, ensureNo, ...mints, sellYes],
        bookSide: OrderSide.Ask,
        yesPrice,
        mintPairs: pairs,
      };
    }

    case TradeAction.SellNo: {
      // Buy Yes (bid) at 1 − noPrice; holding Yes+No closes the No exposure.
      const yesPrice = reflectPrice(intent.price);
      const buyYes = await placeOrder(program, {
        user,
        market: intent.market,
        side: OrderSide.Bid,
        price: yesPrice,
        size,
        isMarket: intent.isMarket,
        usdcMint: intent.usdcMint,
        makerAccounts: intent.makerAccounts,
      });
      return {
        instructions: [ensureUsdc, ensureYes, buyYes],
        bookSide: OrderSide.Bid,
        yesPrice,
        mintPairs: 0,
      };
    }

    default: {
      const exhaustive: never = intent.action;
      throw new Error(`Unknown trade action: ${String(exhaustive)}`);
    }
  }
}
