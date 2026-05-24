import Link from "next/link";
import {
  formatPrice,
  formatProbability,
  formatTokens,
  formatUsdc,
} from "@/lib/format";
import { Stat, cx } from "@/components/ui";
import type { TickerView } from "@/lib/marketStats";
import { spotFromHistory } from "@/lib/usePriceHistory";
import { Countdown } from "@/components/trade/Countdown";
import { Sparkline } from "./Sparkline";
import { SpotLine } from "./SpotLine";

/**
 * One per-ticker summary card on the Markets grid. It's a link into the stock's full detail
 * + trade page (`/trade/SYMBOL`) — the strike ladder, depth, and trading live there now, so
 * the card stays a glanceable summary: live Yes price + implied probability, a last-N-days
 * close sparkline, open interest, resting size, and a settlement countdown. Presentational —
 * all data arrives as a derived {@link TickerView}.
 */
export function MarketCard({ view }: { view: TickerView }) {
  const { symbol, repYesPrice, repStrikeDollars, activeCount } = view;
  const closes = view.history?.map((p) => p.close) ?? [];
  const spot = spotFromHistory(view.history ?? []);
  const hasOpen = activeCount > 0;
  // Deep-link to the representative strike (the one `repYesPrice` quotes), so opening a card
  // lands on the same bet it shows — same continuity the home page's featured cards give.
  const href = repStrikeDollars != null
    ? `/trade/${symbol}?strike=${repStrikeDollars}`
    : `/trade/${symbol}`;

  return (
    <Link
      href={href}
      aria-label={`View ${symbol}`}
      className="panel block p-5 transition-colors hover:border-accent/30"
      data-testid={`market-card-${symbol}`}
    >
      <div className="flex items-baseline justify-between">
        <span className="font-serif text-xl tracking-tight text-fg">
          {symbol}
        </span>
        <span
          className={cx(
            "text-xs uppercase tracking-wide",
            hasOpen ? "text-accent" : "text-fg-faint"
          )}
        >
          {hasOpen ? `${activeCount} open` : "closed"}
        </span>
      </div>
      <p className="mt-1 text-sm text-fg-dim">Will it close above the line?</p>

      <div className="mt-4 flex items-end justify-between gap-4">
        <div>
          <div className="text-xs uppercase tracking-wide text-fg-faint">
            Yes
          </div>
          <div className="stat-mono text-2xl text-yes">
            {repYesPrice ? formatPrice(repYesPrice) : "—"}
          </div>
          <div className="stat-mono mt-0.5 text-xs text-fg-faint">
            {repYesPrice
              ? `${formatProbability(repYesPrice)} implied`
              : "no open market"}
          </div>
        </div>
        <div className="flex flex-col items-end gap-1">
          <Sparkline values={closes} className="shrink-0" />
          <SpotLine spot={spot} />
        </div>
      </div>

      <div className="mt-4 flex gap-6">
        <Stat
          label="Open interest"
          value={formatUsdc(view.totalCollateral, 0)}
          accent="usdc"
        />
        <Stat
          label="Resting size"
          value={formatTokens(view.totalRestingSize, 0)}
        />
      </div>

      {view.tradingDay && (
        <div className="mt-4">
          <Countdown tradingDay={view.tradingDay} />
        </div>
      )}
    </Link>
  );
}
