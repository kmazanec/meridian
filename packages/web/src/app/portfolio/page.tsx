"use client";

import { useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import { redeem, RedeemSide } from "@meridian/sdk";
import { useProgram } from "@/lib/useProgram";
import { useUsdcMint } from "@/lib/useChain";
import { useSendIx } from "@/lib/useSendIx";
import { usePortfolio } from "@/lib/usePortfolio";
import type { SettledRow } from "@/lib/portfolio";
import { PortfolioView } from "@/components/portfolio/PortfolioView";
import { TxStatusBanner } from "@/components/trade/TxStatusBanner";

export default function PortfolioPage() {
  const program = useProgram();
  const { publicKey } = useWallet();
  const usdcMint = useUsdcMint();
  const { rows, refresh } = usePortfolio();
  const tx = useSendIx();
  const [redeemingKey, setRedeemingKey] = useState<string | null>(null);

  const onRedeem = async (row: SettledRow) => {
    if (!publicKey || !usdcMint) return;
    const key = `${row.market}:${row.side}`;
    setRedeemingKey(key);
    try {
      const ix = await redeem(program, {
        user: publicKey,
        market: new PublicKey(row.market),
        side: row.side === "yes" ? RedeemSide.Yes : RedeemSide.No,
        amount: row.amount,
        usdcMint,
      });
      await tx.send([ix]);
      refresh();
    } catch {
      // The status banner surfaces the error.
    } finally {
      setRedeemingKey(null);
    }
  };

  return (
    <div className="space-y-4">
      <TxStatusBanner state={tx} />
      <PortfolioView
        rows={rows}
        onRedeem={onRedeem}
        redeemingKey={redeemingKey}
        connected={!!publicKey}
      />
    </div>
  );
}
