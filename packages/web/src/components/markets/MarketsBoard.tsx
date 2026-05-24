"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Outcome } from "@meridian/sdk";
import {
  formatDollars,
  formatPctChange,
  formatPrice,
  formatProbability,
  formatTokens,
  formatUsdc,
} from "@/lib/format";
import { cx } from "@/components/ui";
import {
  sortBoardRows,
  type BoardSort,
  type MarketsBoardRow,
  type StrikeRow,
} from "@/lib/marketStats";
import { Countdown } from "@/components/trade/Countdown";
import { Sparkline } from "./Sparkline";
import { DepthBar } from "./DepthBar";

/**
 * The Markets board: a dense, sortable watchlist of all seven stocks, built for opportunity
 * discovery rather than a pretty summary. Each row leads with the *live* underlying price and
 * today's move, the nearest-the-money bet (the genuine coin-flip), resting liquidity, and the
 * settlement countdown — the signals a trader scans to decide what to drill into. Rows sort by
 * "action" (coin-flips + liquidity) by default; open stocks always rank above closed ones.
 *
 * Clicking a row expands its full strike ladder inline (the second dimension of the dataset)
 * so a trader can pick a strike without leaving the page; the strike/symbol both deep-link to
 * the trade page. Presentational — rows arrive as derived {@link MarketsBoardRow}s.
 */

const STRIKE_SCALE = 1_000_000;

const SORTS: { key: BoardSort; label: string }[] = [
  { key: "action", label: "Action" },
  { key: "mover", label: "Mover" },
  { key: "price", label: "Price" },
  { key: "symbol", label: "Symbol" },
];

export function MarketsBoard({ rows }: { rows: MarketsBoardRow[] }) {
  const [sort, setSort] = useState<BoardSort>("action");
  const [expanded, setExpanded] = useState<string | null>(null);
  const sorted = sortBoardRows(rows, sort);

  return (
    <div data-testid="markets-board">
      {/* Sort controls. */}
      <div className="mb-3 flex items-center gap-2 text-xs">
        <span className="uppercase tracking-wide text-fg-faint">Sort</span>
        <div className="inline-flex rounded-lg border border-line-soft p-0.5">
          {SORTS.map((s) => (
            <button
              key={s.key}
              type="button"
              onClick={() => setSort(s.key)}
              aria-pressed={sort === s.key}
              data-testid={`sort-${s.key}`}
              className={cx(
                "rounded-md px-2.5 py-1 font-medium transition-colors",
                sort === s.key
                  ? "bg-accent/15 text-accent"
                  : "text-fg-dim hover:text-fg"
              )}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      <div className="panel overflow-hidden p-0">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line-soft text-left text-xs uppercase tracking-wide text-fg-faint">
              <th className="py-2.5 pl-4 pr-2 font-medium">Stock</th>
              <th className="py-2.5 pr-3 text-right font-medium">Price</th>
              <th className="py-2.5 pr-3 text-right font-medium">Today</th>
              <th className="hidden py-2.5 pr-3 font-medium md:table-cell">
                At-the-money bet
              </th>
              <th className="hidden py-2.5 pr-3 text-right font-medium sm:table-cell">
                Liquidity
              </th>
              <th className="py-2.5 pr-4 text-right font-medium">Close</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((row) => (
              <BoardRow
                key={row.symbol}
                row={row}
                expanded={expanded === row.symbol}
                onToggle={() =>
                  setExpanded(expanded === row.symbol ? null : row.symbol)
                }
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function BoardRow({
  row,
  expanded,
  onToggle,
}: {
  row: MarketsBoardRow;
  expanded: boolean;
  onToggle: () => void;
}) {
  const closed = !row.open;
  const up = row.changePct != null && row.changePct >= 0;
  const moveTone =
    row.changePct == null ? "text-fg-faint" : up ? "text-yes" : "text-no";

  return (
    <>
      <tr
        onClick={onToggle}
        aria-expanded={expanded}
        data-testid={`board-row-${row.symbol}`}
        data-closed={closed || undefined}
        className={cx(
          "cursor-pointer border-b border-line-soft/50 transition-colors hover:bg-panel-2/50",
          expanded && "bg-panel-2/40"
        )}
      >
        {/* Stock + sparkline + expand caret. */}
        <td className="py-3 pl-4 pr-2">
          <div className="flex items-center gap-2.5">
            <span
              className={cx(
                "text-fg-faint transition-transform",
                expanded && "rotate-90"
              )}
              aria-hidden
            >
              ▸
            </span>
            <div>
              <div className="font-serif text-base tracking-tight text-fg">
                {row.symbol}
              </div>
              <StatusLine row={row} />
            </div>
            <Sparkline
              values={row.history?.map((p) => p.close) ?? []}
              width={64}
              height={24}
              className="ml-1 hidden shrink-0 lg:block"
            />
          </div>
        </td>

        {/* Price: live for open stocks, the settled close for closed ones. */}
        <td className="py-3 pr-3 text-right">
          <span className="stat-mono text-fg">
            {row.displayPrice != null ? formatDollars(row.displayPrice) : "—"}
          </span>
        </td>

        {/* Today's move: % from open (live), or the settled day's open→close move. */}
        <td className={cx("py-3 pr-3 text-right stat-mono", moveTone)}>
          {row.changePct != null ? (
            <>
              {up ? "▲" : "▼"} {formatPctChange(row.changePct)}
            </>
          ) : (
            "—"
          )}
        </td>

        {/* At-the-money bet. */}
        <td className="hidden py-3 pr-3 md:table-cell">
          <AtmBet row={row} />
        </td>

        {/* Liquidity. */}
        <td className="hidden py-3 pr-3 text-right sm:table-cell">
          <span className="stat-mono text-fg-dim">
            {formatTokens(row.liquidity, 0)}
          </span>
        </td>

        {/* Close: live countdown while open; a plain "Closed" status once settled (the
            per-strike Yes/No outcomes live in the expanded ladder, not here). */}
        <td className="py-3 pr-4 text-right">
          {closed ? (
            <span className="text-xs uppercase tracking-wide text-fg-faint">
              Closed
            </span>
          ) : row.tradingDay ? (
            <Countdown tradingDay={row.tradingDay} variant="inline" />
          ) : (
            <span className="text-xs text-fg-faint">—</span>
          )}
        </td>
      </tr>

      {/* Expanded strike ladder: each strike is a real sibling <tr> in this same table, so its
          cells auto-align under the parent columns (strike→Stock, Yes price→Price, depth→Bet,
          result→Close) and the ladder uses the full board width instead of crowding the left. */}
      {expanded && (
        <StrikeSubRows
          symbol={row.symbol}
          rows={row.rows}
          atmKey={row.atmRow?.address}
        />
      )}
    </>
  );
}

function StrikeSubRows({
  symbol,
  rows,
  atmKey,
}: {
  symbol: string;
  rows: StrikeRow[];
  atmKey?: string;
}) {
  // Descending strikes (high → low), like the trade-page ladder.
  const ladder = [...rows].sort((a, b) => b.strike.cmp(a.strike));
  if (ladder.length === 0) {
    return (
      <tr data-testid={`board-expand-${symbol}`}>
        <td colSpan={6} className="bg-ink-2/40 px-4 py-3 text-xs text-fg-faint">
          No strikes today.
        </td>
      </tr>
    );
  }
  return (
    <>
      {ladder.map((r, i) => (
        <StrikeSubRow
          key={r.address}
          symbol={symbol}
          row={r}
          atm={r.address === atmKey}
          // Tag the first sub-row so tests can scope to the expanded block.
          first={i === 0}
        />
      ))}
    </>
  );
}

/** "3 open" / "Closed" beneath the symbol. */
function StatusLine({ row }: { row: MarketsBoardRow }) {
  if (!row.open) {
    return (
      <div className="text-[0.7rem] uppercase tracking-wide text-fg-faint">
        Closed
      </div>
    );
  }
  const openCount = row.rows.filter((r) => r.state === "open").length;
  return (
    <div className="text-[0.7rem] uppercase tracking-wide text-accent">
      {openCount} open
    </div>
  );
}

/**
 * The middle column: the featured nearest-the-money bet for an open stock
 * ("≥$210 · Yes $0.66 · 66%"), or a "closed · N strikes" hint for a settled one — which still
 * invites the click (expand to see how each strike resolved).
 */
function AtmBet({ row }: { row: MarketsBoardRow }) {
  if (!row.open) {
    const n = row.rows.length;
    return (
      <span className="text-xs text-fg-faint">
        closed · {n} strike{n === 1 ? "" : "s"}
      </span>
    );
  }
  if (!row.atmRow) {
    return <span className="text-xs text-fg-faint">no open market</span>;
  }
  const r = row.atmRow;
  return (
    <span className="stat-mono text-sm">
      <span className="text-fg-dim">≥{formatUsdc(r.strike, 0)}</span>{" "}
      <span className="text-yes">Yes {formatPrice(r.yesPrice)}</span>{" "}
      <span className="text-fg-faint">{formatProbability(r.yesPrice)}</span>
    </span>
  );
}

/** The full strike ladder for a stock, shown inline when its row is expanded. */
/**
 * One strike as a table sub-row aligned to the parent columns: strike under STOCK, Yes price
 * under PRICE, implied % under TODAY, the depth bar under AT-THE-MONEY BET, resting size under
 * LIQUIDITY, and the Yes/No result (or "at the money") under CLOSE. Clicking deep-links to the
 * strike's trade page.
 */
function StrikeSubRow({
  symbol,
  row,
  atm,
  first,
}: {
  symbol: string;
  row: StrikeRow;
  atm: boolean;
  first: boolean;
}) {
  const router = useRouter();
  const dollars = row.strike.toNumber() / STRIKE_SCALE;
  const settled = row.state === "settled";
  const yesWon = row.outcome === Outcome.YesWins;
  const noWon = row.outcome === Outcome.NoWins;
  const href = `/trade/${symbol}?strike=${dollars}`;
  return (
    <tr
      onClick={() => router.push(href)}
      data-testid={`strip-row-${row.strike.toString()}`}
      // The first sub-row also carries the block id so tests/consumers can locate the expansion.
      data-expand-block={first ? `board-expand-${symbol}` : undefined}
      className={cx(
        "cursor-pointer bg-ink-2/40 font-mono text-xs tabular-nums transition-colors hover:bg-panel-2/60",
        atm && "bg-accent/10"
      )}
    >
      {/* STOCK → strike (indented to sit under the symbol). */}
      <td className="py-2 pl-10 pr-2 text-fg">≥{formatUsdc(row.strike, 0)}</td>
      {/* PRICE → Yes price. */}
      <td className="py-2 pr-3 text-right text-yes">
        Yes {formatPrice(row.yesPrice)}
      </td>
      {/* TODAY → implied probability. */}
      <td className="py-2 pr-3 text-right text-fg-dim">
        {formatProbability(row.yesPrice)}
      </td>
      {/* AT-THE-MONEY BET → the depth bar (this is the wide column). */}
      <td className="hidden py-2 pr-3 md:table-cell">
        <div className="flex items-center gap-2">
          <DepthBar view={row.depth} className="w-28" />
          {atm && !settled && (
            <span className="text-[0.65rem] uppercase tracking-wide text-accent">
              at the money
            </span>
          )}
        </div>
      </td>
      {/* LIQUIDITY → resting size. */}
      <td className="hidden py-2 pr-3 text-right text-fg-faint sm:table-cell">
        sz {formatTokens(row.restingSize, 0)}
      </td>
      {/* CLOSE → the per-strike result (settled) or a tradable hint (open). */}
      <td className="py-2 pr-4 text-right">
        {settled ? (
          <span
            className={cx(
              "text-[0.65rem] uppercase tracking-wide",
              yesWon ? "text-yes" : noWon ? "text-no" : "text-fg-faint"
            )}
          >
            {yesWon ? "Yes won" : noWon ? "No won" : "Settled"}
          </span>
        ) : (
          <span className="text-[0.65rem] uppercase tracking-wide text-accent">
            Trade →
          </span>
        )}
      </td>
    </tr>
  );
}
