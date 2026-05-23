"use client";

import { useCallback, useEffect, useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import {
  fetchMarket,
  fetchOrderBook,
  fetchUserPosition,
  type ConfigAccount,
  type MarketAccount,
  type OrderBookAccount,
  type UserPosition,
} from "@meridian/sdk";
import { useProgram } from "./useProgram";
import { configuredUsdcMint } from "./env";
import { useChainData } from "./ChainDataProvider";
import type { DiscoveredMarket } from "./discovery";
import type { BookMap } from "./marketStats";

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
 *
 * Contract: `load` is intentionally NOT in the effect deps (it's an inline closure that
 * changes every render). Callers MUST list in `deps` every value `load` closes over that
 * can change (the program, the market key, etc.) — each caller below does. A `load` that
 * closes over an un-listed mutable value would read it stale; that's the price of not
 * re-subscribing on every render.
 */
export function usePolled<T>(
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
  // Pauses while the tab is hidden (no point polling an unseen page — and it sharply cuts
  // RPC load, which matters on the rate-limited public devnet endpoint) and does one
  // immediate refresh when the tab becomes visible again so the data isn't stale on return.
  useEffect(() => {
    if (!enabled || pollMs <= 0) return;
    let id: ReturnType<typeof setInterval> | undefined;
    const start = () => {
      if (id === undefined)
        id = setInterval(() => setTick((t) => t + 1), pollMs);
    };
    const stop = () => {
      if (id !== undefined) {
        clearInterval(id);
        id = undefined;
      }
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        setTick((t) => t + 1); // refresh immediately on return
        start();
      } else {
        stop();
      }
    };
    if (document.visibilityState === "visible") start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [enabled, pollMs]);

  return { data, loading, error, refresh };
}

/**
 * The shared reads below — Config, USDC mint, all markets, all order books — are polled
 * **once app-wide** by {@link ChainDataProvider}. These hooks just read that context, so
 * any number of components/pages share a single poll (no per-caller fan-out, which is what
 * was tripping the devnet rate limit). Per-instance reads (`useMarket`, `useOrderBook`,
 * `useUserPosition`) below keep their own `usePolled` — they're correctly scoped, not
 * app-wide.
 */

/** The singleton on-chain Config (admin, USDC mint, ticker feed ids) — from the store. */
export function useConfig(): AsyncResource<ConfigAccount> {
  return useChainData().config;
}

/**
 * The effective USDC mint: prefer on-chain `Config.usdcMint`, fall back to the env
 * bootstrap. Returns null until either resolves.
 */
export function useUsdcMint(): PublicKey | null {
  const { data: config } = useConfig();
  return config?.usdcMint ?? configuredUsdcMint();
}

/** All markets (one shared getProgramAccounts poll) — from the store. */
export function useMarkets(): AsyncResource<DiscoveredMarket[]> {
  return useChainData().markets;
}

/** Every market's order book (one shared getProgramAccounts poll) — from the store. */
export function useAllBooks(): AsyncResource<BookMap> {
  return useChainData().allBooks;
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

/**
 * The raw order book for a market. Callers derive the dual-perspective view with the
 * SDK's pure `dualBook` (cheap) and use the raw book for crossing/maker computation —
 * one fetch serves both. Polls fast (the trading surface).
 */
export function useOrderBook(
  market: PublicKey | null
): AsyncResource<OrderBookAccount> {
  const program = useProgram();
  return usePolled(
    () =>
      market
        ? fetchOrderBook(program, market)
        : Promise.resolve<OrderBookAccount | null>(null),
    [program, market?.toBase58()],
    { enabled: !!market, pollMs: 12_000 }
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
    { enabled, pollMs: 12_000 }
  );
}
