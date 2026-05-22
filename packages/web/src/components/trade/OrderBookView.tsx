import type { BookView, BookLevel } from "@meridian/sdk";
import { formatPrice, formatTokens } from "@/lib/format";
import { cx } from "@/components/ui";

/**
 * One perspective of the single book. Asks (sell) shown above bids (buy), each
 * best-price-first as the SDK returns them. `tone` colors the side label (Yes/No).
 */
export function OrderBookView({
  title,
  view,
  tone,
}: {
  title: string;
  view: BookView;
  tone: "yes" | "no";
}) {
  const labelTone = tone === "yes" ? "text-yes" : "text-no";
  return (
    <div
      className="panel p-4"
      aria-label={`${title} order book`}
      data-testid={`book-${tone}`}
    >
      <div
        className={cx(
          "mb-3 font-mono text-sm uppercase tracking-wide",
          labelTone
        )}
      >
        {title}
      </div>
      <div className="grid grid-cols-2 gap-x-4 text-xs uppercase tracking-wide text-fg-faint">
        <span>Price</span>
        <span className="text-right">Size</span>
      </div>

      <BookSide levels={view.asks} kind="ask" empty="no asks" />
      <div className="my-2 border-t border-line-soft" />
      <BookSide levels={view.bids} kind="bid" empty="no bids" />
    </div>
  );
}

function BookSide({
  levels,
  kind,
  empty,
}: {
  levels: BookLevel[];
  kind: "bid" | "ask";
  empty: string;
}) {
  if (levels.length === 0) {
    return <div className="py-1 text-sm text-fg-faint">{empty}</div>;
  }
  const priceTone = kind === "ask" ? "text-no" : "text-yes";
  return (
    <div data-testid={`side-${kind}`}>
      {levels.map((lvl) => (
        <div
          key={lvl.price.toString()}
          className="grid grid-cols-2 gap-x-4 py-0.5 font-mono text-sm tabular-nums"
        >
          <span className={priceTone}>{formatPrice(lvl.price)}</span>
          <span className="text-right text-fg-dim">
            {formatTokens(lvl.size)}
          </span>
        </div>
      ))}
    </div>
  );
}
