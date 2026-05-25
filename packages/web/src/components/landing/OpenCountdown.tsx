"use client";

import { useEffect, useState } from "react";
import { nextOpenInstant } from "@meridian/sdk";
import { countdownTo, formatCountdown } from "@/lib/countdown";
import { formatOpenLabel } from "@/lib/format";

/**
 * The closed-board hero: a live, dramatic countdown to the next opening bell (9:30 AM ET on
 * the next trading session, weekends and NYSE holidays skipped — {@link nextOpenInstant}).
 * Re-renders each second, and once the bell rings it recomputes the *next* session so the
 * clock never sits at zero. This is what keeps the page exciting when the board is dark:
 * instead of a row of zeros, the page anticipates the open and tells you exactly when.
 *
 * The board markets are on a poll, so when the morning job lights up the new session the rest
 * of the page swaps to the live state on its own; this component just owns the wait.
 */
export function OpenCountdown() {
  // Seed from the client clock. Computed lazily so SSR/first paint and the ticking client
  // agree on the same target (recomputed only when it elapses).
  const [openTs, setOpenTs] = useState<number | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    setOpenTs(nextOpenInstant());
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  // Once the bell rings, roll to the next session so the clock never freezes at 00:00:00.
  useEffect(() => {
    if (openTs != null && openTs * 1000 <= nowMs) {
      setOpenTs(nextOpenInstant(new Date(nowMs + 1000)));
    }
  }, [openTs, nowMs]);

  const c = openTs != null ? countdownTo(openTs, nowMs) : null;

  return (
    <div className="text-center" data-testid="open-countdown">
      <div className="text-xs uppercase tracking-[0.2em] text-fg-faint">
        Trading opens in
      </div>
      <div className="open-countdown-clock stat-mono mt-2 text-5xl text-accent sm:text-6xl">
        {c ? formatCountdown(c) : "—"}
      </div>
      <div className="mt-2 text-sm text-fg-dim">
        Next session{" "}
        <span className="text-fg">
          {openTs != null ? formatOpenLabel(openTs) : "—"}
        </span>
      </div>
    </div>
  );
}
