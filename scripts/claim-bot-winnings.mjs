#!/usr/bin/env node
// Claim (redeem) every trading bot's won balances on settled markets.
//
// For each bot in packages/traders/bots.config.json, this scans every SETTLED market and,
// wherever the bot still holds tokens of the WINNING side (payoutFor > 0), burns those tokens
// back into USDC via the program's `redeem` instruction. Each bot signs its own redeem with its
// own keypair. Losing tokens and tokens on unsettled markets are worth 0 and are skipped.
//
// This is the action counterpart to scripts/bot-results.mjs, which only *reports* a bot's
// unredeemed winnings. Run this and a bot's `unredeemedWinnings` in that report drops to ~0.
//
// Executes by default. Use --dry-run to preview what WOULD be redeemed without sending anything.
//
// Usage:
//   node scripts/claim-bot-winnings.mjs              # local validator (default), redeems
//   node scripts/claim-bot-winnings.mjs --dry-run    # preview only, sends nothing
//   RPC_URL=... node scripts/claim-bot-winnings.mjs  # other cluster
//
// One redeem transaction is sent per claimable position (per bot, per market, per side). A
// single failed redeem logs a warning and the run continues to the next position.

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  Connection,
  Keypair,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  getProgram,
  fetchConfig,
  fetchMarket,
  fetchBalance,
  payoutFor,
  redeem,
  createAtaIfNeeded,
  ata,
  tickerToSymbol,
  RedeemSide,
  USDC_DECIMALS,
} from "@meridian/sdk";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, "..");

const RPC_URL = process.env.RPC_URL ?? "http://127.0.0.1:8899";
const DRY_RUN = process.argv.includes("--dry-run");

const USDC_UNIT = 10 ** USDC_DECIMALS; // base units per 1 USDC (6dp -> 1e6)
const toUsdc = (baseUnitsBigInt) => Number(baseUnitsBigInt) / USDC_UNIT;

function expandHome(p) {
  return p.startsWith("~") ? join(homedir(), p.slice(1)) : p;
}

function loadKeypair(path) {
  const secret = JSON.parse(readFileSync(expandHome(path), "utf8"));
  return Keypair.fromSecretKey(Uint8Array.from(secret));
}

async function main() {
  const config = JSON.parse(
    readFileSync(join(REPO, "packages/traders/bots.config.json"), "utf8")
  );
  const bots = config.bots.map((b) => ({
    name: b.name,
    model: b.model,
    keypair: loadKeypair(b.wallet),
  }));

  const connection = new Connection(RPC_URL, "confirmed");

  // A program bound to a throwaway pubkey: we only use it to build instructions and read
  // accounts. Each redeem is signed with the owning bot's keypair, not this provider.
  const program = getProgram({
    connection,
    publicKey: Keypair.generate().publicKey,
  });

  const onchain = await fetchConfig(program);
  if (!onchain) {
    throw new Error(
      `No Meridian Config found at ${RPC_URL} (program ${program.programId.toBase58()}). ` +
        `Is the stack deployed/bootstrapped?`
    );
  }
  const usdcMint = onchain.usdcMint;

  // Enumerate all markets once, normalize each via fetchMarket (which drops publicKey, so we
  // carry the on-chain address from market.all()), keep the settled ones.
  const rawMarkets = await program.account.market.all();
  const markets = [];
  for (const r of rawMarkets) {
    const m = await fetchMarket(program, r.publicKey);
    if (m) markets.push({ address: r.publicKey, account: m });
  }
  const settled = markets.filter((m) => m.account.state === "settled");

  console.log(
    `\nMeridian — claim bot winnings — ${RPC_URL}  ` +
      `(${settled.length} settled market(s), ${bots.length} bot(s))` +
      (DRY_RUN ? "  [DRY RUN — nothing will be sent]" : "")
  );

  let totalClaimedBase = 0n;
  let redeemed = 0;
  let failures = 0;

  for (const bot of bots) {
    const owner = bot.keypair.publicKey;
    let botClaimedBase = 0n;

    for (const { address, account: m } of settled) {
      for (const side of [RedeemSide.Yes, RedeemSide.No]) {
        const mint = side === RedeemSide.Yes ? m.yesMint : m.noMint;
        const bal = await fetchBalance(connection, ata(mint, owner));
        if (bal <= 0n) continue;

        const payBase = BigInt(
          payoutFor(m, side === RedeemSide.Yes ? "yes" : "no", bal).toString()
        );
        if (payBase <= 0n) continue; // losing side: tokens worth nothing, leave them be.

        const ticker = tickerToSymbol(m.ticker);
        const sideLabel = side === RedeemSide.Yes ? "YES" : "NO";
        const line =
          `  ${bot.name.padEnd(16)} ${ticker.padEnd(6)} ${sideLabel.padEnd(
            3
          )} ` + `$${toUsdc(payBase).toFixed(2)}`;

        if (DRY_RUN) {
          console.log(`${line}  (would redeem)`);
          botClaimedBase += payBase;
          totalClaimedBase += payBase;
          redeemed += 1;
          continue;
        }

        try {
          const tx = new Transaction();
          // redeem pays out into the bot's USDC ATA, which must already exist. It does (the bot
          // traded with USDC), but prepend an idempotent create so a fresh wallet can't fail.
          tx.add(createAtaIfNeeded(owner, owner, usdcMint));
          tx.add(
            await redeem(program, {
              user: owner,
              market: address,
              side,
              amount: bal,
              usdcMint,
            })
          );
          const sig = await sendAndConfirmTransaction(connection, tx, [
            bot.keypair,
          ]);
          console.log(`${line}  ✓ ${sig.slice(0, 12)}…`);
          botClaimedBase += payBase;
          totalClaimedBase += payBase;
          redeemed += 1;
        } catch (e) {
          console.log(`${line}  ✗ ${e.message ?? e}`);
          failures += 1;
        }
      }
    }

    if (botClaimedBase > 0n) {
      console.log(
        `  ${bot.name.padEnd(16)} ${" ".repeat(10)} = $${toUsdc(
          botClaimedBase
        ).toFixed(2)} ${DRY_RUN ? "claimable" : "claimed"}`
      );
    }
  }

  const verb = DRY_RUN ? "claimable" : "claimed";
  console.log(
    `\n${DRY_RUN ? "Would redeem" : "Redeemed"} ${redeemed} position(s) — ` +
      `total $${toUsdc(totalClaimedBase).toFixed(2)} ${verb}.` +
      (failures > 0 ? `  ⚠ ${failures} redeem(s) failed (see above).` : "")
  );
  console.log();
}

main().catch((e) => {
  console.error("✗ claim-bot-winnings failed:", e.message ?? e);
  process.exit(1);
});
