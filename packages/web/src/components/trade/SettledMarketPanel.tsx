import { Outcome, TICKER_SYMBOLS, type Ticker } from "@meridian/sdk";
import type { MarketAccount } from "@meridian/sdk";
import { formatUsdc } from "@/lib/format";
import { cx } from "@/components/ui";

/**
 * A thin, horizontal banner for a *settled* (closed) strike — you can't trade a closed market,
 * but you can inspect its result. It sits *above* the chart so the trade page keeps its
 * two-column (strikes · chart) rhythm instead of spending a whole right column on a read-only
 * result. States the outcome (Yes or No won) with a colored dot, the price the stock actually
 * closed at, and a short redeem note. Redemption of winning tokens lives on the Portfolio page;
 * this is read-only inspection.
 */
export function SettledMarketBanner({
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
    market.settlementPrice != null
      ? formatUsdc(market.settlementPrice, 2)
      : null;

  const verdict = yesWon ? "Yes won" : noWon ? "No won" : "Settled";
  const explanation = yesWon
    ? `${symbol} closed at or above ${strikeLabel}.`
    : noWon
    ? `${symbol} closed below ${strikeLabel}.`
    : "This market has settled.";

  const tone = yesWon
    ? "border-yes/30 bg-yes/5"
    : noWon
    ? "border-no/30 bg-no/5"
    : "border-line-soft bg-panel-2/40";
  const verdictColor = yesWon ? "text-yes" : noWon ? "text-no" : "text-fg-dim";
  const dotColor = yesWon ? "bg-yes" : noWon ? "bg-no" : "bg-fg-dim";

  return (
    <div
      className={cx(
        "panel flex flex-wrap items-center gap-x-4 gap-y-1 border px-4 py-2.5",
        tone
      )}
      data-testid="settled-market-banner"
    >
      <span
        className={cx("h-2 w-2 shrink-0 rounded-full", dotColor)}
        aria-hidden
      />
      <span
        className={cx(
          "stat-mono text-sm uppercase tracking-wide",
          verdictColor
        )}
        data-testid="settled-verdict"
      >
        {verdict}
      </span>
      <span className="text-sm text-fg-dim">{explanation}</span>
      {closeLabel && (
        <span className="ml-auto text-xs uppercase tracking-wide text-fg-faint">
          Closed at{" "}
          <span
            className="stat-mono normal-case text-fg"
            data-testid="settled-close"
          >
            {closeLabel}
          </span>
        </span>
      )}
      <span className="basis-full text-xs text-fg-faint">
        Trading is closed for this strike. Winning tokens redeem for{" "}
        <span className="font-mono text-usdc">$1.00</span> on your{" "}
        <span className="text-fg-dim">Portfolio</span>.
      </span>
    </div>
  );
}
