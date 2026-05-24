import { Outcome, TICKER_SYMBOLS, type Ticker } from "@meridian/sdk";
import type { MarketAccount } from "@meridian/sdk";
import { formatUsdc } from "@/lib/format";
import { cx } from "@/components/ui";

/**
 * The right-column view for a *settled* (closed) strike, shown in place of the trade ticket —
 * you can't trade a closed market, but you can inspect its result. States the outcome (Yes or
 * No won), the price the stock actually closed at, and that the market is closed. Redemption
 * of winning tokens lives on the Portfolio page; this is read-only inspection.
 */
export function SettledMarketPanel({
  ticker,
  market,
}: {
  ticker: Ticker;
  market: MarketAccount;
}) {
  const symbol = TICKER_SYMBOLS[ticker];
  const yesWon = market.outcome === Outcome.YesWins;
  const noWon = market.outcome === Outcome.NoWins;
  const strikeLabel = formatUsdc(market.strike, 2);

  // Settlement price is the stock's close (USDC base units, 6dp) — the same scale as strike.
  const closeLabel =
    market.settlementPrice != null ? formatUsdc(market.settlementPrice, 2) : null;

  const verdict = yesWon
    ? "Yes won"
    : noWon
    ? "No won"
    : "Settled";
  const explanation = yesWon
    ? `${symbol} closed at or above ${strikeLabel}.`
    : noWon
    ? `${symbol} closed below ${strikeLabel}.`
    : "This market has settled.";

  return (
    <div className="panel p-4" data-testid="settled-market-panel">
      <div className="flex items-center justify-between">
        <span className="text-xs uppercase tracking-wide text-fg-faint">
          Market closed
        </span>
        <span className="text-xs uppercase tracking-wide text-fg-faint">
          Yes · closes ≥ {strikeLabel}
        </span>
      </div>

      <div
        className={cx(
          "mt-3 rounded-lg border p-3",
          yesWon
            ? "border-yes/30 bg-yes/5"
            : noWon
            ? "border-no/30 bg-no/5"
            : "border-line-soft bg-panel-2/40"
        )}
      >
        <div
          className={cx(
            "stat-mono text-2xl uppercase tracking-wide",
            yesWon ? "text-yes" : noWon ? "text-no" : "text-fg-dim"
          )}
          data-testid="settled-verdict"
        >
          {verdict}
        </div>
        <p className="mt-1 text-sm text-fg-dim">{explanation}</p>
      </div>

      {closeLabel && (
        <div className="mt-3 flex items-baseline justify-between">
          <span className="text-xs uppercase tracking-wide text-fg-faint">
            Closed at
          </span>
          <span className="stat-mono text-lg text-fg" data-testid="settled-close">
            {closeLabel}
          </span>
        </div>
      )}

      <p className="mt-3 text-xs text-fg-faint">
        Trading is closed for this strike. Winning tokens redeem for{" "}
        <span className="font-mono text-usdc">$1.00</span> on your{" "}
        <span className="text-fg-dim">Portfolio</span>.
      </p>
    </div>
  );
}
