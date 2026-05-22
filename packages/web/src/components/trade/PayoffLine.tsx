import BN from "bn.js";
import { TICKER_SYMBOLS, type Ticker } from "@meridian/sdk";
import { formatPrice, formatProbability, formatUsdc } from "@/lib/format";
import { impliedComplement } from "@/lib/market-math";

/**
 * The plain-language payoff explainer for a strike, plus the implied No price
 * ($1.00 − Yes). Translates the mechanics into "if X closes ≥ strike, Yes pays $1.00"
 * so a user never has to reason about the token math.
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
      <p className="text-sm text-fg-dim">
        Will <span className="font-mono text-fg">{symbol}</span> close at or
        above <span className="font-mono text-fg">{strikeLabel}</span> today? If
        yes, each <span className="text-yes">Yes</span> token pays{" "}
        <span className="font-mono text-usdc">$1.00</span>; if no, each{" "}
        <span className="text-no">No</span> token pays{" "}
        <span className="font-mono text-usdc">$1.00</span>.
      </p>
      <div className="mt-3 flex gap-6 font-mono text-sm">
        <span className="text-yes" data-testid="yes-price">
          Yes {formatPrice(yesPrice)}{" "}
          <span className="text-fg-faint">({formatProbability(yesPrice)})</span>
        </span>
        <span className="text-no" data-testid="no-price">
          No {formatPrice(noPrice)}{" "}
          <span className="text-fg-faint">({formatProbability(noPrice)})</span>
        </span>
      </div>
    </div>
  );
}
