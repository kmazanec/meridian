import BN from "bn.js";
import { complementPrice, TradeAction } from "@meridian/sdk";
import type { TradeFill } from "@/components/trade/TradePanel";
import { recordFill, type FillRecord, type Side } from "./tradeStore";

/**
 * Translate a submitted trade into a cost-basis record for the side it *acquires*:
 *  - BUY_YES / SELL_NO acquire **Yes** at the Yes price;
 *  - BUY_NO acquires **No** at the No price (the price the user entered).
 * SELL_YES is an exit (reduces Yes) and isn't recorded as a new entry. The store keeps
 * a size-weighted average; selling-down isn't modeled (P&L basis is best-effort/display).
 *
 * Returns the record written, or null for actions that don't open a position.
 */
export function fillToRecord(
  market: string,
  fill: TradeFill
): FillRecord | null {
  let side: Side;
  let price: BN;
  switch (fill.action) {
    case TradeAction.BuyYes:
    case TradeAction.SellNo:
      side = "yes";
      // SELL_NO buys Yes at 1 − noPrice; BUY_YES is the Yes price directly.
      price =
        fill.action === TradeAction.SellNo
          ? complementPrice(fill.price)
          : fill.price;
      break;
    case TradeAction.BuyNo:
      side = "no";
      price = fill.price; // entered in the No perspective
      break;
    case TradeAction.SellYes:
      return null; // an exit, not a new entry
  }
  return {
    market,
    side,
    size: fill.size.toString(),
    price: price.toString(),
    ts: Date.now(),
  };
}

/** Record a submitted trade's cost basis for a wallet (no-op for pure exits). */
export function recordTradeFill(
  wallet: string,
  market: string,
  fill: TradeFill
): void {
  const rec = fillToRecord(market, fill);
  if (rec) recordFill(wallet, rec);
}
