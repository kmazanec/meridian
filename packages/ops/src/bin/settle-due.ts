#!/usr/bin/env node
/**
 * CLI: close (settle) every open market whose trading day has ended, at the synthetic close.
 *
 * The demo/dev equivalent of the production settlement cron — run it once after a (compressed)
 * trading day ends. Settles via `admin_settle` at the synthetic close from `/api/price` (the
 * curve the bots traded against), so markets resolve coherently. Idempotent.
 *
 * Needs: RPC_URL, DEPLOYER_KEYPAIR (admin), WEB_BASE_URL (serves /api/price), and the program
 * built with the `demo-fast-settle` feature so admin_settle is callable shortly after close.
 * GRACE_SECONDS optionally widens "due" (settle markets closing within the next N seconds).
 */

import { PublicKey } from "@solana/web3.js";
import { loadOpsEnv } from "../env";
import { createConsoleLog } from "../log";
import { settleDue } from "../settleDue";
import { requireManifest } from "../manifest";

async function main(): Promise<void> {
  const env = loadOpsEnv();
  const log = createConsoleLog();
  log.section(`Settle due markets (${env.cluster})`);

  const manifest = requireManifest();
  if (!manifest.usdcMint) {
    throw new Error("Deploy manifest has no USDC mint — run bootstrap first.");
  }
  if (!env.webBaseUrl) {
    throw new Error(
      "WEB_BASE_URL is required (it serves /api/price, the synthetic close source)."
    );
  }

  const grace = Number(process.env.GRACE_SECONDS) || 0;
  const settled = await settleDue({
    rpcUrl: env.rpcUrl,
    deployer: env.deployer,
    usdcMint: new PublicKey(manifest.usdcMint),
    webBaseUrl: env.webBaseUrl,
    graceSeconds: grace,
    log,
  });

  if (settled.length === 0) {
    log.ok(
      "No due markets to settle (none open past their trading day, or all already settled)."
    );
  } else {
    const yes = settled.filter((m) => m.outcome === "YesWins").length;
    log.ok(
      `Settled ${settled.length} market(s) — ${yes} Yes-wins, ${
        settled.length - yes
      } No-wins.`
    );
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(
    `settle-due failed: ${err instanceof Error ? err.message : err}`
  );
  process.exit(1);
});
