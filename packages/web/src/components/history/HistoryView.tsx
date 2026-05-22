import type { HistoryEntry } from "@/lib/history";
import { formatPrice, formatTokens, shortKey } from "@/lib/format";
import { Panel, cx } from "@/components/ui";

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
}: {
  entries: HistoryEntry[];
  connected: boolean;
  loading?: boolean;
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
        <h1 className="font-serif text-3xl text-fg">History</h1>
        <p className="mt-1 text-fg-dim">Your trade execution log.</p>
      </header>

      {entries.length === 0 ? (
        <Panel>
          <p className="text-sm text-fg-faint">
            {loading ? "Loading…" : "No activity yet."}
          </p>
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
                {e.size && <div>{formatTokens(e.size)} tok</div>}
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
