"use client";

import { useEffect, useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";

/**
 * The connected wallet's native SOL balance, in lamports. SOL is what pays the network fee on
 * every signed action, so showing it on the portfolio answers "can I keep trading?" at a glance.
 * Returns null until known / when disconnected. Polls modestly (mirrors {@link useUsdcBalance})
 * so it tracks fee spend and airdrops without a manual refresh.
 */
export function useSolBalance(): { lamports: number | null; loading: boolean } {
  const { connection } = useConnection();
  const { publicKey } = useWallet();
  const [lamports, setLamports] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!publicKey) {
      setLamports(null);
      return;
    }
    let cancelled = false;

    const pull = () => {
      setLoading(true);
      connection
        .getBalance(publicKey)
        .then((b) => {
          if (!cancelled) setLamports(b);
        })
        .catch(() => {
          if (!cancelled) setLamports(null);
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    };

    pull();
    const id = setInterval(pull, 20_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [connection, publicKey?.toBase58()]);

  return { lamports, loading };
}
