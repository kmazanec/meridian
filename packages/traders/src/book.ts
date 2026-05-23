/**
 * Order-book summarization shared by the strike-prices tool and the place-order tool.
 *
 * The program keeps one book per market (Yes vs USDC); `dualBook` from the SDK projects it
 * into both Yes and No perspectives. For the LLM we collapse each side to its top of book —
 * best bid, best ask, and the mid — expressed as probabilities/dollars in [0, 1]. The mid
 * IS the market-implied probability that the stock closes ≥ the strike (Yes) or < it (No).
 */

import { dualBook, type BookView, type OrderBookAccount } from "@meridian/sdk";
import { priceToProb, unitsToAmount, round } from "./format";

/** Top-of-book summary for one perspective (prices as probabilities in [0,1]). */
export interface SideSummary {
  bestBid: number | null;
  bestAsk: number | null;
  mid: number | null;
  bidDepth: number;
  askDepth: number;
}

function summarizeView(view: BookView): SideSummary {
  const bestBid = view.bids[0] ? priceToProb(view.bids[0].price) : null;
  const bestAsk = view.asks[0] ? priceToProb(view.asks[0].price) : null;
  const mid =
    bestBid !== null && bestAsk !== null
      ? round((bestBid + bestAsk) / 2)
      : bestBid ?? bestAsk;
  const depth = (levels: BookView["bids"]): number =>
    round(levels.reduce((sum, l) => sum + unitsToAmount(l.size), 0));
  return {
    bestBid: bestBid === null ? null : round(bestBid),
    bestAsk: bestAsk === null ? null : round(bestAsk),
    mid: mid === null ? null : round(mid),
    bidDepth: depth(view.bids),
    askDepth: depth(view.asks),
  };
}

/** Summarize a book into both Yes and No top-of-book views; null book = empty book. */
export function summarizeBook(book: OrderBookAccount | null): {
  yes: SideSummary;
  no: SideSummary;
} {
  const empty: SideSummary = {
    bestBid: null,
    bestAsk: null,
    mid: null,
    bidDepth: 0,
    askDepth: 0,
  };
  if (!book) return { yes: empty, no: empty };
  const dual = dualBook(book);
  return { yes: summarizeView(dual.yes), no: summarizeView(dual.no) };
}
