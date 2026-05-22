import type { PublicKey } from "@solana/web3.js";
import type { DiscoveredMarket } from "@/lib/discovery";
import { formatUsdc } from "@/lib/format";
import { cx } from "@/components/ui";

/**
 * The strikes available for a stock. Clicking one selects it as the active market on
 * the trade page. Settled strikes are still listed (read-only) but visually muted.
 */
export function StrikeList({
  strikes,
  selected,
  onSelect,
}: {
  strikes: DiscoveredMarket[];
  selected: PublicKey | null;
  onSelect: (m: DiscoveredMarket) => void;
}) {
  if (strikes.length === 0) {
    return (
      <div className="panel p-4 text-sm text-fg-faint">
        No strikes yet for this stock today.
      </div>
    );
  }
  return (
    <div className="panel p-2" role="listbox" aria-label="Strikes">
      {strikes.map((m) => {
        const isSelected = !!selected && selected.equals(m.address);
        return (
          <button
            key={m.address.toBase58()}
            role="option"
            aria-selected={isSelected}
            onClick={() => onSelect(m)}
            className={cx(
              "flex w-full items-center justify-between rounded-lg px-3 py-2 text-left font-mono text-sm transition-colors",
              isSelected
                ? "bg-accent/15 text-accent"
                : "text-fg-dim hover:bg-panel-2"
            )}
          >
            <span>{formatUsdc(m.strike, 2)}</span>
            <span
              className={cx(
                "text-xs uppercase tracking-wide",
                m.state === "settled" ? "text-fg-faint" : "text-accent-dim"
              )}
            >
              {m.state}
            </span>
          </button>
        );
      })}
    </div>
  );
}
