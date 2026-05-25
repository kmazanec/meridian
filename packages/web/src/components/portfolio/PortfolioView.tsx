import Link from "next/link";
import type BN from "bn.js";
import { TICKER_SYMBOLS } from "@meridian/sdk";
import type { PortfolioRow, OpenRow, SettledRow } from "@/lib/portfolio";
import { portfolioSummary, lifetimeStats } from "@/lib/portfolio";
import type { HistoryEntry } from "@/lib/history";
import {
  formatPrice,
  formatTokens,
  formatUsdc,
  formatSignedUsdc,
  formatSol,
  shortKey,
} from "@/lib/format";
import { Panel, Button, cx } from "@/components/ui";

/**
 * The portfolio: a top-line summary, then open positions and settled outcomes as dense,
 * scannable tables grouped by stock. Each row reads as the bet it is ("AAPL · closes ≥
 * $300 · Yes") with its size, entry, mark, value, and P&L aligned in columns. Settled rows
 * carry their payout and a redeem button for winners.
 *
 * The page stays alive for a wallet with little/no history: a wallet strip (spendable USDC +
 * SOL), a recent settled-position record, and a recent-activity preview surround the position
 * tables, and the empty states invite the next trade with copy that tracks whether the board is
 * open.
 *
 * Presentational — rows, balances, recent activity, and the redeem handler are all passed in.
 */
export function PortfolioView({
  rows,
  onRedeem,
  redeemingKey,
  connected,
  usdcBalance = null,
  solLamports = null,
  recentActivity = [],
  boardOpen = false,
}: {
  rows: PortfolioRow[];
  onRedeem: (row: SettledRow) => void;
  /** `market:side` currently redeeming, to disable its button. */
  redeemingKey?: string | null;
  connected: boolean;
  /** Spendable USDC (base units, 6dp), or null until known. */
  usdcBalance?: BN | null;
  /** Native SOL balance (lamports), or null until known. */
  solLamports?: number | null;
  /** The wallet's most recent on-chain actions (newest first), for the preview. */
  recentActivity?: HistoryEntry[];
  /** Whether any market is open right now — tunes the empty-state copy/CTA. */
  boardOpen?: boolean;
}) {
  if (!connected) {
    return (
      <Panel className="py-12 text-center">
        <p className="text-fg-dim">Connect a wallet to see your positions.</p>
      </Panel>
    );
  }

  const open = rows.filter((r): r is OpenRow => r.kind === "open");
  const settled = rows.filter((r): r is SettledRow => r.kind === "settled");
  const summary = portfolioSummary(rows);
  const record = lifetimeStats(rows);

  return (
    <div className="space-y-8">
      <header>
        <div className="text-xs uppercase tracking-widest text-accent">
          Your book
        </div>
        <h1 className="mt-2 font-serif text-3xl tracking-tight text-fg">
          Portfolio
        </h1>
      </header>

      {/* Wallet balances — what you can spend, always present so the page never reads empty. */}
      <WalletStrip usdcBalance={usdcBalance} solLamports={solLamports} />

      {/* Top-line summary — what's going on, at a glance. */}
      <section
        className="panel grid grid-cols-2 divide-line-soft p-0 sm:grid-cols-4 sm:divide-x"
        data-testid="portfolio-summary"
      >
        <SummaryStat
          label="Position value"
          value={formatUsdc(summary.positionValue)}
          tone="usdc"
          className="border-b border-line-soft sm:border-b-0"
        />
        <SummaryStat
          label="Open P&L"
          value={
            summary.openPnl === null ? "—" : formatSignedUsdc(summary.openPnl)
          }
          tone={
            summary.openPnl === null
              ? undefined
              : summary.openPnl.isNeg()
              ? "no"
              : "yes"
          }
          className="border-b border-line-soft sm:border-b-0"
        />
        <SummaryStat label="Open positions" value={String(summary.openCount)} />
        <SummaryStat
          label="Claimable"
          value={formatUsdc(summary.claimable)}
          tone={summary.claimable.gtn(0) ? "accent" : undefined}
          hint={
            summary.claimableCount > 0
              ? `${summary.claimableCount} to redeem`
              : undefined
          }
        />
      </section>

      {/* Recent record — totals from the recent settled slice (no skew-prone win rate). */}
      {record.decided > 0 && <RecentRecordStrip record={record} />}

      {/* Open positions */}
      <section>
        <h2 className="mb-3 text-sm uppercase tracking-wide text-fg-faint">
          Open positions
        </h2>
        {open.length === 0 ? (
          <OpenPositionsEmpty
            boardOpen={boardOpen}
            hasHistory={rows.length > 0}
          />
        ) : (
          <PositionsTable rows={open} />
        )}
      </section>

      {/* Recent activity — a compact slice of the full History page. */}
      {recentActivity.length > 0 && <RecentActivity entries={recentActivity} />}

      {/* Settled */}
      <section>
        <h2 className="mb-3 text-sm uppercase tracking-wide text-fg-faint">
          Settled
        </h2>
        {settled.length === 0 ? (
          <Panel className="py-10 text-center">
            <p className="text-sm text-fg-dim">Nothing settled yet.</p>
            <p className="mt-1 text-xs text-fg-faint">
              Settled markets and their payouts will appear here after the
              close.
            </p>
          </Panel>
        ) : (
          <SettledTable
            rows={settled}
            onRedeem={onRedeem}
            redeemingKey={redeemingKey}
          />
        )}
      </section>
    </div>
  );
}

/**
 * The wallet strip: spendable USDC + native SOL. Always rendered when connected, so even a
 * brand-new wallet with no positions sees something concrete (and learns it needs SOL for fees).
 */
function WalletStrip({
  usdcBalance,
  solLamports,
}: {
  usdcBalance: BN | null;
  solLamports: number | null;
}) {
  return (
    <section
      className="panel grid grid-cols-2 divide-x divide-line-soft p-0"
      data-testid="wallet-strip"
    >
      <div className="p-4">
        <div className="text-xs uppercase tracking-wide text-fg-faint">
          USDC balance
        </div>
        <div className="stat-mono mt-1 text-xl text-usdc">
          {usdcBalance === null ? "—" : formatUsdc(usdcBalance)}
        </div>
        <div className="mt-0.5 text-xs text-fg-faint">Your stake to trade</div>
      </div>
      <div className="p-4">
        <div className="text-xs uppercase tracking-wide text-fg-faint">
          SOL balance
        </div>
        <div className="stat-mono mt-1 text-xl text-fg">
          {solLamports === null ? "—" : formatSol(solLamports)}
        </div>
        <div className="mt-0.5 text-xs text-fg-faint">Covers network fees</div>
      </div>
    </section>
  );
}

/**
 * The recent record: total won, markets traded, and wins claimed. Deliberately *not* a win
 * rate — the portfolio reconstructs winners from a bounded recent signature scan (to keep the
 * RPC compute-unit cost low), while losers linger as held tokens across all time, so a rate over
 * those two would understate. These three totals are honest from the recent slice on their own.
 */
function RecentRecordStrip({
  record,
}: {
  record: ReturnType<typeof lifetimeStats>;
}) {
  return (
    <section data-testid="recent-record">
      <h2 className="mb-3 text-sm uppercase tracking-wide text-fg-faint">
        Recent
      </h2>
      <div className="panel grid grid-cols-3 divide-x divide-line-soft p-0">
        <SummaryStat
          label="Won"
          value={formatUsdc(record.totalWon)}
          tone={record.totalWon.gtn(0) ? "yes" : undefined}
        />
        <SummaryStat
          label="Markets traded"
          value={String(record.marketsTraded)}
        />
        <SummaryStat
          label="Claimed"
          value={String(record.wins)}
          tone={record.wins > 0 ? "yes" : undefined}
          hint={record.wins === 1 ? "winning bet" : "winning bets"}
        />
      </div>
    </section>
  );
}

/**
 * The open-positions empty state — a real invitation rather than a dead panel. Copy tracks the
 * board: when it's live, nudge toward a trade now; when it's closed, frame the wait. A wallet
 * with prior history gets a lighter nudge ("ready for your next bet") than a fresh one.
 */
function OpenPositionsEmpty({
  boardOpen,
  hasHistory,
}: {
  boardOpen: boolean;
  hasHistory: boolean;
}) {
  return (
    <div className="panel p-5 py-10 text-center" data-testid="open-empty">
      <p className="text-sm text-fg-dim">
        {hasHistory ? "No open positions right now." : "No open positions yet."}
      </p>
      <p className="mx-auto mt-1 max-w-sm text-xs text-fg-faint">
        {boardOpen
          ? "The board is live — pick a stock and take a side."
          : "The board is closed between sessions. New markets open at the 9:30 AM ET bell."}
      </p>
      <div className="mt-4">
        <Link href="/markets">
          <Button variant={boardOpen ? "accent" : "ghost"}>
            {boardOpen ? "Browse markets →" : "See the markets →"}
          </Button>
        </Link>
      </div>
    </div>
  );
}

/** The amount label for a recent-activity row (Yes-tokens, USDC refund, or neutral). */
function activityAmount(e: HistoryEntry): string | null {
  if (!e.size) return null;
  if (e.asset === "usdc") return formatUsdc(e.size);
  if (e.asset === null) return `${formatTokens(e.size)} refunded`;
  return `${formatTokens(e.size)} tok`;
}

const ACTIVITY_TONE: Record<HistoryEntry["kind"], string> = {
  placed: "text-fg",
  matched: "text-accent",
  minted: "text-usdc",
  redeemed: "text-yes",
  cancelled: "text-fg-faint",
};

/** A compact preview of the wallet's latest on-chain actions, linking to the full History page. */
function RecentActivity({ entries }: { entries: HistoryEntry[] }) {
  return (
    <section data-testid="recent-activity">
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="text-sm uppercase tracking-wide text-fg-faint">
          Recent activity
        </h2>
        <Link href="/history" className="text-xs text-accent hover:underline">
          View all →
        </Link>
      </div>
      <div className="panel divide-y divide-line-soft p-0">
        {entries.map((e) => {
          const amount = activityAmount(e);
          return (
            <div
              key={`${e.signature}:${e.kind}:${e.market}`}
              className="flex items-center justify-between px-4 py-2.5"
            >
              <div className="min-w-0">
                <div
                  className={cx(
                    "truncate font-mono text-sm",
                    ACTIVITY_TONE[e.kind]
                  )}
                >
                  {e.summary}
                </div>
                <div className="mt-0.5 text-[0.7rem] text-fg-faint">
                  {shortKey(e.market)} · {formatActivityTime(e.blockTime)}
                </div>
              </div>
              {amount && (
                <div className="stat-mono shrink-0 pl-3 text-sm text-fg-dim">
                  {amount}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

/** A terse "May 23, 2:14 PM" for an activity row (or a dash when the time is unknown). */
function formatActivityTime(blockTime: number | null): string {
  if (!blockTime) return "—";
  return new Date(blockTime * 1000).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function SummaryStat({
  label,
  value,
  tone,
  hint,
  className,
}: {
  label: string;
  value: string;
  tone?: "usdc" | "yes" | "no" | "accent";
  hint?: string;
  className?: string;
}) {
  const t =
    tone === "usdc"
      ? "text-usdc"
      : tone === "yes"
      ? "text-yes"
      : tone === "no"
      ? "text-no"
      : tone === "accent"
      ? "text-accent"
      : "text-fg";
  return (
    <div className={cx("p-4", className)}>
      <div className="text-xs uppercase tracking-wide text-fg-faint">
        {label}
      </div>
      <div className={cx("stat-mono mt-1 text-xl", t)}>{value}</div>
      {hint && <div className="mt-0.5 text-xs text-accent">{hint}</div>}
    </div>
  );
}

/** A small "AAPL · closes ≥ $300" question label + Yes/No side chip. */
function PositionCell({
  ticker,
  strike,
  side,
}: {
  ticker: number;
  strike: BN;
  side: "yes" | "no";
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="font-serif text-sm text-fg">
        {TICKER_SYMBOLS[ticker]}
      </span>
      <span className="stat-mono text-xs text-fg-dim">
        closes ≥ {formatUsdc(strike, 0)}
      </span>
      <span
        className={cx(
          "rounded px-1.5 py-0.5 text-[0.65rem] font-semibold uppercase tracking-wide",
          side === "yes" ? "bg-yes/15 text-yes" : "bg-no/15 text-no"
        )}
      >
        {side}
      </span>
    </div>
  );
}

/** Dense, aligned open-positions table on sm+; stacked cards on mobile. */
function PositionsTable({ rows }: { rows: OpenRow[] }) {
  return (
    <div className="panel overflow-hidden p-0" data-testid="open-positions">
      {/* Desktop / tablet: real table for column alignment. */}
      <table className="hidden w-full text-sm sm:table">
        <thead>
          <tr className="border-b border-line-soft text-left text-xs uppercase tracking-wide text-fg-faint">
            <th className="px-4 py-2.5 font-medium">Position</th>
            <th className="px-4 py-2.5 text-right font-medium">Size</th>
            <th className="px-4 py-2.5 text-right font-medium">Entry</th>
            <th className="px-4 py-2.5 text-right font-medium">Mark</th>
            <th className="px-4 py-2.5 text-right font-medium">Value</th>
            <th className="px-4 py-2.5 text-right font-medium">P&amp;L</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={`${r.market}:${r.side}`}
              className="border-b border-line-soft/60 last:border-0 hover:bg-panel-2/40"
            >
              <td className="px-4 py-3">
                <PositionCell
                  ticker={r.ticker}
                  strike={r.strike}
                  side={r.side}
                />
              </td>
              <td className="stat-mono px-4 py-3 text-right text-fg-dim">
                {formatTokens(r.amount, 0)}
              </td>
              <td className="stat-mono px-4 py-3 text-right text-fg-dim">
                {r.entryPrice ? formatPrice(r.entryPrice) : "—"}
              </td>
              <td className="stat-mono px-4 py-3 text-right text-fg">
                {formatPrice(r.markPrice)}
              </td>
              <td className="stat-mono px-4 py-3 text-right text-usdc">
                {formatUsdc(r.value)}
              </td>
              <td
                className={cx("stat-mono px-4 py-3 text-right", pnlTone(r.pnl))}
                data-testid="pnl"
              >
                {r.pnl === null ? "—" : formatSignedUsdc(r.pnl)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Mobile: stacked cards. */}
      <div className="divide-y divide-line-soft/60 sm:hidden">
        {rows.map((r) => (
          <div key={`${r.market}:${r.side}`} className="p-4">
            <div className="flex items-center justify-between">
              <PositionCell ticker={r.ticker} strike={r.strike} side={r.side} />
              <span
                className={cx("stat-mono text-sm", pnlTone(r.pnl))}
                data-testid="pnl"
              >
                {r.pnl === null ? "—" : formatSignedUsdc(r.pnl)}
              </span>
            </div>
            <div className="mt-2 grid grid-cols-4 gap-2 text-xs">
              <MobileField label="Size" value={formatTokens(r.amount, 0)} />
              <MobileField
                label="Entry"
                value={r.entryPrice ? formatPrice(r.entryPrice) : "—"}
              />
              <MobileField label="Mark" value={formatPrice(r.markPrice)} />
              <MobileField
                label="Value"
                value={formatUsdc(r.value)}
                tone="text-usdc"
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Compact settled table with payout + redeem/lost on sm+; cards on mobile. */
function SettledTable({
  rows,
  onRedeem,
  redeemingKey,
}: {
  rows: SettledRow[];
  onRedeem: (row: SettledRow) => void;
  redeemingKey?: string | null;
}) {
  const action = (r: SettledRow) => {
    const key = `${r.market}:${r.side}`;
    if (r.redeemable) {
      return (
        <Button
          variant="accent"
          data-testid={`redeem-${key}`}
          disabled={redeemingKey === key}
          onClick={() => onRedeem(r)}
        >
          {redeemingKey === key ? "Redeeming…" : "Redeem"}
        </Button>
      );
    }
    if (r.redeemed) {
      // A claimed winner: tokens already burned for USDC. Show it as won, not "Lost".
      return (
        <span className="text-sm text-usdc" data-testid={`claimed-${key}`}>
          Won · claimed
        </span>
      );
    }
    return <span className="text-sm text-fg-faint">Lost</span>;
  };
  return (
    <div className="panel overflow-hidden p-0" data-testid="settled-positions">
      <table className="hidden w-full text-sm sm:table">
        <thead>
          <tr className="border-b border-line-soft text-left text-xs uppercase tracking-wide text-fg-faint">
            <th className="px-4 py-2.5 font-medium">Position</th>
            <th className="px-4 py-2.5 text-right font-medium">Size</th>
            <th className="px-4 py-2.5 text-right font-medium">Payout</th>
            <th className="px-4 py-2.5 text-right font-medium">Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={`${r.market}:${r.side}`}
              className="border-b border-line-soft/60 last:border-0"
            >
              <td className="px-4 py-3">
                <PositionCell
                  ticker={r.ticker}
                  strike={r.strike}
                  side={r.side}
                />
              </td>
              <td className="stat-mono px-4 py-3 text-right text-fg-dim">
                {formatTokens(r.amount, 0)}
              </td>
              <td className="stat-mono px-4 py-3 text-right text-usdc">
                {formatUsdc(r.payout)}
              </td>
              <td className="px-4 py-3 text-right">{action(r)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="divide-y divide-line-soft/60 sm:hidden">
        {rows.map((r) => (
          <div
            key={`${r.market}:${r.side}`}
            className="flex items-center justify-between p-4"
          >
            <div>
              <PositionCell ticker={r.ticker} strike={r.strike} side={r.side} />
              <div className="stat-mono mt-1 text-xs text-usdc">
                Payout {formatUsdc(r.payout)}
              </div>
            </div>
            {action(r)}
          </div>
        ))}
      </div>
    </div>
  );
}

function MobileField({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: string;
}) {
  return (
    <div>
      <div className="text-[0.6rem] uppercase tracking-wide text-fg-faint">
        {label}
      </div>
      <div className={cx("stat-mono", tone ?? "text-fg")}>{value}</div>
    </div>
  );
}

function pnlTone(pnl: BN | null): string {
  if (pnl === null) return "text-fg-faint";
  return pnl.isNeg() ? "text-no" : "text-yes";
}
