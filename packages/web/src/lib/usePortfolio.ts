"use client";

import { useEffect, useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import {
  dualBook,
  fetchMarket,
  fetchOrderBook,
  fetchUserPosition,
} from "@meridian/sdk";
import { useProgram } from "./useProgram";
import { useMarkets, useUsdcMint } from "./useChain";
import { priceFromBook } from "./market-math";
import { loadBasis, type CostBasis } from "./tradeStore";
import { buildPortfolio, type Holding, type PortfolioRow } from "./portfolio";
import BN from "bn.js";

/**
 * Gather the connected wallet's holdings across all discovered markets and fold them
 * into portfolio rows. For each market the user touches we read their Yes/No balance
 * and (for open markets) the book mark; settled markets use their on-chain outcome.
 * Cost basis comes from the local store.
 */
export function usePortfolio(): {
  rows: PortfolioRow[];
  loading: boolean;
  refresh: () => void;
} {
  const program = useProgram();
  const { connection } = useConnection();
  const { publicKey } = useWallet();
  const usdcMint = useUsdcMint();
  const { data: markets } = useMarkets();
  const [rows, setRows] = useState<PortfolioRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [tick, setTick] = useState(0);

  const refresh = () => setTick((t) => t + 1);

  const marketsKey = (markets ?? []).map((m) => m.address.toBase58()).join(",");

  useEffect(() => {
    if (!publicKey || !usdcMint || !markets || markets.length === 0) {
      setRows([]);
      return;
    }
    let cancelled = false;
    setLoading(true);

    (async () => {
      const basis: Map<string, CostBasis> = loadBasis(publicKey.toBase58());
      const holdings: Holding[] = [];

      for (const dm of markets) {
        const market = await fetchMarket(program, dm.address);
        if (!market) continue;
        const pos = await fetchUserPosition(
          connection,
          publicKey,
          market,
          usdcMint
        );
        if (pos.yes.lten(0) && pos.no.lten(0)) continue;

        let yesMark = new BN(500_000);
        if (market.state === "open") {
          const book = await fetchOrderBook(program, dm.address);
          if (book) yesMark = priceFromBook(dualBook(book).yes);
        }

        for (const side of ["yes", "no"] as const) {
          const amount = side === "yes" ? pos.yes : pos.no;
          if (amount.lten(0)) continue;
          holdings.push({
            market: dm.address.toBase58(),
            ticker: market.ticker,
            strike: market.strike,
            side,
            amount,
            state: market.state,
            outcome: market.outcome,
            yesMark,
          });
        }
      }

      if (!cancelled) {
        setRows(buildPortfolio(holdings, basis));
        setLoading(false);
      }
    })().catch(() => {
      if (!cancelled) setLoading(false);
    });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    program,
    connection,
    publicKey?.toBase58(),
    usdcMint?.toBase58(),
    marketsKey,
    tick,
  ]);

  return { rows, loading, refresh };
}
