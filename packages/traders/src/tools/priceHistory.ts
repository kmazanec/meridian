/**
 * Tool: last 7 days of closing prices for a symbol.
 *
 * The platform's dashboard exposes a price-history API at `GET /api/history` (built
 * separately for the History page). This tool consumes it so the bots get the *same* daily
 * closes the UI shows. That endpoint is not on `main` yet, so this tool is written to
 * degrade gracefully: if `WEB_BASE_URL` is unset, the endpoint 404s, or the response can't
 * be parsed, the tool returns `{ available: false, reason }` — the agent then keeps
 * trading on spot price + the order book rather than crashing or, worse, treating made-up
 * numbers as real history.
 *
 * Response shape is parsed leniently: we accept either a bare array of
 * `{ date, close }` or an object wrapping one under `closes`/`history`/`data`.
 */

import { tool, type StructuredToolInterface } from "@langchain/core/tools";
import { z } from "zod";
import type { BotContext } from "../context";
import { resolveSymbol } from "../context";
import { round } from "../format";

const schema = z.object({
  symbol: z
    .string()
    .describe(
      "Stock ticker symbol, one of AAPL, MSFT, GOOGL, AMZN, NVDA, META, TSLA."
    ),
});

interface Close {
  date: string;
  close: number;
}

/** Pull a `{date, close}[]` out of whatever shape the endpoint returns, or null. */
function extractCloses(body: unknown): Close[] | null {
  const arr = Array.isArray(body)
    ? body
    : (body as Record<string, unknown> | null)?.closes ??
      (body as Record<string, unknown> | null)?.history ??
      (body as Record<string, unknown> | null)?.data;
  if (!Array.isArray(arr)) return null;
  const out: Close[] = [];
  for (const row of arr) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const date = r.date ?? r.day ?? r.t;
    const close = r.close ?? r.c ?? r.price;
    if (date == null || close == null) continue;
    const n = Number(close);
    if (!Number.isFinite(n)) continue;
    out.push({ date: String(date), close: round(n, 4) });
  }
  return out.length ? out : null;
}

export function makePriceHistoryTool(ctx: BotContext): StructuredToolInterface {
  return tool(
    async ({ symbol }) => {
      resolveSymbol(symbol); // validates the symbol; throws if unsupported
      const base = ctx.env.webBaseUrl;
      if (!base) {
        return JSON.stringify({
          symbol: symbol.toUpperCase(),
          available: false,
          reason:
            "WEB_BASE_URL is not configured, so the /api/history endpoint can't be reached.",
        });
      }
      const url = `${base.replace(
        /\/$/,
        ""
      )}/api/history?symbol=${encodeURIComponent(symbol.toUpperCase())}`;
      try {
        const res = await fetch(url, {
          headers: { accept: "application/json" },
        });
        if (!res.ok) {
          return JSON.stringify({
            symbol: symbol.toUpperCase(),
            available: false,
            reason: `History endpoint returned HTTP ${res.status}.`,
          });
        }
        const closes = extractCloses(await res.json());
        if (!closes) {
          return JSON.stringify({
            symbol: symbol.toUpperCase(),
            available: false,
            reason:
              "History endpoint response had no recognizable closing prices.",
          });
        }
        return JSON.stringify({
          symbol: symbol.toUpperCase(),
          available: true,
          closes: closes.slice(-7),
        });
      } catch (err) {
        return JSON.stringify({
          symbol: symbol.toUpperCase(),
          available: false,
          reason: `Could not reach the history endpoint: ${
            err instanceof Error ? err.message : String(err)
          }`,
        });
      }
    },
    {
      name: "get_price_history",
      description:
        "Get up to the last 7 daily closing prices (USD) for a stock symbol. May be " +
        "unavailable; if so, the result says available:false and you should rely on the " +
        "current spot price and order book instead.",
      schema,
    }
  );
}

export { extractCloses };
