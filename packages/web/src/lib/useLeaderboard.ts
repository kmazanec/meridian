"use client";

import { useConnection } from "@solana/wallet-adapter-react";
import { useProgram } from "./useProgram";
import { usePolled, type AsyncResource } from "./useChain";
import { useChainData, useUsdcMintFromConfig } from "./ChainDataProvider";
import { loadLeaderboardInputs } from "./leaderboardData";
import { foldLeaderboard, type LeaderboardRow } from "./leaderboard";

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
