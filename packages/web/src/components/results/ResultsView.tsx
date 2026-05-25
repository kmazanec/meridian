import BN from "bn.js";
import { formatUsdc, formatSignedUsdc } from "@/lib/format";
import { formatWinRate, type DailyResults } from "@/lib/results";
import { Panel, cx } from "@/components/ui";

/**
 * The Results page: a recap of the trading day that just settled — net P&L, what the user
 * wagered, earned, and lost, their win rate, and current wallet balance — plus a per-stock
 * breakdown. Presentational: all numbers arrive pre-derived (see `dailyResults`).
 *
 * Honesty: wagered/P&L come from locally-recorded fills, so when `coverageComplete` is false
 * (some fills weren't made in this browser) we qualify the figures. Payout/claimable and the
 * wallet balance are on-chain truths and always shown.
 */
export function ResultsView({
  results,
  tradingDay,
  usdcBalance,
  claimable,
  claimableCount,
  coverageComplete,
  connected,
}: {
  results: DailyResults | null;
  /** The settled day's instant (unix seconds), for the date label. */
  tradingDay: BN | null;
  usdcBalance: BN | null;
  claimable: BN;
  claimableCount: number;
  /** False when some of today's settled positions had no local cost basis. */
  coverageComplete: boolean;
  connected: boolean;
}) {
  if (!connected) {
    return (
      <Panel className="py-12 text-center">
        <p className="text-fg-dim">Connect a wallet to see your results.</p>
      </Panel>
    );
  }

  const hasResults = results !== null && results.positionCount > 0;
  const net = results?.netPnl ?? new BN(0);
  const netTone = net.isNeg() ? "text-no" : "text-yes";

  return (
    <div className="space-y-8">
      <header>
        <div className="text-xs uppercase tracking-widest text-accent">
          Your results
        </div>
        <h1 className="mt-2 font-serif text-3xl tracking-tight text-fg">
          Results
        </h1>
      </header>

      {!hasResults ? (
        <div className="panel py-12 text-center" data-testid="no-results">
          {tradingDay === null ? (
            <>
              <p className="text-fg-dim">No settled results yet.</p>
              <p className="mt-1 text-sm text-fg-faint">
                Once today&rsquo;s markets settle at the close, your recap shows
                up here.
              </p>
            </>
          ) : (
            <>
              <p className="text-fg-dim">No results for this wallet.</p>
              <p className="mt-1 text-sm text-fg-faint">
                Markets have settled, but this recap is built from the trades
                you placed <em>in this browser</em> — so a wallet you
                haven&rsquo;t traded with here (or trades made elsewhere)
                won&rsquo;t appear.
              </p>
            </>
          )}
        </div>
      ) : (
        <>
          {/* Today hero */}
          <section
            className="panel overflow-hidden p-0"
            data-testid="today-recap"
          >
            <div className="flex items-baseline justify-between gap-4 border-b border-line-soft px-5 py-4">
              <div>
                <div className="text-xs uppercase tracking-widest text-accent">
                  Today
                </div>
                <div className="mt-0.5 text-sm text-fg-dim">
                  {formatTradingDay(tradingDay)} · settled 4:00 PM ET
                </div>
              </div>
              <div className="text-right">
                <div className={cx("stat-mono text-3xl", netTone)}>
                  {formatSignedUsdc(net)}
                </div>
                <div className="text-[0.65rem] uppercase tracking-wide text-fg-faint">
                  Net P&amp;L
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 divide-line-soft sm:grid-cols-4 sm:divide-x">
              <RecapStat
                label="Wagered"
                value={formatUsdc(results.wagered)}
                tone="usdc"
                sub={`${results.positionCount} position${
                  results.positionCount === 1 ? "" : "s"
                }`}
                className="border-b border-line-soft sm:border-b-0"
              />
              <RecapStat
                label="Earned"
                value={formatUsdc(results.earned)}
                tone="yes"
                sub={`${results.wonCount} won`}
                className="border-b border-line-soft sm:border-b-0"
              />
              <RecapStat
                label="Lost"
                value={formatUsdc(results.lost)}
                tone="no"
                sub={`${results.lostCount} lost`}
                className="border-b border-line-soft sm:border-b-0"
              />
              <RecapStat
                label="Win rate"
                value={formatWinRate(results.winRate)}
                tone="accent"
                sub={`${results.wonCount} / ${results.positionCount}`}
              />
            </div>

            <div className="flex flex-col gap-1 border-t border-line-soft bg-panel-2/40 px-5 py-3 text-xs text-fg-faint sm:flex-row sm:items-center sm:justify-between">
              <span>
                Wallet balance{" "}
                <span className="stat-mono text-usdc">
                  {usdcBalance ? formatUsdc(usdcBalance) : "—"}
                </span>
                {claimable.gtn(0) && (
                  <>
                    {" · "}
                    <span className="stat-mono text-accent">
                      {formatUsdc(claimable)} claimable
                    </span>{" "}
                    ({claimableCount} to redeem on Portfolio)
                  </>
                )}
              </span>
              {!coverageComplete && (
                <span className="text-fg-faint">
                  ↳ Wagered &amp; P&amp;L reflect trades placed in this browser.
                </span>
              )}
            </div>
          </section>

          {/* Today by stock */}
          <section>
            <h2 className="mb-3 text-sm uppercase tracking-wide text-fg-faint">
              Today by stock
            </h2>
            <div
              className="panel overflow-hidden p-0"
              data-testid="results-by-stock"
            >
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-line-soft text-left text-xs uppercase tracking-wide text-fg-faint">
                    <th className="px-4 py-2.5 font-medium">Stock</th>
                    <th className="px-4 py-2.5 text-right font-medium">
                      Wagered
                    </th>
                    <th className="px-4 py-2.5 text-right font-medium">
                      Earned
                    </th>
                    <th className="px-4 py-2.5 text-right font-medium">Net</th>
                    <th className="px-4 py-2.5 text-right font-medium">
                      Record
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {results.byStock.map((s) => (
                    <tr
                      key={s.ticker}
                      className="border-b border-line-soft/60 last:border-0"
                    >
                      <td className="px-4 py-3 font-serif text-fg">
                        {s.symbol}
                      </td>
                      <td className="stat-mono px-4 py-3 text-right text-fg-dim">
                        {formatUsdc(s.wagered)}
                      </td>
                      <td className="stat-mono px-4 py-3 text-right text-yes">
                        {formatUsdc(s.earned)}
                      </td>
                      <td
                        className={cx(
                          "stat-mono px-4 py-3 text-right",
                          s.net.isNeg() ? "text-no" : "text-yes"
                        )}
                      >
                        {formatSignedUsdc(s.net)}
                      </td>
                      <td className="stat-mono px-4 py-3 text-right text-fg-faint">
                        {s.wonCount}–{s.lostCount}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  );
}

function RecapStat({
  label,
  value,
  tone,
  sub,
  className,
}: {
  label: string;
  value: string;
  tone: "usdc" | "yes" | "no" | "accent";
  sub: string;
  className?: string;
}) {
  const t =
    tone === "usdc"
      ? "text-usdc"
      : tone === "yes"
      ? "text-yes"
      : tone === "no"
      ? "text-no"
      : "text-accent";
  return (
    <div className={cx("p-4", className)}>
      <div className="text-xs uppercase tracking-wide text-fg-faint">
        {label}
      </div>
      <div className={cx("stat-mono mt-1 text-2xl", t)}>{value}</div>
      <div className="mt-0.5 text-xs text-fg-faint">{sub}</div>
    </div>
  );
}

/** "Thu, May 23" from a unix-seconds BN, in the viewer's local time. */
function formatTradingDay(tradingDay: BN | null): string {
  if (!tradingDay) return "—";
  return new Date(tradingDay.toNumber() * 1000).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}
