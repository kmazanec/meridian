"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import { PublicKey } from "@solana/web3.js";
import {
  fetchAllOrderBooks,
  fetchConfig,
  type ConfigAccount,
} from "@meridian/sdk";
import { useProgram } from "./useProgram";
import { usePolled, type AsyncResource } from "./useChain";
import { discoverMarkets, type DiscoveredMarket } from "./discovery";
import { configuredUsdcMint } from "./env";
import type { BookMap } from "./marketStats";

/**
 * The app-wide chain-data store. The broad reads every page shares — all markets, all order
 * books, and the singleton Config — are polled **once here** (not per component) and handed
 * out through context. Before this, each `useMarkets()`/`useConfig()` call span its own poll,
 * and the landing page fanned out one book fetch per ticker; that duplicate load tripped the
 * public devnet rate limit. Mount this once (in Providers) and read via the hooks in
 * `useChain.ts`, which now just consume this context.
 *
 * Genuinely per-instance reads (a selected strike's user position) stay local — only the
 * shared, identical-across-the-app reads are centralized.
 */

interface ChainData {
  markets: AsyncResource<DiscoveredMarket[]>;
  allBooks: AsyncResource<BookMap>;
  config: AsyncResource<ConfigAccount>;
  /** Re-poll every shared resource (e.g. immediately after a trade confirms). */
  refreshAll: () => void;
}

const ChainDataContext = createContext<ChainData | null>(null);

export function ChainDataProvider({ children }: { children: ReactNode }) {
  const program = useProgram();

  // getProgramAccounts is the heaviest call → poll slowly; books are the trading surface →
  // faster; config rarely changes → slowest. (Cadences match the pre-centralization hooks.)
  const markets = usePolled(() => discoverMarkets(program), [program], {
    pollMs: 45_000,
  });
  const allBooks = usePolled(() => fetchAllOrderBooks(program), [program], {
    pollMs: 12_000,
  });
  const config = usePolled(() => fetchConfig(program), [program], {
    pollMs: 60_000,
  });

  const value = useMemo<ChainData>(
    () => ({
      markets,
      allBooks,
      config,
      refreshAll: () => {
        markets.refresh();
        allBooks.refresh();
        config.refresh();
      },
    }),
    [markets, allBooks, config]
  );

  return (
    <ChainDataContext.Provider value={value}>
      {children}
    </ChainDataContext.Provider>
  );
}

/** Read the shared chain-data store. Throws if used outside the provider. */
export function useChainData(): ChainData {
  const ctx = useContext(ChainDataContext);
  if (!ctx) {
    throw new Error("useChainData must be used within a ChainDataProvider");
  }
  return ctx;
}

/** The effective USDC mint: on-chain `Config.usdcMint`, else the env bootstrap. */
export function useUsdcMintFromConfig(
  config: ConfigAccount | null
): PublicKey | null {
  return config?.usdcMint ?? configuredUsdcMint();
}
