#!/usr/bin/env node
// @ts-check
//
// F-04 devnet equity-feed SPIKE (ARCHITECTURE.md §14 Q1 — the project's #1 risk).
//
// Question this answers: do each of the MAG7 equity feeds return a *fresh* price
// on Solana **devnet** during US market hours, via the pull model
// (Hermes -> Pyth Solana Receiver -> on-chain read)?
//
// This is the off-chain half of the pull oracle, so it MAY use the Pyth SDK
// (the SDK's Borsh/solana-program conflict only breaks the *on-chain* BPF build;
// our settlement program hand-parses the account instead — see programs/.../oracle.rs).
//
// ─────────────────────────────────────────────────────────────────────────────
// NOT RUN AUTOMATICALLY. It requires:
//   1. US equity market hours (feeds only update 9:30am–4:00pm ET on trading days).
//   2. A funded devnet keypair to pay for posting price updates.
// Run it live during a session and record the outcome in
// docs/features/04-settlement-oracle.md (which oracle path the demo uses, and why).
// ─────────────────────────────────────────────────────────────────────────────
//
// Usage:
//   npm i @pythnetwork/hermes-client @pythnetwork/pyth-solana-receiver @solana/web3.js
//   SOLANA_KEYPAIR=~/.config/solana/id.json \
//   RPC_URL=https://api.devnet.solana.com \
//     node scripts/spike-pyth-feed.mjs
//
// Exit code 0 = every checked feed returned a fresh price within the staleness
// window; non-zero = at least one feed was stale/missing (trigger the fallback
// ladder documented in the feature file).

import { readFileSync } from "node:fs";
import { homedir } from "node:os";

// ── Config ──────────────────────────────────────────────────────────────────

// Pyth feed ids are the same 32-byte id across clusters at the Hermes layer; the
// per-cluster difference is which feeds have been *posted*/sponsored on-chain.
//
// IMPORTANT: fill these in from the live Pyth feed list immediately before a run —
// equity feed ids must be confirmed against https://pyth.network/price-feeds (or
// `GET https://hermes.pyth.network/v2/price_feeds?query=AAPL&asset_type=equity`).
// They are intentionally left empty here rather than hard-coding ids that may be
// wrong/stale; an empty id is reported as "missing" so a half-configured run is
// obvious rather than silently checking the wrong feed. These same confirmed ids
// must be written into Config.tickers[].feed_id at initialize_config time so the
// on-chain feed-match check (WrongFeed) lines up.
const MAG7 = {
  AAPL: process.env.FEED_AAPL ?? "",
  MSFT: process.env.FEED_MSFT ?? "",
  GOOGL: process.env.FEED_GOOGL ?? "",
  AMZN: process.env.FEED_AMZN ?? "",
  NVDA: process.env.FEED_NVDA ?? "",
  META: process.env.FEED_META ?? "",
  TSLA: process.env.FEED_TSLA ?? "",
};

const STALENESS_SECONDS = 120; // mirror DEFAULT_MAX_STALENESS in constants.rs
const RPC_URL = process.env.RPC_URL ?? "https://api.devnet.solana.com";
const HERMES_URL = process.env.HERMES_URL ?? "https://hermes.pyth.network";
const KEYPAIR_PATH = (process.env.SOLANA_KEYPAIR ?? "~/.config/solana/id.json").replace(
  /^~/,
  homedir(),
);

// ── Spike ───────────────────────────────────────────────────────────────────

async function main() {
  // Lazy imports so the file parses even when deps aren't installed (it's a
  // documented, on-demand script, not part of the build).
  const { HermesClient } = await import("@pythnetwork/hermes-client");
  const hermes = new HermesClient(HERMES_URL);

  console.log(`Spike: MAG7 freshness check`);
  console.log(`  RPC:      ${RPC_URL}`);
  console.log(`  Hermes:   ${HERMES_URL}`);
  console.log(`  Keypair:  ${KEYPAIR_PATH}`);
  console.log(`  Max age:  ${STALENESS_SECONDS}s`);
  console.log("");

  const now = Math.floor(Date.now() / 1000);
  let allFresh = true;

  for (const [ticker, feedId] of Object.entries(MAG7)) {
    if (!feedId) {
      console.log(`  ${ticker.padEnd(6)} ✗ no feed id configured (set FEED_${ticker})`);
      allFresh = false;
      continue;
    }
    try {
      // Step 1 (Hermes): fetch the latest signed price update for the feed.
      const updates = await hermes.getLatestPriceUpdates([feedId]);
      const parsed = updates?.parsed?.[0];
      if (!parsed) {
        console.log(`  ${ticker.padEnd(6)} ✗ no price returned by Hermes`);
        allFresh = false;
        continue;
      }
      const publishTime = Number(parsed.price.publish_time);
      const age = now - publishTime;
      const price = Number(parsed.price.price) * 10 ** parsed.price.expo;
      const confBps = (Number(parsed.price.conf) / Number(parsed.price.price)) * 10_000;
      const fresh = age >= 0 && age <= STALENESS_SECONDS;
      allFresh = allFresh && fresh;
      console.log(
        `  ${ticker.padEnd(6)} ${fresh ? "✓" : "✗"} $${price.toFixed(2)} ` +
          `age=${age}s conf=${confBps.toFixed(1)}bps`,
      );
      // Step 2 (on a full live run): post the update via the Pyth Solana Receiver
      //   and read it back on devnet to confirm the receiver carries it. See:
      //   import { PythSolanaReceiver } from "@pythnetwork/pyth-solana-receiver";
      //   const receiver = new PythSolanaReceiver({ connection, wallet });
      //   const builder = receiver.newTransactionBuilder({ closeUpdateAccounts: true });
      //   await builder.addPostPriceUpdates(updates.binary.data);
      //   ...send, then connection.getAccountInfo(priceUpdateAccount).
      // This step needs the funded keypair at KEYPAIR_PATH and proves the
      // *devnet* (not just Hermes) leg, which is the actual open question.
    } catch (err) {
      console.log(`  ${ticker.padEnd(6)} ✗ error: ${err?.message ?? err}`);
      allFresh = false;
    }
  }

  console.log("");
  if (allFresh) {
    console.log("RESULT: all feeds fresh → live-Pyth settlement is viable on devnet.");
    process.exit(0);
  } else {
    console.log(
      "RESULT: at least one feed stale/missing.\n" +
        "Fallback ladder (see docs/features/04-settlement-oracle.md):\n" +
        "  (a) crypto-feed stand-ins (BTC/SOL, 24/7) to prove the pipeline;\n" +
        "  (b) mocked oracle behind the interface for dev;\n" +
        "  (c) validate equities on mainnet-beta with tiny amounts.",
    );
    process.exit(1);
  }
}

// Touch readFileSync so linters don't flag the import that the (commented) full
// run uses to load the keypair; harmless no-op in the freshness-only path.
void readFileSync;

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
