import { TICKER_SYMBOLS } from "@meridian/sdk";
import type { PortfolioRow, OpenRow, SettledRow } from "@/lib/portfolio";
import {
  formatPrice,
  formatTokens,
  formatUsdc,
  formatSignedUsdc,
} from "@/lib/format";
import { Panel, Button, Price, cx } from "@/components/ui";

/**
 * The portfolio: open positions with entry vs current price and P&L, plus settled
 * outcomes with their payout and a redeem button for winners. Presentational — rows
 * and the redeem handler are passed in.
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
      <Panel>
        <p className="text-fg-dim">Connect a wallet to see your positions.</p>
      </Panel>
    );
  }

  const open = rows.filter((r): r is OpenRow => r.kind === "open");
  const settled = rows.filter((r): r is SettledRow => r.kind === "settled");

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
          <div className="space-y-2" data-testid="open-positions">
            {open.map((r) => (
              <OpenPositionRow key={`${r.market}:${r.side}`} row={r} />
            ))}
          </div>
        )}
      </section>

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
          <div className="space-y-2" data-testid="settled-positions">
            {settled.map((r) => {
              const key = `${r.market}:${r.side}`;
              return (
                <Panel key={key} className="flex items-center justify-between">
                  <div>
                    <PositionLabel
                      ticker={r.ticker}
                      strikeLabel={formatUsdc(r.strike)}
                      side={r.side}
                      amount={formatTokens(r.amount)}
                    />
                    <div className="mt-1 text-sm">
                      Payout: <Price tone="usdc">{formatUsdc(r.payout)}</Price>
                    </div>
                  </div>
                  {r.redeemable ? (
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
                  )}
                </Panel>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

function OpenPositionRow({ row }: { row: OpenRow }) {
  const pnlTone =
    row.pnl === null ? "" : row.pnl.isNeg() ? "text-no" : "text-yes";
  return (
    <Panel className="flex items-center justify-between">
      <PositionLabel
        ticker={row.ticker}
        strikeLabel={formatUsdc(row.strike)}
        side={row.side}
        amount={formatTokens(row.amount)}
      />
      <div className="flex items-center gap-6 text-right font-mono text-sm">
        <div>
          <div className="text-xs uppercase tracking-wide text-fg-faint">
            Entry
          </div>
          <div className="text-fg-dim">
            {row.entryPrice ? formatPrice(row.entryPrice) : "—"}
          </div>
        </div>
        <div>
          <div className="text-xs uppercase tracking-wide text-fg-faint">
            Mark
          </div>
          <div className="text-fg">{formatPrice(row.markPrice)}</div>
        </div>
        <div>
          <div className="text-xs uppercase tracking-wide text-fg-faint">
            P&amp;L
          </div>
          <div className={cx(pnlTone)} data-testid="pnl">
            {row.pnl === null ? "—" : formatSignedUsdc(row.pnl)}
          </div>
        </div>
      </div>
    </Panel>
  );
}

function PositionLabel({
  ticker,
  strikeLabel,
  side,
  amount,
}: {
  ticker: number;
  strikeLabel: string;
  side: "yes" | "no";
  amount: string;
}) {
  return (
    <div className="font-mono text-sm">
      <span className="text-fg">{TICKER_SYMBOLS[ticker]}</span>{" "}
      <span className="text-fg-dim">{strikeLabel}</span>{" "}
      <span className={side === "yes" ? "text-yes" : "text-no"}>
        {side === "yes" ? "Yes" : "No"}
      </span>{" "}
      <span className="text-fg-faint">×{amount}</span>
    </div>
  );
}
