import BN from "bn.js";
import { TradeAction, type BookView, type BookLevel } from "@meridian/sdk";
import { formatPrice, formatTokens } from "@/lib/format";
import { cx } from "@/components/ui";

/**
 * Clicking a book level is an in-context trade entry. The view is the *Yes* perspective, so:
 *  - an **ask** (someone selling Yes at p) is what a buyer lifts → **Buy Yes** limit @ p;
 *  - a **bid** (someone buying Yes at p) is what a seller hits → **Sell Yes** limit @ p.
 * Both are Yes-side limit orders at the level's price; the modal lets the user adjust before
 * confirming. No-side entries come from the Yes/No bar (the merged axis already encodes No).
 */
export type BookPick = (
  action: TradeAction.BuyYes | TradeAction.SellYes,
  price: BN
) => void;

/**
 * The single Yes book on one shared price axis — the "one book" made literal.
 *
 * Asks (sellers) sit above bids (buyers), separated by the spread band, exactly as a
 * price ladder reads: high price at the top, low at the bottom. Each row carries a
 * horizontal depth bar whose length is proportional to that level's size relative to
 * the largest level in view, so liquidity walls pop pre-attentively before you read the
 * number. Bids grow left from the center price spine (mint); asks grow right (coral).
 *
 * The No perspective is just `1 − price` and is intentionally *not* a second column —
 * the merged axis already encodes it.
 */
export function MergedBookView({
  view,
  onPick,
}: {
  view: BookView;
  /** Open a limit trade at a clicked level (Buy Yes on an ask, Sell Yes on a bid). */
  onPick?: BookPick;
}) {
  // Scale each side against *its own* biggest level. When depth is lopsided (a wall on
  // one side) a single shared scale would crush the thinner side into invisible nubs;
  // per-side scaling keeps both sides legible relative to themselves (the CLOB-ladder
  // convention). The tradeoff: bar length is comparable within a side, not across.
  const bidMax = maxSize(view.bids);
  const askMax = maxSize(view.asks);

  const bestBid = view.bids[0]?.price ?? null;
  const bestAsk = view.asks[0]?.price ?? null;
  const spread = bestBid && bestAsk ? bestAsk.sub(bestBid) : null;

  return (
    <div
      className="panel p-4"
      aria-label="Order book"
      data-testid="merged-book"
    >
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <span className="font-mono text-sm uppercase tracking-wide text-fg-dim">
          The book
        </span>
        {onPick && (view.asks.length > 0 || view.bids.length > 0) && (
          <span className="text-[0.65rem] uppercase tracking-wide text-fg-faint">
            Click a price to trade it
          </span>
        )}
      </div>

      {/* Column headers mirror the row grid: size · bar · PRICE · bar · size. */}
      <div className="grid grid-cols-[3rem_1fr_4rem_1fr_3rem] items-center gap-x-2 text-[0.65rem] uppercase tracking-wide text-fg-faint">
        <span className="text-left">Bid sz</span>
        <span />
        <span className="text-center">Price</span>
        <span />
        <span className="text-right">Ask sz</span>
      </div>

      {/* Asks: lowest ask is the inside market, so render best-ask *closest* to the
          spread band — i.e. asks descend high→low toward the center. */}
      <Side
        levels={view.asks}
        kind="ask"
        max={askMax}
        empty="no asks"
        onPick={onPick}
      />

      <SpreadBand spread={spread} />

      {/* Bids: best bid (highest) sits just under the spread band, then descends. */}
      <Side
        levels={view.bids}
        kind="bid"
        max={bidMax}
        empty="no bids"
        onPick={onPick}
      />
    </div>
  );
}

function Side({
  levels,
  kind,
  max,
  empty,
  onPick,
}: {
  levels: BookLevel[];
  kind: "bid" | "ask";
  max: BN;
  empty: string;
  onPick?: BookPick;
}) {
  if (levels.length === 0) {
    return (
      <div
        className="py-2 text-center text-xs text-fg-faint"
        data-testid={`side-${kind}`}
      >
        {empty}
      </div>
    );
  }
  // Asks render best-first (lowest price) but we want the inside market adjacent to the
  // spread band, which is *below* the ask block — so reverse so best-ask is last/bottom.
  const rows = kind === "ask" ? [...levels].reverse() : levels;
  return (
    <div data-testid={`side-${kind}`}>
      {rows.map((lvl) => (
        <Row
          key={lvl.price.toString()}
          level={lvl}
          kind={kind}
          max={max}
          onPick={onPick}
        />
      ))}
    </div>
  );
}

function Row({
  level,
  kind,
  max,
  onPick,
}: {
  level: BookLevel;
  kind: "bid" | "ask";
  max: BN;
  onPick?: BookPick;
}) {
  const pct = pctOf(level.size, max);
  const isBid = kind === "bid";
  // An ask is what a buyer lifts (Buy Yes); a bid is what a seller hits (Sell Yes).
  const action = isBid ? TradeAction.SellYes : TradeAction.BuyYes;
  const verb = isBid ? "Sell Yes" : "Buy Yes";
  const grid =
    "grid grid-cols-[3rem_1fr_4rem_1fr_3rem] items-center gap-x-2 py-0.5 font-mono text-sm tabular-nums";

  const inner = (
    <>
      {/* Bid size (left edge), shown only on bid rows. */}
      <span className="text-left text-fg-dim">
        {isBid ? formatTokens(level.size) : null}
      </span>

      {/* Left bar track: bids grow leftward from the center spine. */}
      <span className="flex h-4 justify-end">
        {isBid ? (
          <span
            className="block h-full rounded-l-sm bg-yes/25"
            style={{ width: `${pct}%` }}
          />
        ) : null}
      </span>

      {/* Price spine. */}
      <span className={cx("text-center", isBid ? "text-yes" : "text-no")}>
        {formatPrice(level.price)}
      </span>

      {/* Right bar track: asks grow rightward from the center spine. */}
      <span className="flex h-4 justify-start">
        {!isBid ? (
          <span
            className="block h-full rounded-r-sm bg-no/25"
            style={{ width: `${pct}%` }}
          />
        ) : null}
      </span>

      {/* Ask size (right edge), shown only on ask rows. */}
      <span className="text-right text-fg-dim">
        {isBid ? null : formatTokens(level.size)}
      </span>
    </>
  );

  // With a pick handler the whole row is a button: click to open a limit trade at this level.
  // Without one (e.g. a read-only context) it stays a plain row, unchanged from before.
  if (onPick) {
    return (
      <button
        type="button"
        onClick={() => onPick(action, level.price)}
        title={`${verb} at ${formatPrice(level.price)}`}
        data-testid={`row-${kind}`}
        data-size-pct={pct}
        className={cx(
          grid,
          "w-full cursor-pointer rounded-sm text-left transition-colors hover:bg-line-soft/40",
          isBid ? "hover:bg-yes/10" : "hover:bg-no/10"
        )}
      >
        {inner}
      </button>
    );
  }

  return (
    <div className={grid} data-testid={`row-${kind}`} data-size-pct={pct}>
      {inner}
    </div>
  );
}

function SpreadBand({ spread }: { spread: BN | null }) {
  return (
    <div
      className="my-1 flex items-center justify-center border-y border-line-soft py-1 text-[0.65rem] uppercase tracking-wide text-fg-faint"
      data-testid="spread-band"
    >
      {spread ? `spread ${formatPrice(spread)}` : "—"}
    </div>
  );
}

/** Largest level size in a set (≥ 1 so bar math never divides by zero on an empty side). */
function maxSize(levels: BookLevel[]): BN {
  let m = new BN(0);
  for (const l of levels) {
    if (l.size.gt(m)) m = l.size;
  }
  return m.isZero() ? new BN(1) : m;
}

/** Integer percentage of a level's size against the max (BN math, no float drift). */
function pctOf(size: BN, max: BN): number {
  return size.muln(100).div(max).toNumber();
}
