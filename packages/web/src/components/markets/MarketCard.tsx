import Link from "next/link";
import {
  formatPrice,
  formatProbability,
  formatTokens,
  formatUsdc,
} from "@/lib/format";
import { Stat, cx } from "@/components/ui";
import type { TickerView } from "@/lib/marketStats";
import { Countdown } from "@/components/trade/Countdown";
import { Sparkline } from "./Sparkline";

/**
 * One per-ticker summary card on the Markets grid. It's a link into the stock's full detail
 * + trade page (`/trade/SYMBOL`) — the strike ladder, depth, and trading live there now, so
 * the card stays a glanceable summary: live Yes price + implied probability, a last-N-days
 * close sparkline, open interest, resting size, and a settlement countdown. Presentational —
 * all data arrives as a derived {@link TickerView}.
 */
export function MarketCard({ view }: { view: TickerView }) {
  const { symbol, repYesPrice, activeCount } = view;
  const closes = view.history?.map((p) => p.close) ?? [];
  const hasOpen = activeCount > 0;

  return (
    <Link
      href={`/trade/${symbol}`}
      aria-label={`View ${symbol}`}
      className="panel block p-5 transition-colors hover:border-line"
      data-testid={`market-card-${symbol}`}
    >
      <div className="flex items-baseline justify-between">
        <span className="font-mono text-lg text-fg">{symbol}</span>
        <span
          className={cx(
            "text-xs uppercase tracking-wide",
            hasOpen ? "text-accent" : "text-fg-faint"
          )}
        >
          {activeCount} active
        </span>
      </div>

      <div className="mt-4 flex items-end justify-between gap-4">
        <div>
          <div className="text-xs uppercase tracking-wide text-fg-faint">
            Yes price
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
        <Sparkline values={closes} className="shrink-0" />
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
