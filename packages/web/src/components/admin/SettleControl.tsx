"use client";

import { useState } from "react";
import type { PublicKey } from "@solana/web3.js";
import {
  adminSettle,
  tickerToSymbol,
  type MeridianProgram,
} from "@meridian/sdk";
import type { DiscoveredMarket } from "@/lib/discovery";
import { parseDollarsToBaseUnits, formatBaseUnitsUsd } from "@/lib/adminForm";
import type { SendState } from "@/lib/useSendIx";
import { Panel, Button } from "@/components/ui";

/**
 * admin_settle: settle a chosen open market with an explicit closing price (the override /
 * "settle now" path). The program still enforces the post-close time delay, so a too-early
 * attempt fails on-chain — surfaced via the shared tx banner.
 */
export function SettleControl({
  program,
  admin,
  markets,
  tx,
  busy,
  onSettled,
}: {
  program: MeridianProgram;
  admin: PublicKey;
  markets: DiscoveredMarket[];
  tx: {
    send: (
      ixs: import("@solana/web3.js").TransactionInstruction[]
    ) => Promise<unknown>;
    status: SendState["status"];
  };
  busy: boolean;
  onSettled?: () => void;
}) {
  const open = markets.filter((m) => m.state === "open");
  const [marketKey, setMarketKey] = useState("");
  const [price, setPrice] = useState("");
  const [err, setErr] = useState<string | null>(null);

  const onSettle = async () => {
    setErr(null);
    const market = open.find((m) => m.address.toBase58() === marketKey);
    if (!market) {
      setErr("Pick a market to settle.");
      return;
    }
    const parsed = parseDollarsToBaseUnits(price);
    if (!parsed.ok) {
      setErr(parsed.error);
      return;
    }
    const ix = await adminSettle(program, {
      admin,
      market: market.address,
      settlementPrice: parsed.value,
    });
    await tx.send([ix]);
    onSettled?.();
  };

  return (
    <Panel className="space-y-3">
      <h2 className="font-serif text-xl text-fg">Settle now (override)</h2>
      <p className="text-sm text-fg-dim">
        Settle an open market at an explicit closing price. The program enforces
        the post-close time delay before this is allowed.
      </p>

      {open.length === 0 ? (
        <p className="text-sm text-fg-faint">No open markets to settle.</p>
      ) : (
        <>
          <label className="block text-xs uppercase tracking-wide text-fg-faint">
            Market
            <select
              className="mt-1 block w-full rounded-lg border border-line bg-panel-2 p-2 text-sm text-fg"
              value={marketKey}
              onChange={(e) => setMarketKey(e.target.value)}
            >
              <option value="">Select…</option>
              {open.map((m) => (
                <option key={m.address.toBase58()} value={m.address.toBase58()}>
                  {tickerToSymbol(m.ticker)} ≥ {formatBaseUnitsUsd(m.strike)}
                </option>
              ))}
            </select>
          </label>

          <label className="block text-xs uppercase tracking-wide text-fg-faint">
            Settlement price (USD)
            <input
              className="mt-1 block w-full rounded-lg border border-line bg-panel-2 p-2 text-sm text-fg"
              inputMode="decimal"
              placeholder="e.g. 685.00"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
            />
          </label>

          {err && <p className="text-sm text-no">{err}</p>}

          <Button variant="accent" onClick={onSettle} disabled={busy}>
            Settle market
          </Button>
        </>
      )}
    </Panel>
  );
}
