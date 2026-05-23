#!/usr/bin/env node
/**
 * CLI: create the day's markets on the deployed + bootstrapped program. Reads the program +
 * USDC mint from the deploy manifest (written by deploy/bootstrap) and the previous closes
 * from `MOCK_CLOSE_<SYMBOL>` env vars. Idempotent — existing strikes are skipped.
 *
 * Trading day: defaults to a market that closes ~2h from now (an *open*, tradable market, as
 * the morning job would create). Override with `TRADING_DAY` (unix seconds) — e.g. the
 * lifecycle demo uses a past value so settlement is callable immediately.
 */

import { PublicKey } from "@solana/web3.js";
import { tickerToSymbol } from "@meridian/sdk";
import { loadOpsEnv } from "../env";
import { createConsoleLog } from "../log";
import { createMarkets } from "../createMarkets";
import { fetchLiveCloses } from "../liveCloses";
import { requireManifest } from "../manifest";

async function main(): Promise<void> {
  const env = loadOpsEnv();
  const log = createConsoleLog();
  log.section(`Create markets (${env.cluster})`);

  const manifest = requireManifest();
  if (!manifest.usdcMint) {
    throw new Error(
      "Deploy manifest has no USDC mint — run the bootstrap step first."
    );
  }

  const tradingDay =
    env.tradingDayOverride ?? Math.floor(Date.now() / 1000) + 2 * 3600;

  // Closes that drive the strike ladder. Default: the MOCK_CLOSE_* envars. In live mode,
  // fetch the real most-recent close per ticker from the web app's /api/history and let it
  // override the mock value — falling back to the mock per-ticker when a fetch fails — so
  // strikes are seeded around where each stock actually trades.
  let closes = env.mockCloses;
  if (env.liveCloses && env.webBaseUrl) {
    const symbols = env.tickers.map(tickerToSymbol);
    const live = await fetchLiveCloses(env.webBaseUrl, symbols, log);
    closes = { ...env.mockCloses, ...live }; // live wins; mock fills any gaps
  } else if (env.liveCloses && !env.webBaseUrl) {
    log.warn(
      "LIVE_CLOSES set but WEB_BASE_URL is not — using MOCK_CLOSE_* values instead."
    );
  }

  const created = await createMarkets({
    rpcUrl: env.rpcUrl,
    deployer: env.deployer,
    usdcMint: new PublicKey(manifest.usdcMint),
    tickers: env.tickers,
    mockCloses: closes,
    includeClose: env.includeClose,
    tradingDay,
    log,
  });

  const newly = created.filter((m) => m.created).length;
  log.ok(
    `Create markets complete — ${created.length} market(s) (${newly} new, ${
      created.length - newly
    } existing)`
  );
  if (created.length === 0) {
    log.warn(
      "No markets created. Set MOCK_CLOSE_<SYMBOL> for at least one ticker (e.g. MOCK_CLOSE_META=680)."
    );
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(
    `create-markets failed: ${err instanceof Error ? err.message : err}`
  );
  process.exit(1);
});
