import BN from "bn.js";
import { PAYOFF_UNIT, PRICE_SCALE, TradeAction } from "@meridian/sdk";
import { yesPriceFor, isNoAction } from "./tradeForm";

/**
 * Pre-trade affordability + cost preview, computed from balances the panel already has
 * (UserPosition.usdc/yes/no). This catches "insufficient funds" *before* building the tx,
 * so the user sees a clear message instead of the wallet's generic "Unexpected error" when
 * an on-chain token transfer fails. All amounts are 6-dp base units.
 *
 * What each action requires the wallet to hold at execution:
 *  - Buy Yes  (bid):        usdc >= yesPrice * size            (pays to buy Yes)
 *  - Sell No  (buy Yes):    usdc >= yesPrice * size            (buys Yes to close No)
 *  - Buy No   (mint + sell):usdc >= size  ($1.00 * pairs is deposited up front to mint;
 *                           the Yes sale only returns funds AFTER the mint succeeds, so the
 *                           full deposit must be funded)
 *  - Sell Yes (ask):        yes  >= size                       (gives up Yes tokens)
 */

export interface Balances {
  usdc: BN;
  yes: BN;
  no: BN;
}

export interface TradeCost {
  /** The token the action spends. */
  asset: "USDC" | "Yes";
  /** How much of that token the wallet must hold (6-dp base units). */
  required: BN;
  /** What the wallet currently holds of that token. */
  have: BN;
  /** True when `have >= required`. */
  affordable: boolean;
}

/** `price * size / PAYOFF_UNIT`, the USDC cost of `size` tokens at `price` (6-dp). */
function notional(price: BN, size: BN): BN {
  return price.mul(size).div(PAYOFF_UNIT);
}

/**
 * Compute what an action costs and whether the given balances cover it. `price` is in the
 * action's own perspective (Yes price for Yes actions, No price for No). For a market order
 * the worst-case price is $1.00 (PRICE_SCALE) since it crosses at any price.
 */
export function tradeCost(opts: {
  action: TradeAction;
  price: BN;
  size: BN;
  isMarket: boolean;
  balances: Balances;
}): TradeCost {
  const { action, price, size, isMarket, balances } = opts;
  // A market order can fill at any price up to $1.00 — budget for the worst case.
  const effPrice = isMarket ? PRICE_SCALE : price;
  const yesPrice = yesPriceFor(action, effPrice);

  switch (action) {
    case TradeAction.SellYes:
      return {
        asset: "Yes",
        required: size,
        have: balances.yes,
        affordable: balances.yes.gte(size),
      };
    case TradeAction.BuyNo: {
      // mint_pair deposits $1.00 * pairs = `size` USDC up front.
      const required = size;
      return {
        asset: "USDC",
        required,
        have: balances.usdc,
        affordable: balances.usdc.gte(required),
      };
    }
    case TradeAction.BuyYes:
    case TradeAction.SellNo:
    default: {
      const required = notional(yesPrice, size);
      return {
        asset: "USDC",
        required,
        have: balances.usdc,
        affordable: balances.usdc.gte(required),
      };
    }
  }
}

/** Format a 6-dp base-units amount as a plain dollar/token string, e.g. "12.50". */
export function formatAmount(units: BN): string {
  const unit = Number(PAYOFF_UNIT.toString());
  return (Number(units.toString()) / unit).toFixed(2);
}

/** A short human cost line for the confirmation dialog, e.g. "You'll pay 0.50 USDC". */
export function costSummary(cost: TradeCost): string {
  const verb = cost.asset === "Yes" ? "You'll sell" : "You'll pay up to";
  return `${verb} ${formatAmount(cost.required)} ${cost.asset}`;
}
