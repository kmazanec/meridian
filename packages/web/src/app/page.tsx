"use client";

import { useMemo } from "react";
import dynamic from "next/dynamic";
import { useMarkets, useAllBooks } from "@/lib/useChain";
import { livePricesByTicker } from "@/lib/marketStats";
import { LandingView } from "@/components/landing/LandingView";

const WalletMultiButton = dynamic(
  () =>
    import("@solana/wallet-adapter-react-ui").then((m) => m.WalletMultiButton),
  { ssr: false }
);

export default function HomePage() {
  const { data: markets } = useMarkets();
  const { data: books } = useAllBooks();
  // Prices come from the shared books (no per-ticker fetch fan-out — see livePricesByTicker).
  const prices = useMemo(
    () => livePricesByTicker(markets ?? [], books ?? new Map()),
    [markets, books]
  );
  return <LandingView prices={prices} connect={<WalletMultiButton />} />;
}
