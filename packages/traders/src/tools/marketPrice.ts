/**
 * Tool: current market (spot) price of a symbol.
 *
 * The platform settles against Pyth, so "the current price of META" is the latest signed
 * Pyth price for META's feed, fetched from Hermes via the SDK. Pyth returns the price in a
 * native scale (`price × 10^exponent`); we normalize to a plain dollar figure for the LLM
 * and also report the publish time + confidence so the model can judge staleness.
 *
 * If the ticker has no real feed configured on-chain (a mock-only devnet bootstrap), we
 * say so plainly rather than inventing a number.
 */

import { tool, type StructuredToolInterface } from "@langchain/core/tools";
import { z } from "zod";
import { fetchPriceUpdate, DEFAULT_HERMES_URL } from "@meridian/sdk";
import type { BotContext } from "../context";
import { feedIdHex, resolveSymbol } from "../context";
import { round } from "../format";

const schema = z.object({
  symbol: z
    .string()
    .describe(
      "Stock ticker symbol, one of AAPL, MSFT, GOOGL, AMZN, NVDA, META, TSLA."
    ),
});

export function makeMarketPriceTool(ctx: BotContext): StructuredToolInterface {
  return tool(
    async ({ symbol }) => {
      const ticker = resolveSymbol(symbol);
      const feed = feedIdHex(ctx.config, ticker);
      if (!feed) {
        return JSON.stringify({
          symbol: symbol.toUpperCase(),
          available: false,
          reason:
            "No real Pyth feed configured for this symbol on this cluster.",
        });
      }
      const hermesUrl = ctx.env.hermesUrl ?? DEFAULT_HERMES_URL;
      const update = await fetchPriceUpdate(feed, hermesUrl);
      // price × 10^exponent → dollars (exponent is negative for equities/crypto).
      const price = Number(update.price) * 10 ** update.exponent;
      const conf = Number(update.conf) * 10 ** update.exponent;
      return JSON.stringify({
        symbol: symbol.toUpperCase(),
        available: true,
        price: round(price, 4),
        confidence: round(conf, 4),
        publishTime: new Date(update.publishTime * 1000).toISOString(),
        ageSeconds: Math.max(
          0,
          Math.round(Date.now() / 1000 - update.publishTime)
        ),
      });
    },
    {
      name: "get_market_price",
      description:
        "Get the current spot price (in USD) of a stock symbol from the Pyth oracle, " +
        "with its confidence interval and how stale the quote is.",
      schema,
    }
  );
}
