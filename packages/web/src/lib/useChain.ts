"use client";

import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import {
  fetchMarket,
  fetchUserPosition,
  type ConfigAccount,
  type MarketAccount,
  type UserPosition,
} from "@meridian/sdk";
import { usePolled, type AsyncResource } from "./usePolled";
import { useProgram } from "./useProgram";
import { configuredUsdcMint } from "./env";
import { useChainData } from "./ChainDataProvider";
import type { DiscoveredMarket } from "./discovery";
import type { BookMap } from "./marketStats";

/**
 * The shared reads below — Config, USDC mint, all markets, all order books — are polled
 * **once app-wide** by {@link ChainDataProvider}. These hooks just read that context, so
 * any number of components/pages share a single poll (no per-caller fan-out, which is what
 * was tripping the devnet rate limit). Per-instance reads (`useMarket`,
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
