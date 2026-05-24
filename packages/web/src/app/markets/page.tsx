"use client";

import { useMemo } from "react";
import { Ticker, TICKER_SYMBOLS } from "@meridian/sdk";
import { useMarkets, useAllBooks } from "@/lib/useChain";
import { usePriceHistory } from "@/lib/usePriceHistory";
import { useCurrentPrice } from "@/lib/useCurrentPrice";
import { groupByTicker, currentTradingDayMarkets } from "@/lib/discovery";
import {
  buildTickerView,
  buildBoardRow,
  type TickerView,
  type MarketsBoardRow,
} from "@/lib/marketStats";
import { MarketsView } from "@/components/markets/MarketsView";

export default function MarketsPage() {
  const { data: markets } = useMarkets();
  const { data: books } = useAllBooks();

  // One history fetch per stock. The seven symbols are fixed, so the hook count is
  // constant — calling these hooks once per symbol is rules-of-hooks safe.
  const histories = TICKER_SYMBOLS.map(
    (symbol) => usePriceHistory(symbol).data
  );

  // Per-ticker today's markets + view-model (no hooks; pure derivation).
  const views = useMemo<TickerView[]>(() => {
    const grouped = groupByTicker(markets ?? []);
    const bookMap = books ?? new Map();
    return TICKER_SYMBOLS.map((symbol, ordinal) => {
      const ticker = ordinal as Ticker;
      // Only today's markets — exclude prior settled days so each row's strikes, liquidity,
      // and active count reflect the current trading day.
      const tickerMarkets = currentTradingDayMarkets(grouped.get(ticker) ?? []);
      return buildTickerView({
        ticker,
        symbol,
        markets: tickerMarkets,
        books: bookMap,
        history: histories[ordinal] ?? null,
      });
    });
  }, [markets, books, histories]);

  // Live underlying price per stock — the board leads with this (always-available `/api/price`,
  // same feed the trade page and bots use), so it never shows a stale prior-day close.
  const live = TICKER_SYMBOLS.map((symbol, ordinal) => {
    const day = views[ordinal]?.tradingDay;
    return useCurrentPrice(symbol, day != null ? Number(day) : null);
  });

  const rows = useMemo<MarketsBoardRow[]>(
    () =>
      views.map((view, ordinal) =>
        buildBoardRow(view, {
          price: live[ordinal]?.price ?? null,
          pctFromOpen: live[ordinal]?.pctFromOpen ?? null,
        })
      ),
    [views, live]
  );

  return <MarketsView rows={rows} />;
}
