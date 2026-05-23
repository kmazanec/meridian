"use client";

import type { PublicKey } from "@solana/web3.js";
import { pause, unpause, type MeridianProgram } from "@meridian/sdk";
import type { SendState } from "@/lib/useSendIx";
import { Panel, Button } from "@/components/ui";

/**
 * Emergency switch: toggle Config.paused. When paused, the program blocks minting and
 * trading. Shows the current state and the single action that flips it.
 */
export function PauseControl({
  program,
  admin,
  paused,
  tx,
  busy,
}: {
  program: MeridianProgram;
  admin: PublicKey;
  paused: boolean;
  tx: {
    send: (
      ixs: import("@solana/web3.js").TransactionInstruction[]
    ) => Promise<unknown>;
    status: SendState["status"];
  };
  busy: boolean;
}) {
  const onToggle = async () => {
    const ix = paused
      ? await unpause(program, { admin })
      : await pause(program, { admin });
    await tx.send([ix]);
  };

  return (
    <Panel className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="font-serif text-xl text-fg">Pause</h2>
        <span className={paused ? "stat-mono text-no" : "stat-mono text-yes"}>
          {paused ? "PAUSED" : "ACTIVE"}
        </span>
      </div>
      <p className="text-sm text-fg-dim">
        {paused
          ? "Minting and trading are halted. Unpause to resume."
          : "Minting and trading are live. Pause to halt them in an emergency."}
      </p>
      <Button
        variant={paused ? "yes" : "no"}
        onClick={onToggle}
        disabled={busy}
      >
        {paused ? "Unpause" : "Pause"}
      </Button>
    </Panel>
  );
}
