"use client";

import { useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { useWallet } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import { dualBook, symbolToTicker, TICKER_SYMBOLS } from "@meridian/sdk";
import {
  useMarkets,
  useAllBooks,
  useMarket,
  useUserPosition,
  useUsdcMint,
} from "@/lib/useChain";
import { useChainData } from "@/lib/ChainDataProvider";
import { useProgram } from "@/lib/useProgram";
import { useSendIx } from "@/lib/useSendIx";
import { usePriceHistory, spotFromHistory } from "@/lib/usePriceHistory";
import { priceFromBook } from "@/lib/market-math";
import {
  strikeLadderRows,
  representativeYesPrice,
  type BookMap,
} from "@/lib/marketStats";
import { recordTradeFill } from "@/lib/recordTradeFill";
import { formatPrice, formatProbability } from "@/lib/format";
import { StrikeLadder } from "@/components/markets/StrikeLadder";
import { PriceChart } from "@/components/markets/PriceChart";
import { SpotLine } from "@/components/markets/SpotLine";
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
  const { data: allBooks } = useAllBooks();
  const { refreshAll } = useChainData();
  const history = usePriceHistory(ticker === null ? null : symbol).data;
  const books: BookMap = useMemo(() => allBooks ?? new Map(), [allBooks]);

  const strikes = useMemo(
    () =>
      ticker === null
        ? []
        : (allMarkets ?? []).filter((m) => m.ticker === ticker),
    [allMarkets, ticker]
  );

  // The strike ladder doubles as the picker: open rows select, settled rows are muted.
  const ladderRows = useMemo(
    () => strikeLadderRows(strikes, books),
    [strikes, books]
  );

  const [selectedAddr, setSelectedAddr] = useState<PublicKey | null>(null);
  const selected = useMemo(() => {
    if (selectedAddr) return selectedAddr;
    // Default to the first open strike (ladder is strike-sorted, open before settled).
    const open = strikes.find((m) => m.state === "open") ?? strikes[0];
    return open?.address ?? null;
  }, [selectedAddr, strikes]);

  const { data: market } = useMarket(selected);
  const { data: position, refresh: refreshPosition } = useUserPosition(market);
  const tx = useSendIx();

  // The selected strike's book comes from the shared allBooks map (its orderBook addr),
  // so the page makes no extra per-strike book fetch.
  const selectedDiscovered = useMemo(
    () => strikes.find((m) => m.address.equals(selected ?? PublicKey.default)),
    [strikes, selected]
  );
  const rawBook = useMemo(() => {
    if (!selectedDiscovered) return null;
    return books.get(selectedDiscovered.orderBook.toBase58()) ?? null;
  }, [books, selectedDiscovered]);
  const dual = useMemo(() => (rawBook ? dualBook(rawBook) : null), [rawBook]);
  const yesPrice = dual ? priceFromBook(dual.yes) : new BN(500_000);

  // Header "price of the stock": the representative open strike's Yes price.
  const repPrice = useMemo(
    () => representativeYesPrice(strikes, books),
    [strikes, books]
  );
  const headerTradingDay =
    market?.tradingDay ??
    strikes.find((m) => m.state === "open")?.tradingDay ??
    null;

  if (ticker === null) {
    return (
      <Panel>
        <p className="text-fg-dim">
          Unknown stock “{symbol}”. Supported: {TICKER_SYMBOLS.join(", ")}.
        </p>
      </Panel>
    );
  }

  const onSubmit = async (
    instructions: import("@solana/web3.js").TransactionInstruction[],
    fill: TradeFill
  ) => {
    await tx.send(instructions);
    // Record cost basis (display-only) and refresh shared chain data + balances on confirm.
    if (publicKey && selected) {
      recordTradeFill(publicKey.toBase58(), selected.toBase58(), fill);
    }
    refreshAll();
    refreshPosition();
  };

  const closes = history?.map((p) => p.close) ?? [];
  const spot = spotFromHistory(history ?? []);

  return (
    <div className="space-y-6">
      {/* Header: symbol, representative Yes price + implied, spot (last close), countdown. */}
      <header className="panel flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-5">
          <div>
            <h1 className="font-serif text-3xl text-fg">{symbol}</h1>
            <SpotLine spot={spot} showOpen className="mt-1 block" />
          </div>
          <div>
            <div className="text-xs uppercase tracking-wide text-fg-faint">
              Yes price
            </div>
            <div className="stat-mono text-2xl text-yes">
              {repPrice ? formatPrice(repPrice) : "—"}
            </div>
            <div className="stat-mono mt-0.5 text-xs text-fg-faint">
              {repPrice
                ? `${formatProbability(repPrice)} implied`
                : "no open market"}
            </div>
          </div>
        </div>
        {headerTradingDay && <Countdown tradingDay={headerTradingDay} />}
      </header>

      {/* Full-width interactive close-price chart. */}
      <section className="panel p-5">
        <div className="mb-2 flex items-baseline justify-between">
          <h2 className="text-xs uppercase tracking-wide text-fg-faint">
            {symbol} · last {closes.length} sessions
          </h2>
          <SpotLine spot={spot} />
        </div>
        <PriceChart points={history ?? []} />
      </section>

      {/* Ladder-left (also the strike picker), trade-right for the selected strike. */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(360px,1fr)_minmax(0,1fr)]">
        <section className="panel p-5">
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className="text-xs uppercase tracking-wide text-fg-faint">
              Strike ladder
            </h2>
            <SpotLine spot={spot} />
          </div>
          <StrikeLadder
            rows={ladderRows}
            selectedAddress={selected?.toBase58() ?? null}
            onSelect={(addr) => setSelectedAddr(new PublicKey(addr))}
            lastClose={spot?.close ?? null}
          />
        </section>

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
              <p className="text-fg-dim">Select an open strike to trade.</p>
            </Panel>
          )}
        </section>
      </div>
    </div>
  );
}
