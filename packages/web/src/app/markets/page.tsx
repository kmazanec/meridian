"use client";

import { useMarkets } from "@/lib/useChain";
import { useTickerPrices } from "@/lib/useTickerPrices";
import { MarketsView } from "@/components/markets/MarketsView";

export default function MarketsPage() {
  const { data: markets, loading } = useMarkets();
  const prices = useTickerPrices(markets ?? []);
  return (
    <MarketsView markets={markets ?? []} prices={prices} loading={loading} />
  );
}
