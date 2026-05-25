"use client";

import { useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import { redeem, RedeemSide } from "@meridian/sdk";
import { useProgram } from "@/lib/useProgram";
import { useUsdcMint, useMarkets } from "@/lib/useChain";
import { useSendIx } from "@/lib/useSendIx";
import { usePortfolio } from "@/lib/usePortfolio";
import { useUsdcBalance } from "@/lib/useUsdcBalance";
import { useSolBalance } from "@/lib/useSolBalance";
import { useHistory } from "@/lib/useHistory";
import type { SettledRow } from "@/lib/portfolio";
import { PortfolioView } from "@/components/portfolio/PortfolioView";
import { TxStatusBanner } from "@/components/trade/TxStatusBanner";

/** How many recent actions to preview on the portfolio (the full log lives on /history). */
const ACTIVITY_PREVIEW = 5;

export default function PortfolioPage() {
  const program = useProgram();
  const { publicKey } = useWallet();
  const usdcMint = useUsdcMint();
  const { rows, refresh } = usePortfolio();
  const { balance: usdcBalance } = useUsdcBalance();
  const { lamports: solLamports } = useSolBalance();
  const { entries: activity } = useHistory();
  const { data: markets } = useMarkets();
  const tx = useSendIx();
  const [redeemingKey, setRedeemingKey] = useState<string | null>(null);

  const boardOpen = (markets ?? []).some((m) => m.state === "open");

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
    } catch (e) {
      // `send` already sets the banner on its own failures; this also surfaces an
      // error from building the redeem instruction (before `send` runs).
      tx.fail(e);
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
        usdcBalance={usdcBalance}
        solLamports={solLamports}
        recentActivity={activity.slice(0, ACTIVITY_PREVIEW)}
        boardOpen={boardOpen}
      />
    </div>
  );
}
