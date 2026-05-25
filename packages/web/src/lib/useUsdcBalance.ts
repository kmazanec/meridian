"use client";

import { useEffect, useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { fetchBalance } from "@meridian/sdk";
import BN from "bn.js";
import { useUsdcMint } from "./useChain";

/** How often to re-read the wallet's USDC balance. */
const BALANCE_POLL_MS = 20_000;

/**
 * The connected wallet's USDC balance (base units, 6dp) — one token-account read against the
 * wallet's USDC associated token account. Returns null until known / when disconnected.
 * Polls modestly so it reflects redemptions and trades without a manual refresh.
 */
export function useUsdcBalance(): { balance: BN | null; loading: boolean } {
  const { connection } = useConnection();
  const { publicKey } = useWallet();
  const usdcMint = useUsdcMint();
  const [balance, setBalance] = useState<BN | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!publicKey || !usdcMint) {
      setBalance(null);
      return;
    }
    let cancelled = false;
    const ata = getAssociatedTokenAddressSync(usdcMint, publicKey, true);

    const pull = () => {
      setLoading(true);
      fetchBalance(connection, ata)
        .then((b) => {
          if (!cancelled) setBalance(b);
        })
        .catch(() => {
          // A missing/unreadable ATA just means no known balance — non-fatal.
          if (!cancelled) setBalance(null);
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    };

    pull();
    const id = setInterval(pull, BALANCE_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [connection, publicKey?.toBase58(), usdcMint?.toBase58()]);

  return { balance, loading };
}
