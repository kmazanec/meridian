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
import { StrikeLadder } from "./StrikeLadder";

/**
 * One expandable per-ticker card on the Markets page. Collapsed, it summarizes the
 * stock: live Yes price + implied probability, a last-N-days close sparkline, open
 * interest, and a settlement countdown. Expanded, it reveals the full strike ladder
 * (every strike's price/spread/depth and settled outcomes). Presentational — all data
 * arrives as a derived {@link TickerView}; expand state is owned by the parent so only
 * one ticker is open at a time.
 */
export function MarketCard({
  view,
  expanded,
  onToggle,
}: {
  view: TickerView;
  expanded: boolean;
  onToggle: () => void;
}) {
  const { symbol, repYesPrice, activeCount } = view;
  const closes = view.history?.map((p) => p.close) ?? [];
  const hasOpen = activeCount > 0;

  return (
    <div
      className={cx(
        "panel overflow-hidden p-0 transition-colors",
        expanded ? "border-line" : "hover:border-line"
      )}
      data-testid={`market-card-${symbol}`}
    >
      {/* Summary row — the whole header toggles the ladder. */}
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        className="w-full px-5 pt-5 text-left"
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
              {repYesPrice ? `${formatProbability(repYesPrice)} implied` : "no open market"}
            </div>
          </div>
          <Sparkline values={closes} className="shrink-0" />
        </div>
      </button>

      {/* Liquidity strip — open interest + resting depth. */}
      <div className="mt-4 flex gap-6 px-5">
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
        <div className="mt-4 px-5">
          <Countdown tradingDay={view.tradingDay} />
        </div>
      )}

      {/* Expanded ladder + a trade link. */}
      {expanded && (
        <div className="mt-4 border-t border-line-soft px-5 py-4">
          <StrikeLadder rows={view.rows} />
          <div className="mt-4">
            <Link
              href={`/trade/${symbol}`}
              className="btn btn-accent w-full"
              aria-label={`Trade ${symbol}`}
            >
              Trade {symbol}
            </Link>
          </div>
        </div>
      )}

      {/* Padding when collapsed (the expanded block supplies its own). */}
      {!expanded && <div className="h-5" />}
    </div>
  );
}
