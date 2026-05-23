import BN from "bn.js";
import type { BookView } from "@meridian/sdk";
import { cx } from "@/components/ui";

/**
 * A compact two-sided depth bar for one market's Yes book: bid size on the left (mint),
 * ask size on the right (coral), each width proportional to that side's share of the
 * total resting size. It's a glanceable liquidity/imbalance signal for a ladder row —
 * a fuller order book lives on the trade page. Renders an empty track when the book is
 * empty.
 */
export function DepthBar({
  view,
  className,
}: {
  view: BookView;
  className?: string;
}) {
  const sum = (levels: BookView["bids"]) =>
    levels.reduce((acc, l) => acc.add(l.size), new BN(0));
  const bid = sum(view.bids);
  const ask = sum(view.asks);
  const total = bid.add(ask);

  if (total.isZero()) {
    return (
      <div
        className={cx("h-1.5 rounded-full bg-line-soft", className)}
        data-testid="depth-bar"
        aria-hidden
      />
    );
  }

  // Integer percentage widths (avoid BN→float precision drift on the divide).
  const bidPct = bid.muln(100).div(total).toNumber();
  const askPct = 100 - bidPct;

  return (
    <div
      className={cx(
        "flex h-1.5 overflow-hidden rounded-full bg-line-soft",
        className
      )}
      data-testid="depth-bar"
      data-bid-pct={bidPct}
      aria-hidden
    >
      <div className="bg-yes/70" style={{ width: `${bidPct}%` }} />
      <div className="bg-no/70" style={{ width: `${askPct}%` }} />
    </div>
  );
}
