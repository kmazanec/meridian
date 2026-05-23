"use client";

import { useEffect, useState } from "react";
import type BN from "bn.js";
import { countdownTo, formatCountdown } from "@/lib/countdown";

/**
 * A live ticking countdown to the market's 4:00 PM ET settlement instant
 * (`Market.trading_day`, already a unix timestamp). Re-renders each second; the running
 * value reads brand gold (the "settles by the bell" moment), switching to amber "Closed"
 * once past the close. `variant="inline"` is the compact form for the trade hero; the
 * default `"panel"` is the standalone card used on summary surfaces.
 */
export function Countdown({
  tradingDay,
  variant = "panel",
}: {
  tradingDay: BN | number;
  variant?: "panel" | "inline";
}) {
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const c = countdownTo(tradingDay, nowMs);
  const value = c.closed ? "text-amber" : "text-accent";

  if (variant === "inline") {
    return (
      <div className="text-left sm:text-right" data-testid="countdown">
        <div className="text-[0.65rem] uppercase tracking-wide text-fg-faint">
          {c.closed ? "Market closed" : "Settles in · 4:00 PM ET"}
        </div>
        <div className={`stat-mono text-xl ${value}`}>{formatCountdown(c)}</div>
      </div>
    );
  }

  return (
    <div className="panel p-4 text-center" data-testid="countdown">
      <div className="text-xs uppercase tracking-wide text-fg-faint">
        Settles in (4:00 PM ET)
      </div>
      <div className={`stat-mono mt-1 text-2xl ${value}`}>
        {formatCountdown(c)}
      </div>
    </div>
  );
}
