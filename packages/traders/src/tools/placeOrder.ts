/**
 * Tool: place an order — any of the four actions, limit or market.
 *
 * This is the agent's only write tool. It maps the four user-facing actions onto the single
 * Yes-vs-USDC book via the SDK's `buildTradeIntent` (BUY_YES/SELL_YES/BUY_NO/SELL_NO), so
 * the bots never re-derive the on-chain encoding. The flow:
 *
 *   1. Resolve the market from symbol+strike (or an explicit address).
 *   2. Validate price ∈ [0,1] and size > 0 *before* building anything, so a bad ask never
 *      becomes a transaction.
 *   3. Compute the Yes-book side+price the action reduces to, read the live book, and from
 *      it compute the maker accounts needed to cross (for marketable orders).
 *   4. Build the intent's instructions and send them as one transaction.
 *
 * Prices the LLM speaks are in the action's *own* perspective (the Yes price for YES
 * actions, the No price for NO actions), as a probability/dollar value in [0,1] — matching
 * how `get_strike_prices` reports mids.
 *
 * On any failure (insufficient funds, no liquidity, program error) the tool returns a
 * structured error string instead of throwing, so the agent can read it and adjust rather
 * than the trading loop dying. With DRY_RUN set, it reports what it *would* do and stops.
 */

import { tool, type StructuredToolInterface } from "@langchain/core/tools";
import { z } from "zod";
import BN from "bn.js";
import {
  OrderSide,
  PRICE_SCALE,
  TradeAction,
  buildTradeIntent,
  fetchMarket,
  fetchOrderBook,
} from "@meridian/sdk";
import type { BotContext } from "../context";
import { discoverOpenMarkets } from "../context";
import { makerAccountsFor } from "../crossing";
import { amountToUnits, probToPrice, unitsToAmount, round } from "../format";

const schema = z.object({
  symbol: z
    .string()
    .describe("Stock ticker symbol of the strike to trade (e.g. META)."),
  strike: z
    .number()
    .describe(
      "Strike price in USD of the market to trade (must match an open strike)."
    ),
  action: z
    .enum(["BUY_YES", "SELL_YES", "BUY_NO", "SELL_NO"])
    .describe(
      "BUY_YES / SELL_YES bet on (or close) the stock closing >= strike; " +
        "BUY_NO / SELL_NO bet on (or close) it closing < strike."
    ),
  price: z
    .number()
    .min(0)
    .max(1)
    .describe(
      "Limit price as a probability in [0,1] in this action's own perspective " +
        "(Yes price for YES actions, No price for NO actions). Ignored if isMarket=true."
    ),
  size: z
    .number()
    .positive()
    .describe(
      "Order size in whole/fractional tokens (e.g. 10 = 10 contracts)."
    ),
  isMarket: z
    .boolean()
    .optional()
    .describe("If true, cross at any price (fill-or-cancel the remainder)."),
});

/** The Yes-book side + price an action reduces to (for crossing). Mirrors intent.ts. */
function yesLeg(
  action: TradeAction,
  price: BN
): { side: OrderSide; yesPrice: BN } {
  switch (action) {
    case TradeAction.BuyYes:
      return { side: OrderSide.Bid, yesPrice: price };
    case TradeAction.SellYes:
      return { side: OrderSide.Ask, yesPrice: price };
    case TradeAction.BuyNo:
      // mint pair, sell the Yes at 1 - noPrice (an ask).
      return { side: OrderSide.Ask, yesPrice: PRICE_SCALE.sub(price) };
    case TradeAction.SellNo:
      // buy Yes at 1 - noPrice (a bid).
      return { side: OrderSide.Bid, yesPrice: PRICE_SCALE.sub(price) };
  }
}

export function makePlaceOrderTool(ctx: BotContext): StructuredToolInterface {
  return tool(
    async ({ symbol, strike, action, price, size, isMarket }) => {
      const { chain, usdcMint, log } = ctx;
      try {
        // 1. Resolve the market by symbol + strike (nearest-cent match).
        const wanted = symbol.toUpperCase();
        const strikeUnits = amountToUnits(strike);
        const markets = await discoverOpenMarkets(chain.program);
        const match = markets.find(
          (m) => m.symbol === wanted && m.strike.eq(strikeUnits)
        );
        if (!match) {
          const avail = markets
            .filter((m) => m.symbol === wanted)
            .map((m) => round(unitsToAmount(m.strike), 2));
          return JSON.stringify({
            ok: false,
            error: `No open ${wanted} market at strike $${strike}.`,
            availableStrikes: avail,
          });
        }

        // 2. Validate price/size before building anything.
        if (size <= 0) {
          return JSON.stringify({ ok: false, error: "size must be positive." });
        }
        if (!isMarket && (price < 0 || price > 1)) {
          return JSON.stringify({
            ok: false,
            error: "price must be a probability in [0,1].",
          });
        }
        const sizeUnits = amountToUnits(size);
        const priceUnits = probToPrice(price);
        const act = action as TradeAction;

        // 3. Compute maker accounts for crossing from the live book.
        const book = await fetchOrderBook(chain.program, match.address);
        const market = await fetchMarket(chain.program, match.address);
        if (!market) {
          return JSON.stringify({
            ok: false,
            error: "Market account not found.",
          });
        }
        const { side, yesPrice } = yesLeg(act, priceUnits);
        const makerAccounts = book
          ? makerAccountsFor({
              book,
              side,
              price: yesPrice,
              size: sizeUnits,
              isMarket: isMarket ?? false,
              usdcMint,
              yesMint: market.yesMint,
            })
          : [];

        // 4. Build the four-button intent and (unless dry-run) send it.
        const built = await buildTradeIntent(chain.program, chain.pubkey, {
          market: match.address,
          action: act,
          price: priceUnits,
          size: sizeUnits,
          isMarket: isMarket ?? false,
          usdcMint,
          makerAccounts,
        });

        if (ctx.env.dryRun) {
          log.trade(
            `DRY RUN — would ${action} ${size} ${wanted} @${strike} ${price}`,
            {
              market: match.address.toBase58(),
              isMarket: isMarket ?? false,
              makers: makerAccounts.length,
            }
          );
          return JSON.stringify({
            ok: true,
            dryRun: true,
            action,
            symbol: wanted,
            strike,
            size,
            price: isMarket ? "market" : price,
            crossedMakers: makerAccounts.length,
          });
        }

        const signature = await chain.send(built.instructions);
        log.trade(
          `${action} ${size} ${wanted} @${strike} (${
            isMarket ? "market" : price
          })`,
          {
            sig: signature,
            makers: makerAccounts.length,
          }
        );
        return JSON.stringify({
          ok: true,
          signature,
          action,
          symbol: wanted,
          strike,
          size,
          price: isMarket ? "market" : price,
          crossedMakers: makerAccounts.length,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        log.warn(`order failed: ${message}`, { action, symbol, strike });
        return JSON.stringify({ ok: false, error: message });
      }
    },
    {
      name: "place_order",
      description:
        "Place a trade on a strike market. action is one of BUY_YES, SELL_YES, BUY_NO, " +
        "SELL_NO. price is a probability in [0,1] in the action's own perspective (ignored " +
        "for market orders). size is in tokens. Returns the transaction signature, or an " +
        "error you can read and react to.",
      schema,
    }
  );
}

export { yesLeg };
