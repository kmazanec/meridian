"use client";

import { useCallback, useEffect, useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import {
  dualBook,
  fetchConfig,
  fetchMarket,
  fetchOrderBook,
  fetchUserPosition,
  type ConfigAccount,
  type DualBook,
  type MarketAccount,
  type UserPosition,
} from "@meridian/sdk";
import { useProgram } from "./useProgram";
import { configuredUsdcMint } from "./env";
import { discoverMarkets, type DiscoveredMarket } from "./discovery";

/** Standard async-resource state for the read hooks. */
export interface AsyncResource<T> {
  data: T | null;
  loading: boolean;
  error: Error | null;
  /** Manually re-fetch (also invoked by the poll interval). */
  refresh: () => void;
}

const DEFAULT_POLL_MS = 8_000;

/**
 * Generic polling resource. Runs `load` immediately and every `pollMs`, tracking
 * loading/error and exposing a manual `refresh`. `deps` controls re-subscription;
 * `enabled` short-circuits when inputs aren't ready (e.g. no wallet).
 */
function usePolled<T>(
  load: () => Promise<T | null>,
  deps: React.DependencyList,
  {
    pollMs = DEFAULT_POLL_MS,
    enabled = true,
  }: { pollMs?: number; enabled?: boolean } = {}
): AsyncResource<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<Error | null>(null);
  const [tick, setTick] = useState(0);

  const refresh = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    load()
      .then((d) => {
        if (!cancelled) {
          setData(d);
          setError(null);
        }
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e : new Error(String(e)));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick, enabled]);

  // Separate effect drives the poll cadence without re-running load on every render.
  useEffect(() => {
    if (!enabled || pollMs <= 0) return;
    const id = setInterval(() => setTick((t) => t + 1), pollMs);
    return () => clearInterval(id);
  }, [enabled, pollMs]);

  return { data, loading, error, refresh };
}

/** The singleton on-chain Config (admin, USDC mint, ticker feed ids). */
export function useConfig(): AsyncResource<ConfigAccount> {
  const program = useProgram();
  return usePolled(() => fetchConfig(program), [program], {
    pollMs: 60_000,
  });
}

/**
 * The effective USDC mint: prefer on-chain `Config.usdcMint`, fall back to the env
 * bootstrap. Returns null until either resolves.
 */
export function useUsdcMint(): PublicKey | null {
  const { data: config } = useConfig();
  return config?.usdcMint ?? configuredUsdcMint();
}

/** All markets discovered via getProgramAccounts. */
export function useMarkets(): AsyncResource<DiscoveredMarket[]> {
  const program = useProgram();
  return usePolled(() => discoverMarkets(program), [program], {
    pollMs: 30_000,
  });
}

/** One market account by address. */
export function useMarket(
  market: PublicKey | null
): AsyncResource<MarketAccount> {
  const program = useProgram();
  return usePolled(
    () =>
      market
        ? fetchMarket(program, market)
        : Promise.resolve<MarketAccount | null>(null),
    [program, market?.toBase58()],
    { enabled: !!market }
  );
}

/** The dual-perspective order book (Yes + No) for a market. */
export function useOrderBook(
  market: PublicKey | null
): AsyncResource<DualBook> {
  const program = useProgram();
  return usePolled(
    async () => {
      if (!market) return null;
      const book = await fetchOrderBook(program, market);
      return book ? dualBook(book) : null;
    },
    [program, market?.toBase58()],
    { enabled: !!market, pollMs: 5_000 }
  );
}

/** The connected user's USDC/Yes/No balances for a market (null if disconnected). */
export function useUserPosition(
  market: MarketAccount | null
): AsyncResource<UserPosition> {
  const { connection } = useConnection();
  const { publicKey } = useWallet();
  const usdcMint = useUsdcMint();
  const enabled = !!market && !!publicKey && !!usdcMint;
  return usePolled(
    () =>
      enabled
        ? fetchUserPosition(connection, publicKey!, market!, usdcMint!)
        : Promise.resolve<UserPosition | null>(null),
    [
      connection,
      publicKey?.toBase58(),
      market?.yesMint.toBase58(),
      usdcMint?.toBase58(),
    ],
    { enabled, pollMs: 5_000 }
  );
}
