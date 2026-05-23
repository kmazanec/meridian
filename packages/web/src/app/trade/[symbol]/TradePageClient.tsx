"use client";

import { useMemo, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
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
import { formatPrice, formatProbability, formatUsdc } from "@/lib/format";
import { StrikeLadder } from "@/components/markets/StrikeLadder";
import { PriceChartPanel } from "@/components/markets/PriceChartPanel";
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
  const searchParams = useSearchParams();
  const symbol = (params.symbol ?? "").toUpperCase();
  // Deep link to a specific strike: `/trade/NVDA?strike=270` selects the $270 market.
  // Strike value (dollars) is used rather than the market address so links survive the
  // daily market recreation and stay human-readable. Resolved against loaded strikes below.
  const strikeParam = searchParams.get("strike");

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
    // An explicit ladder click always wins.
    if (selectedAddr) return selectedAddr;
    // Otherwise honor a `?strike=<dollars>` deep link: match the open market at that strike.
    // Resolved here (not at mount) so it works once `strikes` has loaded after navigation.
    if (strikeParam) {
      const dollars = Number(strikeParam);
      if (Number.isFinite(dollars)) {
        const base = new BN(Math.round(dollars * 1_000_000));
        const match =
          strikes.find((m) => m.state === "open" && m.strike.eq(base)) ??
          strikes.find((m) => m.strike.eq(base));
        if (match) return match.address;
      }
    }
    // Default to the first open strike (ladder is strike-sorted, open before settled).
    const open = strikes.find((m) => m.state === "open") ?? strikes[0];
    return open?.address ?? null;
  }, [selectedAddr, strikeParam, strikes]);

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

  const spot = spotFromHistory(history ?? []);

  // The hero question reads as the actual contract: prefer the selected strike, else the
  // representative open strike, else a generic framing when nothing is open today.
  const heroStrike = market?.strike ?? null;
  const heroQuestion = heroStrike
    ? `Will ${symbol} close ≥ ${formatUsdc(heroStrike, 0)} today?`
    : `Will ${symbol} close above today's strike?`;

  return (
    <div className="space-y-6">
      {/* Question hero: the contract in plain language + the three numbers that matter. */}
      <header className="panel p-6">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-2xl">
            <div className="text-xs uppercase tracking-widest text-accent">
              {symbol} · today's verdict
            </div>
            <h1 className="mt-2 font-serif text-3xl leading-tight tracking-tight text-fg sm:text-4xl">
              {heroQuestion}
            </h1>
            <SpotLine spot={spot} showOpen className="mt-3 block" />
          </div>
          <div className="flex items-end gap-8">
            <div>
              <div className="text-xs uppercase tracking-wide text-fg-faint">
                Yes price
              </div>
              <div className="stat-mono text-3xl text-yes">
                {repPrice ? formatPrice(repPrice) : "—"}
              </div>
              <div className="stat-mono mt-0.5 text-xs text-fg-faint">
                {repPrice
                  ? `${formatProbability(repPrice)} implied`
                  : "no open market"}
              </div>
            </div>
            {headerTradingDay && (
              <Countdown tradingDay={headerTradingDay} variant="inline" />
            )}
          </div>
        </div>
      </header>

      {/* Persistent trading terminal: strikes · chart + book · ticket.
          Three columns at xl; ladder + (chart/book) at lg with the ticket below;
          a single focus-mode stack on mobile. */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(280px,320px)_minmax(0,1fr)] xl:grid-cols-[minmax(280px,320px)_minmax(0,1fr)_minmax(340px,380px)]">
        {/* Left: strike ladder (the picker). */}
        <section className="panel order-2 p-5 lg:order-1">
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className="text-xs uppercase tracking-wide text-fg-faint">
              Strikes
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

        {/* Center: price chart over the order book for the selected strike. */}
        <section className="order-1 space-y-6 lg:order-2">
          <PriceChartPanel
            symbol={symbol}
            closes={history ?? []}
            spot={spot}
            tradingDay={
              headerTradingDay != null ? Number(headerTradingDay) : null
            }
          />
          {market && selected ? (
            dual ? (
              <DualBookView book={dual} />
            ) : (
              <Panel>
                <p className="text-sm text-fg-faint">
                  No order book yet for this strike.
                </p>
              </Panel>
            )
          ) : null}
        </section>

        {/* Right: the trade ticket (drops below the chart at lg, beside it at xl). */}
        <section className="order-3 space-y-6 lg:col-span-2 xl:col-span-1">
          {market && selected ? (
            <>
              <PayoffLine
                ticker={ticker}
                strike={market.strike}
                yesPrice={yesPrice}
              />
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
