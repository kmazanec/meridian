/**
 * Tool: list all current (open) strikes.
 *
 * Each open market is one strike of one stock for the current trading day — "will SYMBOL
 * close ≥ STRIKE today?". This tool enumerates them so the agent knows the full menu it can
 * trade, grouped by symbol with the strike in dollars and the market address (which the
 * place-order and strike-price tools reference). Settled markets are excluded — you can't
 * open new positions on them.
 */

import { tool, type StructuredToolInterface } from "@langchain/core/tools";
import { z } from "zod";
import type { BotContext } from "../context";
import { discoverOpenMarkets } from "../context";
import { unitsToAmount, round } from "../format";

const schema = z.object({
  symbol: z
    .string()
    .nullable()
    .optional()
    .describe(
      "Optional: restrict to one symbol (e.g. META). Omit (or null) to list all."
    ),
});

export function makeListStrikesTool(ctx: BotContext): StructuredToolInterface {
  return tool(
    async ({ symbol }) => {
      const wanted = symbol?.toUpperCase();
      const markets = await discoverOpenMarkets(ctx.chain.program);
      const filtered = wanted
        ? markets.filter((m) => m.symbol === wanted)
        : markets;
      const strikes = filtered.map((m) => ({
        symbol: m.symbol,
        strike: round(unitsToAmount(m.strike), 2),
        tradingDay: new Date(m.tradingDay.toNumber() * 1000).toISOString(),
        market: m.address.toBase58(),
      }));
      return JSON.stringify({ count: strikes.length, strikes });
    },
    {
      name: "list_strikes",
      description:
        "List all currently open strike markets (one per stock/strike for today), with " +
        "each strike price in USD and the market address used to price or trade it.",
      schema,
    }
  );
}
