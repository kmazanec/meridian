"use client";

import { useState } from "react";
import BN from "bn.js";
import type { PublicKey } from "@solana/web3.js";
import {
  addStrike,
  closeInstant,
  symbolToTicker,
  TICKER_SYMBOLS,
  type MeridianProgram,
} from "@meridian/sdk";
import { parseDollarsToBaseUnits } from "@/lib/adminForm";
import type { SendState } from "@/lib/useSendIx";
import { Panel, Button } from "@/components/ui";

/**
 * add_strike: provision an extra strike for a stock intraday (Market + Yes/No mints + vault).
 * The new market closes at today's session close (4:00 PM ET, 1:00 PM on half-days) — the
 * same `trading_day` the morning job uses, so an intraday strike settles with the day's
 * other markets. (The 2h test window is a script-only convention, not used from the UI.)
 * Requires the USDC mint (from Config).
 */
export function AddStrikeControl({
  program,
  admin,
  usdcMint,
  tx,
  busy,
  onAdded,
}: {
  program: MeridianProgram;
  admin: PublicKey;
  usdcMint: PublicKey | null;
  tx: {
    send: (
      ixs: import("@solana/web3.js").TransactionInstruction[]
    ) => Promise<unknown>;
    status: SendState["status"];
  };
  busy: boolean;
  onAdded?: () => void;
}) {
  const [symbol, setSymbol] = useState<string>(TICKER_SYMBOLS[0]);
  const [strike, setStrike] = useState("");
  const [err, setErr] = useState<string | null>(null);

  const onAdd = async () => {
    setErr(null);
    if (!usdcMint) {
      setErr("USDC mint unavailable (config not loaded).");
      return;
    }
    const parsed = parseDollarsToBaseUnits(strike);
    if (!parsed.ok) {
      setErr(parsed.error);
      return;
    }
    // Close at today's session close (4:00 PM ET, 1:00 PM on half-days) — the same
    // trading_day the morning job uses, so the strike settles with the day's markets.
    // closeInstant throws off-session (weekend/holiday); surface that instead of crashing.
    let tradingDay: BN;
    try {
      tradingDay = new BN(closeInstant(new Date()));
    } catch {
      setErr("Market is closed today — add strikes during a trading session.");
      return;
    }
    const ix = await addStrike(program, {
      admin,
      usdcMint,
      market: {
        ticker: symbolToTicker(symbol),
        strike: parsed.value,
        tradingDay,
      },
    });
    await tx.send([ix]);
    onAdded?.();
  };

  return (
    <Panel className="space-y-3">
      <h2 className="font-serif text-xl text-fg">Add strike</h2>
      <p className="text-sm text-fg-dim">
        Add an extra strike for a stock. The new market opens immediately and
        closes at today&rsquo;s market close (4:00 PM ET).
      </p>

      <div className="grid grid-cols-2 gap-3">
        <label className="block text-xs uppercase tracking-wide text-fg-faint">
          Stock
          <select
            className="mt-1 block w-full rounded-lg border border-line bg-panel-2 p-2 text-sm text-fg"
            value={symbol}
            onChange={(e) => setSymbol(e.target.value)}
          >
            {TICKER_SYMBOLS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>

        <label className="block text-xs uppercase tracking-wide text-fg-faint">
          Strike (USD)
          <input
            className="mt-1 block w-full rounded-lg border border-line bg-panel-2 p-2 text-sm text-fg"
            inputMode="decimal"
            placeholder="e.g. 700"
            value={strike}
            onChange={(e) => setStrike(e.target.value)}
          />
        </label>
      </div>

      {err && <p className="text-sm text-no">{err}</p>}

      <Button variant="accent" onClick={onAdd} disabled={busy}>
        Add strike
      </Button>
    </Panel>
  );
}
