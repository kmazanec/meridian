"use client";

import { fetchAllOrderBooks } from "@meridian/sdk";
import { useProgram } from "./useProgram";
import { usePolled, type AsyncResource } from "./useChain";
import type { BookMap } from "./marketStats";

/**
 * Every market's order book in one batched `getProgramAccounts`, keyed by the order
 * book's account address. This is the linchpin of the Markets-page strike ladder: it
 * provides prices/spread/depth/resting-size for *every* strike across all 7 tickers in a
 * single RPC call (joined to markets via `Market.orderBook`), instead of fetching one
 * book per strike. Polls on the same cadence as the single-book trade hook.
 */
export function useAllBooks(): AsyncResource<BookMap> {
  const program = useProgram();
  return usePolled(() => fetchAllOrderBooks(program), [program], {
    pollMs: 12_000,
  });
}
