import type { HistoryEntry } from "@/lib/history";
import { formatPrice, formatTokens, formatUsdc, shortKey } from "@/lib/format";
import { Panel, cx } from "@/components/ui";

/**
 * The right-hand amount for one entry. Most amounts are Yes-token counts; a cancelled
 * *bid* refunds USDC, shown as dollars; a cancel whose side we couldn't recover gets a
 * denomination-neutral "refunded" rather than a (possibly wrong) "tok".
 */
function formatAmount(e: HistoryEntry): string {
  if (!e.size) return "";
  if (e.asset === "usdc") return formatUsdc(e.size);
  if (e.asset === null) return `${formatTokens(e.size)} refunded`;
  return `${formatTokens(e.size)} tok`;
}

const KIND_TONE: Record<HistoryEntry["kind"], string> = {
  placed: "text-fg",
  matched: "text-accent",
  minted: "text-usdc",
  redeemed: "text-yes",
  cancelled: "text-fg-faint",
};

/**
 * The trade-execution log: the connected wallet's program activity, newest first.
 * Presentational — entries are passed in (parsed from program events upstream).
 */
export function HistoryView({
  entries,
  connected,
  loading,
  error,
}: {
  entries: HistoryEntry[];
  connected: boolean;
  loading?: boolean;
  /** Set when loading failed (e.g. an RPC without transaction history). */
  error?: Error | null;
}) {
  if (!connected) {
    return (
      <Panel>
        <p className="text-fg-dim">Connect a wallet to see your history.</p>
      </Panel>
    );
  }

  return (
    <div className="space-y-4">
      <header>
        <div className="text-xs uppercase tracking-widest text-accent">
          Activity
        </div>
        <h1 className="mt-2 font-serif text-3xl tracking-tight text-fg">
          History
        </h1>
        <p className="mt-1 text-fg-dim">
          Every order, fill, mint, and redemption your wallet has signed.
        </p>
      </header>

      {error && entries.length === 0 ? (
        <div className="panel py-10 text-center" data-testid="history-error">
          <p className="text-sm text-no">Couldn't load your history.</p>
          <p className="mx-auto mt-1 max-w-md text-xs text-fg-faint">
            The RPC didn't return transaction history. A local validator must
            run with{" "}
            <span className="font-mono">--enable-rpc-transaction-history</span>,
            and some providers prune older signatures.
          </p>
        </div>
      ) : entries.length === 0 ? (
        <Panel className="py-10 text-center">
          <p className="text-sm text-fg-dim">
            {loading ? "Loading your activity…" : "No activity yet."}
          </p>
          {!loading && (
            <p className="mt-1 text-xs text-fg-faint">
              Your trades will show up here as you make them.
            </p>
          )}
        </Panel>
      ) : (
        <div
          className="panel divide-y divide-line-soft"
          data-testid="history-log"
        >
          {entries.map((e) => (
            <div
              key={`${e.signature}:${e.kind}:${e.market}`}
              className="flex items-center justify-between px-4 py-3"
            >
              <div>
                <div className={cx("font-mono text-sm", KIND_TONE[e.kind])}>
                  {e.summary}
                </div>
                <div className="mt-0.5 text-xs text-fg-faint">
                  {shortKey(e.market)} · {formatTime(e.blockTime)}
                </div>
              </div>
              <div className="text-right font-mono text-sm tabular-nums text-fg-dim">
                {e.size && <div>{formatAmount(e)}</div>}
                {e.price && (
                  <div className="text-fg-faint">{formatPrice(e.price)}</div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function formatTime(blockTime: number | null): string {
  if (!blockTime) return "—";
  return new Date(blockTime * 1000).toLocaleString();
}
