import type BN from "bn.js";
import { TICKER_SYMBOLS } from "@meridian/sdk";
import type { PortfolioRow, OpenRow, SettledRow } from "@/lib/portfolio";
import { portfolioSummary } from "@/lib/portfolio";
import {
  formatPrice,
  formatTokens,
  formatUsdc,
  formatSignedUsdc,
} from "@/lib/format";
import { Panel, Button, cx } from "@/components/ui";

/**
 * The portfolio: a top-line summary, then open positions and settled outcomes as dense,
 * scannable tables grouped by stock. Each row reads as the bet it is ("AAPL · closes ≥
 * $300 · Yes") with its size, entry, mark, value, and P&L aligned in columns. Settled rows
 * carry their payout and a redeem button for winners. Presentational — rows and the redeem
 * handler are passed in.
 */
export function PortfolioView({
  rows,
  onRedeem,
  redeemingKey,
  connected,
}: {
  rows: PortfolioRow[];
  onRedeem: (row: SettledRow) => void;
  /** `market:side` currently redeeming, to disable its button. */
  redeemingKey?: string | null;
  connected: boolean;
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

      {/* Open positions */}
      <section>
        <h2 className="mb-3 text-sm uppercase tracking-wide text-fg-faint">
          Open positions
        </h2>
        {open.length === 0 ? (
          <Panel className="py-10 text-center">
            <p className="text-sm text-fg-dim">No open positions yet.</p>
            <p className="mt-1 text-xs text-fg-faint">
              Pick a stock and take a side to get started.
            </p>
          </Panel>
        ) : (
          <PositionsTable rows={open} />
        )}
      </section>

      {/* Settled */}
      <section>
        <h2 className="mb-3 text-sm uppercase tracking-wide text-fg-faint">
          Settled
        </h2>
        {settled.length === 0 ? (
          <Panel className="py-10 text-center">
            <p className="text-sm text-fg-dim">Nothing settled yet.</p>
            <p className="mt-1 text-xs text-fg-faint">
              Settled markets and their payouts will appear here after the close.
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
          side === "yes"
            ? "bg-yes/15 text-yes"
            : "bg-no/15 text-no"
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
                <PositionCell ticker={r.ticker} strike={r.strike} side={r.side} />
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
                className={cx(
                  "stat-mono px-4 py-3 text-right",
                  pnlTone(r.pnl)
                )}
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
    return r.redeemable ? (
      <Button
        variant="accent"
        data-testid={`redeem-${key}`}
        disabled={redeemingKey === key}
        onClick={() => onRedeem(r)}
      >
        {redeemingKey === key ? "Redeeming…" : "Redeem"}
      </Button>
    ) : (
      <span className="text-sm text-fg-faint">Lost</span>
    );
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
                <PositionCell ticker={r.ticker} strike={r.strike} side={r.side} />
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
