"use client";

import { useMemo } from "react";
import dynamic from "next/dynamic";
import { Ticker, TICKER_SYMBOLS } from "@meridian/sdk";
import { useMarkets, useAllBooks } from "@/lib/useChain";
import { usePriceHistory, spotFromHistory } from "@/lib/usePriceHistory";
import { groupByTicker } from "@/lib/discovery";
import {
  buildTickerView,
  featuredCalls,
  activitySummary,
  type TickerView,
} from "@/lib/marketStats";
import { LandingView } from "@/components/landing/LandingView";

const WalletMultiButton = dynamic(
  () =>
    import("@solana/wallet-adapter-react-ui").then((m) => m.WalletMultiButton),
  { ssr: false }
);

export default function HomePage() {
  const { data: markets } = useMarkets();
  const { data: books } = useAllBooks();

  // One history fetch per stock (fixed 7 symbols → constant hook count). Reuses the same
  // cached `/api/history` as the Markets page; the markets/books come from shared polls, so
  // the home page adds no order-book RPC fan-out of its own.
  const histories = TICKER_SYMBOLS.map(
    (symbol) => usePriceHistory(symbol).data
  );

  const views = useMemo<TickerView[]>(() => {
    const grouped = groupByTicker(markets ?? []);
    const bookMap = books ?? new Map();
    return TICKER_SYMBOLS.map((symbol, ordinal) =>
      buildTickerView({
        ticker: ordinal as Ticker,
        symbol,
        markets: grouped.get(ordinal as Ticker) ?? [],
        books: bookMap,
        history: histories[ordinal] ?? null,
      })
    );
  }, [markets, books, histories]);

  // Spot (last close + day change) per ticker, for the nearest-the-money featured cards.
  const spots = useMemo(() => {
    const out: Partial<
      Record<Ticker, { close: number; changePct: number | null }>
    > = {};
    histories.forEach((h, ordinal) => {
      const spot = spotFromHistory(h ?? []);
      if (spot) {
        out[ordinal as Ticker] = {
          close: spot.close,
          changePct: spot.changePct,
        };
      }
    });
    return out;
  }, [histories]);

  const featured = useMemo(
    () => featuredCalls(views, spots, 3),
    [views, spots]
  );
  const activity = useMemo(() => activitySummary(views), [views]);

  return (
    <LandingView
      featured={featured}
      activity={activity}
      connect={<WalletMultiButton />}
    />
  );
}
