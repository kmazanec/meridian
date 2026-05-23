/**
 * Tool: current market (spot) price of a symbol.
 *
 * Two sources, selected by `env.priceSource`:
 *   - "pyth" (default): the latest signed Pyth price via Hermes (price × 10^exponent → USD).
 *   - "synthetic": a deterministic intraday price from the web app's `/api/price` — moving over
 *     the (compressed) session and identical for every bot at the same clock tick. Used in
 *     local/dev so the bots see variability + disagree, instead of one static stale quote.
 *
 * Either way the result is normalized to the same shape (price/confidence/publishTime/
 * ageSeconds) so the model sees no difference. Failures degrade to a clear `available:false`.
 */

import { tool, type StructuredToolInterface } from "@langchain/core/tools";
import { z } from "zod";
import { fetchPriceUpdate, DEFAULT_HERMES_URL } from "@meridian/sdk";
import type { BotContext } from "../context";
import { discoverOpenMarkets, feedIdHex, resolveSymbol } from "../context";
import { round } from "../format";

const schema = z.object({
  symbol: z
    .string()
    .describe(
      "Stock ticker symbol, one of AAPL, MSFT, GOOGL, AMZN, NVDA, META, TSLA."
    ),
});

/** Pyth/Hermes spot price for a symbol, normalized for the LLM. */
async function pythPrice(ctx: BotContext, symbol: string): Promise<string> {
  const ticker = resolveSymbol(symbol);
  const feed = feedIdHex(ctx.config, ticker);
  if (!feed) {
    return JSON.stringify({
      symbol: symbol.toUpperCase(),
      available: false,
      reason: "No real Pyth feed configured for this symbol on this cluster.",
    });
  }
  const hermesUrl = ctx.env.hermesUrl ?? DEFAULT_HERMES_URL;
  const update = await fetchPriceUpdate(feed, hermesUrl);
  const price = Number(update.price) * 10 ** update.exponent;
  const conf = Number(update.conf) * 10 ** update.exponent;
  return JSON.stringify({
    symbol: symbol.toUpperCase(),
    available: true,
    price: round(price, 4),
    confidence: round(conf, 4),
    publishTime: new Date(update.publishTime * 1000).toISOString(),
    ageSeconds: Math.max(0, Math.round(Date.now() / 1000 - update.publishTime)),
  });
}

/**
 * Synthetic deterministic intraday price from `{WEB_BASE_URL}/api/price`. Needs the symbol's
 * trading-day (the synthetic session ends at that market's close); we take it from a currently
 * open market for the symbol. Degrades to `available:false` on any miss.
 */
async function syntheticPrice(
  ctx: BotContext,
  symbol: string
): Promise<string> {
  const sym = symbol.toUpperCase();
  const base = ctx.env.webBaseUrl;
  if (!base) {
    return JSON.stringify({
      symbol: sym,
      available: false,
      reason: "PRICE_SOURCE=synthetic but WEB_BASE_URL is not set.",
    });
  }
  // The synthetic clock runs to a market's close; use an open market for this symbol.
  const markets = await discoverOpenMarkets(ctx.chain.program);
  const market = markets.find((m) => m.symbol === sym);
  if (!market) {
    return JSON.stringify({
      symbol: sym,
      available: false,
      reason: "No open market for this symbol to anchor the synthetic session.",
    });
  }
  const tradingDay = market.tradingDay.toNumber();
  const url =
    `${base.replace(/\/$/, "")}/api/price?symbol=${encodeURIComponent(sym)}` +
    `&tradingDay=${tradingDay}`;
  try {
    const res = await fetch(url, { headers: { accept: "application/json" } });
    if (!res.ok) {
      return JSON.stringify({
        symbol: sym,
        available: false,
        reason: `synthetic price endpoint returned HTTP ${res.status}.`,
      });
    }
    const body = (await res.json()) as {
      price?: number;
      pctFromOpen?: number;
      progress?: number;
      asOf?: string;
    };
    if (typeof body.price !== "number") {
      return JSON.stringify({
        symbol: sym,
        available: false,
        reason: "synthetic price endpoint returned no price.",
      });
    }
    return JSON.stringify({
      symbol: sym,
      available: true,
      price: round(body.price, 4),
      confidence: 0,
      publishTime: body.asOf ?? new Date().toISOString(),
      ageSeconds: 0,
      // Extra context the model can use: where we are in the session and move from open.
      pctFromOpen: body.pctFromOpen,
      sessionProgress: body.progress,
    });
  } catch (err) {
    return JSON.stringify({
      symbol: sym,
      available: false,
      reason: `could not reach the synthetic price endpoint: ${
        err instanceof Error ? err.message : String(err)
      }`,
    });
  }
}

export function makeMarketPriceTool(ctx: BotContext): StructuredToolInterface {
  return tool(
    async ({ symbol }) =>
      ctx.env.priceSource === "synthetic"
        ? syntheticPrice(ctx, symbol)
        : pythPrice(ctx, symbol),
    {
      name: "get_market_price",
      description:
        "Get the current spot price (in USD) of a stock symbol, with how stale the quote is. " +
        "The price moves through the trading session.",
      schema,
    }
  );
}
