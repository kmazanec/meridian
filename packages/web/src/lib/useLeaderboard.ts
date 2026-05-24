"use client";

import { useConnection } from "@solana/wallet-adapter-react";
import { dualBook } from "@meridian/sdk";
import { useProgram } from "./useProgram";
import { usePolled, type AsyncResource } from "./useChain";
import { useChainData, useUsdcMintFromConfig } from "./ChainDataProvider";
import { loadLeaderboardInputs, loadMarketHolders } from "./leaderboardData";
import {
  foldLeaderboard,
  foldMarketDrilldown,
  type LeaderboardRow,
  type MarketDrilldownView,
} from "./leaderboard";
import { bookStats, yesMarkFor } from "./marketStats";
import type { DiscoveredMarket } from "./discovery";

/**
 * The admin market-wide leaderboard, computed lazily. Reuses the shared markets/books polls
 * from ChainDataProvider (free) and only does the new holder/balance RPC when `enabled` (the
 * admin opened the panel). Slow poll: this is observability, not a trading surface, and the
 * discovery calls are the heaviest reads in the app.
 */
const LEADERBOARD_POLL_MS = 30_000;

export function useLeaderboard(enabled: boolean): AsyncResource<LeaderboardRow[]> {
  const program = useProgram();
  const { connection } = useConnection();
  const { markets, allBooks, config } = useChainData();
  const usdcMint = useUsdcMintFromConfig(config.data);

  // Ready only once the shared inputs and the mint have loaded.
  const ready =
    enabled && !!markets.data && !!allBooks.data && !!usdcMint;

  return usePolled<LeaderboardRow[]>(
    async () => {
      const inputs = await loadLeaderboardInputs({
        program,
        connection,
        markets: markets.data!,
        books: allBooks.data!,
        usdcMint: usdcMint!,
      });
      return foldLeaderboard(inputs);
    },
    [program, connection, markets.data, allBooks.data, usdcMint],
    { pollMs: LEADERBOARD_POLL_MS, enabled: ready }
  );
}

/**
 * Per-market drilldown: the market's top holders (fetched on expand) + book depth (from the
 * cached BookMap, no extra RPC). `market` null → disabled (nothing expanded).
 */
export function useMarketDrilldown(
  market: DiscoveredMarket | null
): AsyncResource<MarketDrilldownView> {
  const program = useProgram();
  const { connection } = useConnection();
  const { allBooks } = useChainData();

  return usePolled<MarketDrilldownView>(
    async () => {
      const m = market!;
      const holders = await loadMarketHolders({ program, connection, market: m });
      const book = allBooks.data?.get(m.orderBook.toBase58());
      const yesView = book ? dualBook(book).yes : { bids: [], asks: [] };
      const stats = bookStats(yesView);
      const yesMark = allBooks.data ? yesMarkFor(m, allBooks.data) : null;
      return foldMarketDrilldown(m, holders, yesMark, {
        bestBid: stats.bestBid,
        bestAsk: stats.bestAsk,
        restingSize: stats.restingSize,
      });
    },
    [program, connection, market?.address.toBase58(), allBooks.data],
    { pollMs: LEADERBOARD_POLL_MS, enabled: !!market }
  );
}
