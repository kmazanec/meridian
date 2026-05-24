"use client";

import { useMemo } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { Outcome } from "@meridian/sdk";
import BN from "bn.js";
import { useMarkets } from "@/lib/useChain";
import { usePortfolio } from "@/lib/usePortfolio";
import { useUsdcBalance } from "@/lib/useUsdcBalance";
import { getFills } from "@/lib/tradeStore";
import { portfolioSummary } from "@/lib/portfolio";
import {
  dailyResults,
  latestTradingDay,
  type SettledMarketInfo,
} from "@/lib/results";
import { ResultsView } from "@/components/results/ResultsView";

export default function ResultsPage() {
  const { publicKey } = useWallet();
  const { data: markets } = useMarkets();
  const { rows } = usePortfolio();
  const { balance: usdcBalance } = useUsdcBalance();

  // Settled markets keyed by address — the on-chain source of each position's outcome,
  // which persists even after the user redeems (unlike their holdings).
  const settledMarkets = useMemo(() => {
    const map = new Map<string, SettledMarketInfo>();
    for (const m of markets ?? []) {
      if (m.state !== "settled" || m.outcome === Outcome.Unsettled) continue;
      map.set(m.address.toBase58(), {
        ticker: m.ticker,
        tradingDay: m.tradingDay,
        outcome: m.outcome,
      });
    }
    return map;
  }, [markets]);

  // The most recent settled trading day — the "today" the recap is about.
  const tradingDay = useMemo(
    () => latestTradingDay(settledMarkets),
    [settledMarkets]
  );

  const results = useMemo(() => {
    if (!publicKey || !tradingDay) return null;
    return dailyResults(
      getFills(publicKey.toBase58()),
      settledMarkets,
      tradingDay
    );
  }, [publicKey, settledMarkets, tradingDay]);

  // Claimable (still-redeemable winnings) from the authoritative on-chain holdings.
  const summary = useMemo(() => portfolioSummary(rows), [rows]);

  // Coverage: do the fills account for every settled position the wallet still holds on the
  // recap day? If holdings show more settled positions than the fills matched, some cost
  // basis is missing (trades made elsewhere), so the UI qualifies the wagered/P&L figures.
  const coverageComplete = useMemo(() => {
    if (!tradingDay) return true;
    const heldSettled = rows.filter(
      (r) => r.kind === "settled" && r.tradingDay.eq(tradingDay)
    ).length;
    const matched = results?.positionCount ?? 0;
    return heldSettled <= matched;
  }, [rows, results, tradingDay]);

  return (
    <ResultsView
      results={results}
      tradingDay={tradingDay}
      usdcBalance={usdcBalance}
      claimable={summary.claimable ?? new BN(0)}
      claimableCount={summary.claimableCount}
      coverageComplete={coverageComplete}
      connected={!!publicKey}
    />
  );
}
