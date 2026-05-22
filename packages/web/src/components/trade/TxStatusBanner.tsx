import type { SendState } from "@/lib/useSendIx";
import { shortKey } from "@/lib/format";

/** Inline transaction status for the trade surface (signing → confirming → result). */
export function TxStatusBanner({ state }: { state: SendState }) {
  if (state.status === "idle") return null;

  if (state.status === "signing" || state.status === "confirming") {
    return (
      <div
        role="status"
        className="rounded-lg border border-line bg-panel-2 p-3 text-sm text-fg-dim"
      >
        {state.status === "signing"
          ? "Awaiting wallet approval…"
          : "Confirming transaction…"}
      </div>
    );
  }

  if (state.status === "success") {
    return (
      <div
        role="status"
        className="rounded-lg border border-accent/40 bg-accent/10 p-3 text-sm text-accent"
      >
        Confirmed{state.signature ? ` · ${shortKey(state.signature)}` : ""}.
      </div>
    );
  }

  return (
    <div
      role="alert"
      className="rounded-lg border border-no/40 bg-no/10 p-3 text-sm text-no"
    >
      {state.error?.message ?? "Transaction failed."}
    </div>
  );
}
