/**
 * Tool: current order-book prices for our strikes.
 *
 * For each open strike (or one symbol's strikes), report the live top of book in both Yes
 * and No perspectives: best bid, best ask, mid, and resting depth. The mid is the
 * market-implied probability — Yes mid ≈ P(close ≥ strike), No mid ≈ P(close < strike) —
 * which is exactly what the agent compares against its own view (from spot + history) to
 * find an edge. Prices are in [0, 1] dollars per token.
 */

import { tool, type StructuredToolInterface } from "@langchain/core/tools";
import { z } from "zod";
import { fetchOrderBook } from "@meridian/sdk";
import type { BotContext } from "../context";
import { discoverOpenMarkets } from "../context";
import { summarizeBook } from "../book";
import { unitsToAmount, round } from "../format";

const schema = z.object({
  symbol: z
    .string()
    .nullable()
    .optional()
    .describe(
      "Optional: restrict to one symbol (e.g. NVDA). Omit (or null) to price all strikes."
    ),
});

export function makeStrikePricesTool(ctx: BotContext): StructuredToolInterface {
  return tool(
    async ({ symbol }) => {
      const wanted = symbol?.toUpperCase();
      const markets = await discoverOpenMarkets(ctx.chain.program);
      const filtered = wanted
        ? markets.filter((m) => m.symbol === wanted)
        : markets;

      const quotes = [];
      for (const m of filtered) {
        const book = await fetchOrderBook(ctx.chain.program, m.address);
        const { yes, no } = summarizeBook(book);
        quotes.push({
          symbol: m.symbol,
          strike: round(unitsToAmount(m.strike), 2),
          market: m.address.toBase58(),
          yes,
          no,
        });
      }
      return JSON.stringify({ count: quotes.length, quotes });
    },
    {
      name: "get_strike_prices",
      description:
        "Get current order-book prices for open strikes: best bid/ask, mid (the " +
        "market-implied probability), and depth — for both the Yes and No side. Use the " +
        "mid to compare the market's view against your own.",
      schema,
    }
  );
}
