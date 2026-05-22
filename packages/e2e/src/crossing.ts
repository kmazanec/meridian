/**
 * Maker-counterparty account computation for crossing orders.
 *
 * `place_order` / `match_orders` read the maker payout accounts from `remaining_accounts`
 * and match them against each resting order's recorded owner + mint. The SDK's intent
 * layer is book-agnostic by design, so the *caller* must compute these from the live book
 * — exactly as the frontend does. This mirrors the frontend's reference algorithm so the
 * convergence suite proves the same crossing logic the UI relies on.
 *
 *  - a Yes **bid** at `price` crosses **asks** with `askPrice <= price`; each maker is a
 *    seller who receives **USDC** → their USDC ATA.
 *  - a Yes **ask** at `price` crosses **bids** with `bidPrice >= price`; each maker is a
 *    buyer who receives **Yes** → their Yes ATA.
 *
 * Returns at most enough makers to fill `size`, in best-price-then-time order (the order
 * the program matches), so the account list lines up with the fills.
 */

import BN from "bn.js";
import { PublicKey } from "@solana/web3.js";
import {
  OrderSide,
  PRICE_SCALE,
  TradeAction,
  ata,
  type OrderBookAccount,
} from "@meridian/sdk";

/**
 * The Yes-book side a four-button action rests/crosses on, and the Yes price it lands on.
 * Mirrors the frontend's `tradeForm` mapping (Buy Yes / Sell No → bid; Sell Yes / Buy No
 * → ask; No-action prices are reflected). The SDK's `buildTradeIntent` owns the actual
 * instruction assembly; this only tells the caller which crossing to compute.
 */
export function yesSideFor(action: TradeAction): OrderSide {
  switch (action) {
    case TradeAction.BuyYes:
    case TradeAction.SellNo:
      return OrderSide.Bid;
    case TradeAction.SellYes:
    case TradeAction.BuyNo:
      return OrderSide.Ask;
  }
}

export function isNoAction(action: TradeAction): boolean {
  return action === TradeAction.BuyNo || action === TradeAction.SellNo;
}

export function yesPriceFor(action: TradeAction, price: BN): BN {
  return isNoAction(action) ? PRICE_SCALE.sub(price) : price;
}

export function makerAccountsFor(opts: {
  book: OrderBookAccount;
  side: OrderSide;
  price: BN;
  size: BN;
  isMarket: boolean;
  usdcMint: PublicKey;
  yesMint: PublicKey;
}): PublicKey[] {
  const { book, side, price, size, isMarket, usdcMint, yesMint } = opts;

  // The opposite side is what a taker crosses.
  const resting = side === OrderSide.Bid ? book.asks : book.bids;

  const crossable = resting.filter((o) => {
    if (!o.active || o.size.isZero()) return false;
    if (isMarket) return true;
    return side === OrderSide.Bid ? o.price.lte(price) : o.price.gte(price);
  });

  // Best price first; on ties, earliest seq (time priority) — the program's order.
  crossable.sort(
    (a, b) =>
      side === OrderSide.Bid
        ? a.price.cmp(b.price) || a.seq.cmp(b.seq) // buying: cheapest asks first
        : b.price.cmp(a.price) || a.seq.cmp(b.seq) // selling: highest bids first
  );

  // The maker receives USDC if we're buying (they sold Yes); Yes if we're selling.
  const makerMint = side === OrderSide.Bid ? usdcMint : yesMint;

  const accounts: PublicKey[] = [];
  let remaining = size.clone();
  for (const maker of crossable) {
    if (remaining.lten(0)) break;
    accounts.push(ata(makerMint, maker.owner));
    remaining = remaining.sub(BN.min(remaining, maker.size));
  }
  return accounts;
}
