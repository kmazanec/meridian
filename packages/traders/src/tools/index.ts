/**
 * Assemble the agent's full tool belt for one bot context.
 *
 * Six tools, matching the bot's required capabilities: current price, 7-day closes, wallet
 * balance, the full list of strikes, current strike (book) prices, and placing orders.
 */

import type { StructuredToolInterface } from "@langchain/core/tools";
import type { BotContext } from "../context";
import { makeMarketPriceTool } from "./marketPrice";
import { makePriceHistoryTool } from "./priceHistory";
import { makeWalletBalanceTool } from "./walletBalance";
import { makeListStrikesTool } from "./listStrikes";
import { makeStrikePricesTool } from "./strikePrices";
import { makePlaceOrderTool } from "./placeOrder";

/** Build all six tools bound to a bot context, ready to bind to the model. */
export function makeTools(ctx: BotContext): StructuredToolInterface[] {
  return [
    makeMarketPriceTool(ctx),
    makePriceHistoryTool(ctx),
    makeWalletBalanceTool(ctx),
    makeListStrikesTool(ctx),
    makeStrikePricesTool(ctx),
    makePlaceOrderTool(ctx),
  ];
}
