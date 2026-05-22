"use client";

import { useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { PublicKey } from "@solana/web3.js";
import { symbolToTicker, TICKER_SYMBOLS } from "@meridian/sdk";
import { useMarkets, useMarket, useOrderBook } from "@/lib/useChain";
import { priceFromBook } from "@/lib/market-math";
import type { DiscoveredMarket } from "@/lib/discovery";
import { StrikeList } from "@/components/trade/StrikeList";
import { DualBookView } from "@/components/trade/DualBookView";
import { PayoffLine } from "@/components/trade/PayoffLine";
import { Countdown } from "@/components/trade/Countdown";
import { Panel } from "@/components/ui";
import BN from "bn.js";

export default function TradePage() {
  const params = useParams<{ symbol: string }>();
  const symbol = (params.symbol ?? "").toUpperCase();

  let ticker: ReturnType<typeof symbolToTicker> | null = null;
  try {
    ticker = symbolToTicker(symbol);
  } catch {
    ticker = null;
  }

  const { data: allMarkets } = useMarkets();
  const strikes = useMemo(
    () =>
      ticker === null
        ? []
        : (allMarkets ?? []).filter((m) => m.ticker === ticker),
    [allMarkets, ticker]
  );

  const [selectedAddr, setSelectedAddr] = useState<PublicKey | null>(null);
  // Default to the first open strike (or first strike) once they load.
  const selected = useMemo(() => {
    if (selectedAddr) return selectedAddr;
    const open = strikes.find((m) => m.state === "open") ?? strikes[0];
    return open?.address ?? null;
  }, [selectedAddr, strikes]);

  const { data: market } = useMarket(selected);
  const { data: book } = useOrderBook(selected);
  const yesPrice = book ? priceFromBook(book.yes) : new BN(500_000);

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
          {market ? (
            <>
              <PayoffLine
                ticker={ticker}
                strike={market.strike}
                yesPrice={yesPrice}
              />
              {book ? (
                <DualBookView book={book} />
              ) : (
                <Panel>
                  <p className="text-sm text-fg-faint">
                    No order book yet for this strike.
                  </p>
                </Panel>
              )}
              {/* The position-aware trade panel slots in here. */}
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
