"use client";

import { useMemo } from "react";
import { Ticker, TICKER_SYMBOLS } from "@meridian/sdk";
import { useMarkets, useAllBooks } from "@/lib/useChain";
import { usePriceHistory } from "@/lib/usePriceHistory";
import { groupByTicker } from "@/lib/discovery";
import { buildTickerView, type TickerView } from "@/lib/marketStats";
import { MarketsView } from "@/components/markets/MarketsView";

export default function MarketsPage() {
  const { data: markets } = useMarkets();
  const { data: books } = useAllBooks();

  // One history fetch per stock. The seven symbols are fixed, so the hook count is
  // constant — calling usePriceHistory once per symbol is rules-of-hooks safe.
  const histories = TICKER_SYMBOLS.map(
    (symbol) => usePriceHistory(symbol).data
  );

  const tickers = useMemo<TickerView[]>(() => {
    const grouped = groupByTicker(markets ?? []);
    const bookMap = books ?? new Map();
    return TICKER_SYMBOLS.map((symbol, ordinal) => {
      const ticker = ordinal as Ticker;
      return buildTickerView({
        ticker,
        symbol,
        markets: grouped.get(ticker) ?? [],
        books: bookMap,
        history: histories[ordinal] ?? null,
      });
    });
  }, [markets, books, histories]);

  return <MarketsView tickers={tickers} />;
}
