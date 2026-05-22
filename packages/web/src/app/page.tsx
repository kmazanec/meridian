"use client";

import dynamic from "next/dynamic";
import { useMarkets } from "@/lib/useChain";
import { useTickerPrices } from "@/lib/useTickerPrices";
import { LandingView } from "@/components/landing/LandingView";

const WalletMultiButton = dynamic(
  () =>
    import("@solana/wallet-adapter-react-ui").then((m) => m.WalletMultiButton),
  { ssr: false }
);

export default function HomePage() {
  const { data: markets } = useMarkets();
  const prices = useTickerPrices(markets ?? []);
  return <LandingView prices={prices} connect={<WalletMultiButton />} />;
}
