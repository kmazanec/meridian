/**
 * Compute the maker counterparty token accounts a marketable order will cross.
 *
 * `place_order` matches a taker against resting orders passed in `remaining_accounts`; the
 * intent layer is book-agnostic, so the caller supplies these from the live book. This is
 * the bots' own implementation of that mapping (the web app has an equivalent in its lib):
 *
 *  - a Yes **bid** at `price` crosses **asks** priced ≤ `price`; each maker sold Yes and
 *    receives **USDC** → their USDC ATA.
 *  - a Yes **ask** at `price` crosses **bids** priced ≥ `price`; each maker bought Yes and
 *    receives **Yes** → their Yes ATA.
 *
 * A market order crosses the whole opposite side at any price. We return at most enough
 * makers to fill `size`, best-price-then-time first — the same order the program matches.
 */

import BN from "bn.js";
import { PublicKey } from "@solana/web3.js";
import { OrderSide, ata, type OrderBookAccount } from "@meridian/sdk";

export function makerAccountsFor(opts: {
  book: OrderBookAccount;
  /** The Yes-book side the order leg rests on. */
  side: OrderSide;
  /** The Yes-book price (post-reflection for No actions). */
  price: BN;
  size: BN;
  isMarket: boolean;
  usdcMint: PublicKey;
  yesMint: PublicKey;
}): PublicKey[] {
  const { book, side, price, size, isMarket, usdcMint, yesMint } = opts;
  const resting = side === OrderSide.Bid ? book.asks : book.bids;

  const crossable = resting.filter((o) => {
    if (!o.active || o.size.isZero()) return false;
    if (isMarket) return true;
    return side === OrderSide.Bid ? o.price.lte(price) : o.price.gte(price);
  });

  crossable.sort(
    (a, b) =>
      side === OrderSide.Bid
        ? a.price.cmp(b.price) || a.seq.cmp(b.seq) // buying: cheapest asks first
        : b.price.cmp(a.price) || a.seq.cmp(b.seq) // selling: highest bids first
  );

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
