import type BN from "bn.js";
import type { TradeAction } from "@meridian/sdk";

/**
 * What a submitted trade reports back, for display-only cost-basis tracking
 * (see {@link recordTradeFill}). Shared by the trade modal (which produces it)
 * and the page (which records it) without coupling either to a component file.
 */
export interface TradeFill {
  action: TradeAction;
  /** The price in the action's own perspective (Yes price / No price). */
  price: BN;
  /** Size in token base units. */
  size: BN;
}
