"use client";

import { useEffect, useState } from "react";
import type BN from "bn.js";
import { countdownTo, formatCountdown } from "@/lib/countdown";

/**
 * A live ticking countdown to the market's 4:00 PM ET settlement instant
 * (`Market.trading_day`, already a unix timestamp). Re-renders each second; shows
 * "Closed" once past the close.
 */
export function Countdown({ tradingDay }: { tradingDay: BN | number }) {
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const c = countdownTo(tradingDay, nowMs);
  return (
    <div className="panel p-4 text-center" data-testid="countdown">
      <div className="text-xs uppercase tracking-wide text-fg-faint">
        Settles in (4:00 PM ET)
      </div>
      <div
        className={`stat-mono mt-1 text-2xl ${
          c.closed ? "text-amber" : "text-fg"
        }`}
      >
        {formatCountdown(c)}
      </div>
    </div>
  );
}
