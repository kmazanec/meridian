"use client";

import { useCallback, useEffect, useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import {
  dualBook,
  fetchMarket,
  fetchOrderBook,
  fetchUserPosition,
  fetchRedeemHistory,
  Outcome,
} from "@meridian/sdk";
import { useProgram } from "./useProgram";
import { useMarkets, useUsdcMint } from "./useChain";
import { priceFromBook } from "./market-math";
import { loadBasis, type CostBasis } from "./tradeStore";
import {
  buildPortfolio,
  type Holding,
  type PortfolioRow,
  type RedeemedPosition,
} from "./portfolio";
import BN from "bn.js";

/** How often to re-fold the portfolio so settlement and new fills surface. */
const PORTFOLIO_POLL_MS = 15_000;

/**
 * How many recent signatures to scan when reconstructing claimed winners. The full history
 * lives on the History page; the portfolio only needs the recent slice, so we cap the scan well
 * below `fetchRedeemHistory`'s 1000 default. Each scanned signature costs a `getTransaction`, so
 * a smaller window means a much smaller compute-unit burst against the RPC (Alchemy meters CU/s)
 * — trading complete lifetime recall for a reliable, un-throttled portfolio load.
 */
const PORTFOLIO_REDEEM_SCAN_LIMIT = 120;

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

  const refresh = useCallback(() => setTick((t) => t + 1), []);

  const marketsKey = (markets ?? []).map((m) => m.address.toBase58()).join(",");

  useEffect(() => {
    if (!publicKey || !usdcMint || !markets || markets.length === 0) {
      setRows([]);
      return;
    }
    let cancelled = false;
    setLoading(true);

    // Read each market's account, the user's position, and (for open markets) the book
    // mark — in parallel across markets rather than one market at a time.
    const loadOne = async (
      dm: (typeof markets)[number]
    ): Promise<Holding[]> => {
      const market = await fetchMarket(program, dm.address);
      if (!market) return [];
      const pos = await fetchUserPosition(
        connection,
        publicKey,
        market,
        usdcMint
      );
      if (pos.yes.lten(0) && pos.no.lten(0)) return [];

      let yesMark = new BN(500_000);
      if (market.state === "open") {
        const book = await fetchOrderBook(program, dm.address);
        if (book) yesMark = priceFromBook(dualBook(book).yes);
      }

      const out: Holding[] = [];
      for (const side of ["yes", "no"] as const) {
        const amount = side === "yes" ? pos.yes : pos.no;
        if (amount.lten(0)) continue;
        out.push({
          market: dm.address.toBase58(),
          ticker: market.ticker,
          strike: market.strike,
          side,
          amount,
          state: market.state,
          outcome: market.outcome,
          tradingDay: market.tradingDay,
          yesMark,
        });
      }
      return out;
    };

    // Reconstruct claimed winners from redeem history, joined to the discovered markets for
    // their ticker/strike/day. A winning redeem is the winning side of a settled market, so we
    // derive the side from the market outcome (YesWins → yes, NoWins → no).
    const loadRedeemed = async (): Promise<RedeemedPosition[]> => {
      const byAddr = new Map(markets.map((m) => [m.address.toBase58(), m]));
      const history = await fetchRedeemHistory(connection, program, publicKey, {
        limit: PORTFOLIO_REDEEM_SCAN_LIMIT,
      });
      const out: RedeemedPosition[] = [];
      for (const r of history) {
        if (!r.won) continue; // losers linger in holdings; we only need claimed winners here
        const m = byAddr.get(r.market);
        if (!m || m.outcome === Outcome.Unsettled) continue;
        out.push({
          market: r.market,
          ticker: m.ticker,
          strike: m.strike,
          side: m.outcome === Outcome.YesWins ? "yes" : "no",
          tradingDay: m.tradingDay,
          amount: r.tokensBurned,
          payout: r.usdcPaid,
        });
      }
      return out;
    };

    const load = async () => {
      const basis: Map<string, CostBasis> = loadBasis(publicKey.toBase58());
      const [perMarket, redeemed] = await Promise.all([
        Promise.all(markets.map(loadOne)),
        loadRedeemed().catch(() => [] as RedeemedPosition[]),
      ]);
      if (cancelled) return;
      setRows(buildPortfolio(perMarket.flat(), basis, redeemed));
      setLoading(false);
    };

    load().catch(() => {
      if (!cancelled) setLoading(false);
    });
    // Poll so settlement / new fills surface without a manual refresh.
    const id = setInterval(() => setTick((t) => t + 1), PORTFOLIO_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
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
