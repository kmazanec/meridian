import BN from "bn.js";
import { TradeAction, TICKER_SYMBOLS, type Ticker } from "@meridian/sdk";
import { formatPrice, formatProbability, formatUsdc } from "@/lib/format";
import { impliedComplement } from "@/lib/market-math";
import { cx } from "@/components/ui";

/**
 * The thin, clickable Yes/No quote bar that sits *above* the chart — the open-market mirror
 * of the settled "Yes won / No won" banner, so an open and a closed strike read with the same
 * rhythm. Each cell shows that side's live price + implied probability and is the primary,
 * in-context entry point to a trade: clicking Yes opens the trade modal seeded to buy Yes at
 * that live price (a limit, so it works even on an empty book), clicking No to buy No. The
 * modal then lets the user flip side, switch to market, or adjust price; clicking a specific
 * order-book row is the shortcut that seeds a limit at that exact level instead.
 *
 * Replaces the old PayoffLine: the same two complementary prices, but as a slim action bar
 * rather than a tall card above a permanent ticket. The "$1.00 at the close" rule stays as a
 * one-line footnote so the payoff is never more than a glance away.
 */
export function TradeBar({
  ticker,
  strike,
  yesPrice,
  onPick,
  disabled,
}: {
  ticker: Ticker;
  /** Strike in USDC base units (6dp). */
  strike: BN;
  /** Current Yes price (integer price scale). */
  yesPrice: BN;
  /** Open the trade modal seeded to buy this side (the page seeds the live price + limit). */
  onPick: (action: TradeAction.BuyYes | TradeAction.BuyNo) => void;
  /** No wallet / no live book yet — render the quotes but don't invite a click. */
  disabled?: boolean;
}) {
  const symbol = TICKER_SYMBOLS[ticker];
  const noPrice = impliedComplement(yesPrice);
  const strikeLabel = formatUsdc(strike, 2);

  return (
    <div className="panel overflow-hidden p-0" data-testid="trade-bar">
      <div className="grid grid-cols-2 divide-x divide-line-soft">
        <QuoteCell
          tone="yes"
          eyebrow={`Yes · closes ≥ ${strikeLabel}`}
          price={yesPrice}
          cta={`Buy Yes`}
          disabled={disabled}
          onClick={() => onPick(TradeAction.BuyYes)}
        />
        <QuoteCell
          tone="no"
          eyebrow="No · closes below"
          price={noPrice}
          cta={`Buy No`}
          disabled={disabled}
          onClick={() => onPick(TradeAction.BuyNo)}
        />
      </div>
      <p className="border-t border-line-soft px-4 py-2 text-xs text-fg-faint">
        Each winning {symbol} token redeems for{" "}
        <span className="font-mono text-usdc">$1.00</span> at the close — Yes +
        No always equals <span className="font-mono text-fg-dim">$1.00</span>.
        {!disabled && " Tap a side to buy, or click a price in the book below."}
      </p>
    </div>
  );
}

function QuoteCell({
  tone,
  eyebrow,
  price,
  cta,
  disabled,
  onClick,
}: {
  tone: "yes" | "no";
  eyebrow: string;
  price: BN;
  cta: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  const isYes = tone === "yes";
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      data-testid={`trade-bar-${tone}`}
      className={cx(
        "group flex items-center justify-between gap-3 px-4 py-3 text-left transition-colors",
        "focus-visible:outline-none disabled:cursor-default",
        isYes
          ? "hover:bg-yes/10 disabled:hover:bg-transparent"
          : "hover:bg-no/10 disabled:hover:bg-transparent"
      )}
    >
      <div>
        <div
          className={cx(
            "text-[0.65rem] uppercase tracking-wide",
            isYes ? "text-yes/80" : "text-no/80"
          )}
        >
          {eyebrow}
        </div>
        <div className="mt-1 flex items-baseline gap-2">
          <span
            className={cx("stat-mono text-2xl", isYes ? "text-yes" : "text-no")}
            data-testid={`${tone}-price`}
          >
            {formatPrice(price)}
          </span>
          <span className="stat-mono text-xs text-fg-faint">
            {formatProbability(price)}
          </span>
        </div>
      </div>
      {!disabled && (
        <span
          className={cx(
            "shrink-0 rounded-md border px-2.5 py-1 text-xs font-medium transition-colors",
            isYes
              ? "border-yes/40 text-yes group-hover:bg-yes/15"
              : "border-no/40 text-no group-hover:bg-no/15"
          )}
          aria-hidden
        >
          {cta} →
        </span>
      )}
    </button>
  );
}
