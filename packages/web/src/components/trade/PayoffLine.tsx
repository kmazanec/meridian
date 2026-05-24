import BN from "bn.js";
import { TICKER_SYMBOLS, type Ticker } from "@meridian/sdk";
import { formatPrice, formatProbability, formatUsdc } from "@/lib/format";
import { impliedComplement } from "@/lib/market-math";

/**
 * The payoff explainer for the selected strike: the two complementary prices (Yes and
 * No = $1.00 − Yes) shown side by side with the "each winning token redeems for $1.00"
 * rule spelled out. The "Will X close above the strike?" question itself now lives in the
 * trade page hero, so this is the just-the-payoff companion that sits above the ticket.
 */
export function PayoffLine({
  ticker,
  strike,
  yesPrice,
}: {
  ticker: Ticker;
  /** Strike in USDC base units (6dp). */
  strike: BN;
  /** Current Yes price (integer price scale). */
  yesPrice: BN;
}) {
  const symbol = TICKER_SYMBOLS[ticker];
  const noPrice = impliedComplement(yesPrice);
  const strikeLabel = formatUsdc(strike, 2);

  return (
    <div className="panel p-4">
      <div className="flex items-stretch gap-3">
        <div className="flex-1 rounded-lg border border-yes/30 bg-yes/5 p-3">
          <div className="text-[0.65rem] uppercase tracking-wide text-yes/80">
            Yes · closes ≥ {strikeLabel}
          </div>
          <div className="mt-1 flex items-baseline gap-2">
            <span
              className="stat-mono text-2xl text-yes"
              data-testid="yes-price"
            >
              {formatPrice(yesPrice)}
            </span>
            <span className="stat-mono text-xs text-fg-faint">
              {formatProbability(yesPrice)}
            </span>
          </div>
        </div>
        <div className="flex-1 rounded-lg border border-no/30 bg-no/5 p-3">
          <div className="text-[0.65rem] uppercase tracking-wide text-no/80">
            No · closes below
          </div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="stat-mono text-2xl text-no" data-testid="no-price">
              {formatPrice(noPrice)}
            </span>
            <span className="stat-mono text-xs text-fg-faint">
              {formatProbability(noPrice)}
            </span>
          </div>
        </div>
      </div>
      <p className="mt-3 text-xs text-fg-faint">
        Each winning {symbol} token redeems for{" "}
        <span className="font-mono text-usdc">$1.00</span> at the close — Yes +
        No always equals <span className="font-mono text-fg-dim">$1.00</span>.
      </p>
    </div>
  );
}
