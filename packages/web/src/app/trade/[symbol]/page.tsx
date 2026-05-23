import { TICKER_SYMBOLS } from "@meridian/sdk";
import TradePageClient from "./TradePageClient";

/**
 * Static-export entrypoint for the per-stock trade page.
 *
 * `output: 'export'` pre-renders one HTML page per dynamic param. The supported stocks are a
 * fixed, known set (the MAG7), so we enumerate exactly those — every other `/trade/<x>` URL
 * falls through to the app's `not-found` page. This server component carries
 * `generateStaticParams` (which cannot live in the `"use client"` component) and renders the
 * unchanged client UI.
 */
export function generateStaticParams() {
  return TICKER_SYMBOLS.map((symbol) => ({ symbol }));
}

export default function TradePage() {
  return <TradePageClient />;
}
