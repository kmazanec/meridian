"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import { useConfig, useMarkets, useUsdcMint } from "@/lib/useChain";
import { useProgram } from "@/lib/useProgram";
import { useSendIx } from "@/lib/useSendIx";
import { isAdmin } from "@/lib/adminForm";
import { ConnectGate } from "@/components/ConnectGate";
import { Panel } from "@/components/ui";
import { TxStatusBanner } from "@/components/trade/TxStatusBanner";
import { PauseControl } from "./PauseControl";
import { SettleControl } from "./SettleControl";
import { AddStrikeControl } from "./AddStrikeControl";

/**
 * Operator console (gated to the on-chain Config admin). Exposes the brief's admin
 * functions — pause/unpause, admin_settle, add_strike — each a single wallet approval via
 * the SDK builders. Market creation is intentionally NOT here: it's many txs and is handled
 * by the cron morning job / `make create-markets-devnet`.
 */
export function AdminView() {
  const program = useProgram();
  const { publicKey } = useWallet();
  const { data: config } = useConfig();
  const { data: markets, refresh: refreshMarkets } = useMarkets();
  const usdcMint = useUsdcMint();
  const tx = useSendIx();

  const admin = isAdmin(publicKey, config?.admin);
  const busy = tx.status === "signing" || tx.status === "confirming";

  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-serif text-3xl text-fg">Admin</h1>
        <p className="mt-1 text-sm text-fg-dim">
          Operator controls. Every action is signed by your wallet and gated
          on-chain to the Config admin.
        </p>
      </header>

      <ConnectGate prompt="Connect the admin wallet to manage Meridian.">
        {!config ? (
          <Panel>
            <p className="text-fg-dim">Loading config…</p>
          </Panel>
        ) : !admin ? (
          <Panel>
            <p className="text-no">
              This wallet is not the Config admin. Connect the admin wallet to
              use these controls.
            </p>
            <p className="mt-2 text-xs text-fg-faint">
              Admin: <span className="stat-mono">{config.admin.toBase58()}</span>
            </p>
          </Panel>
        ) : (
          <div className="space-y-6">
            <TxStatusBanner state={tx} />
            <PauseControl
              program={program}
              admin={publicKey!}
              paused={config.paused}
              tx={tx}
              busy={busy}
            />
            <SettleControl
              program={program}
              admin={publicKey!}
              markets={markets ?? []}
              tx={tx}
              busy={busy}
              onSettled={refreshMarkets}
            />
            <AddStrikeControl
              program={program}
              admin={publicKey!}
              usdcMint={usdcMint}
              tx={tx}
              busy={busy}
              onAdded={refreshMarkets}
            />
          </div>
        )}
      </ConnectGate>
    </div>
  );
}
