import BN from "bn.js";
import { PublicKey } from "@solana/web3.js";
import {
  OrderSide,
  ata,
  type OrderBookAccount,
  type OrderEntry,
} from "@meridian/sdk";

/**
 * Compute the maker counterparty token accounts an order will cross, in fill order.
 *
 * `place_order` reads these from `remaining_accounts` and matches them against each
 * resting order's recorded owner + mint. The intent layer can't know them (it's
 * book-agnostic by design), so the caller computes them from the live book:
 *
 *  - a Yes **bid** at `price` crosses **asks** with `askPrice <= price`; each maker is a
 *    seller who receives **USDC** → their USDC ATA.
 *  - a Yes **ask** at `price` crosses **bids** with `bidPrice >= price`; each maker is a
 *    buyer who receives **Yes** → their Yes ATA.
 *
 * A market order (`isMarket`) crosses the whole opposite side at any price.
 *
 * Returns at most enough makers to fill `size`, in best-price-then-time order (the
 * same order the program matches), so the account list lines up with the fills.
 */
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

  // Crossable: price within the limit (or any, for a market order). Asks cross when
  // ask <= bid price; bids cross when bid >= ask price.
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

/** Whether an order at `price`/`size` would cross any resting liquidity. */
export function isMarketable(opts: {
  book: OrderBookAccount;
  side: OrderSide;
  price: BN;
  isMarket: boolean;
}): boolean {
  const { book, side, price, isMarket } = opts;
  const resting = side === OrderSide.Bid ? book.asks : book.bids;
  return resting.some((o: OrderEntry) => {
    if (!o.active || o.size.isZero()) return false;
    if (isMarket) return true;
    return side === OrderSide.Bid ? o.price.lte(price) : o.price.gte(price);
  });
}
