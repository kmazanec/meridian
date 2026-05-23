"use client";

import { useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { useWallet } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import { dualBook, symbolToTicker, TICKER_SYMBOLS } from "@meridian/sdk";
import {
  useMarkets,
  useMarket,
  useOrderBook,
  useUserPosition,
  useUsdcMint,
} from "@/lib/useChain";
import { useProgram } from "@/lib/useProgram";
import { useSendIx } from "@/lib/useSendIx";
import { priceFromBook } from "@/lib/market-math";
import { recordTradeFill } from "@/lib/recordTradeFill";
import type { DiscoveredMarket } from "@/lib/discovery";
import { StrikeList } from "@/components/trade/StrikeList";
import { DualBookView } from "@/components/trade/DualBookView";
import { PayoffLine } from "@/components/trade/PayoffLine";
import { Countdown } from "@/components/trade/Countdown";
import { TradePanel, type TradeFill } from "@/components/trade/TradePanel";
import { TxStatusBanner } from "@/components/trade/TxStatusBanner";
import { Panel } from "@/components/ui";
import BN from "bn.js";

export default function TradePageClient() {
  const params = useParams<{ symbol: string }>();
  const symbol = (params.symbol ?? "").toUpperCase();

  let ticker: ReturnType<typeof symbolToTicker> | null = null;
  try {
    ticker = symbolToTicker(symbol);
  } catch {
    ticker = null;
  }

  const program = useProgram();
  const { publicKey } = useWallet();
  const usdcMint = useUsdcMint();
  const { data: allMarkets } = useMarkets();
  const strikes = useMemo(
    () =>
      ticker === null
        ? []
        : (allMarkets ?? []).filter((m) => m.ticker === ticker),
    [allMarkets, ticker]
  );

  const [selectedAddr, setSelectedAddr] = useState<PublicKey | null>(null);
  const selected = useMemo(() => {
    if (selectedAddr) return selectedAddr;
    const open = strikes.find((m) => m.state === "open") ?? strikes[0];
    return open?.address ?? null;
  }, [selectedAddr, strikes]);

  const { data: market } = useMarket(selected);
  const { data: rawBook, refresh: refreshBook } = useOrderBook(selected);
  const { data: position, refresh: refreshPosition } = useUserPosition(market);
  const tx = useSendIx();

  const dual = useMemo(() => (rawBook ? dualBook(rawBook) : null), [rawBook]);
  const yesPrice = dual ? priceFromBook(dual.yes) : new BN(500_000);

  if (ticker === null) {
    return (
      <Panel>
        <p className="text-fg-dim">
          Unknown stock “{symbol}”. Supported: {TICKER_SYMBOLS.join(", ")}.
        </p>
      </Panel>
    );
  }

  const onSelect = (m: DiscoveredMarket) => setSelectedAddr(m.address);

  const onSubmit = async (
    instructions: import("@solana/web3.js").TransactionInstruction[],
    fill: TradeFill
  ) => {
    await tx.send(instructions);
    // Record cost basis (display-only) and refresh book + balances after confirm.
    if (publicKey && selected) {
      recordTradeFill(publicKey.toBase58(), selected.toBase58(), fill);
    }
    refreshBook();
    refreshPosition();
  };

  return (
    <div className="space-y-6">
      <header className="flex items-baseline justify-between">
        <h1 className="font-serif text-3xl text-fg">{symbol}</h1>
        <span className="text-sm text-fg-dim">
          {strikes.length} strikes today
        </span>
      </header>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[260px_1fr]">
        <aside className="space-y-4">
          <StrikeList
            strikes={strikes}
            selected={selected}
            onSelect={onSelect}
          />
          {market && <Countdown tradingDay={market.tradingDay} />}
        </aside>

        <section className="space-y-6">
          {market && selected ? (
            <>
              <PayoffLine
                ticker={ticker}
                strike={market.strike}
                yesPrice={yesPrice}
              />
              {dual ? (
                <DualBookView book={dual} />
              ) : (
                <Panel>
                  <p className="text-sm text-fg-faint">
                    No order book yet for this strike.
                  </p>
                </Panel>
              )}
              <TxStatusBanner state={tx} />
              <TradePanel
                program={program}
                user={publicKey ?? null}
                market={market}
                marketAddress={selected}
                book={rawBook}
                position={position}
                usdcMint={usdcMint}
                onSubmit={onSubmit}
                busy={tx.status === "signing" || tx.status === "confirming"}
              />
            </>
          ) : (
            <Panel>
              <p className="text-fg-dim">Select a strike to trade.</p>
            </Panel>
          )}
        </section>
      </div>
    </div>
  );
}
