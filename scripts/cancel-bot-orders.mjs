#!/usr/bin/env node
// Cancel every trading bot's resting (unfilled) limit orders and reclaim their escrow.
//
// A limit order locks collateral OUT of the wallet into a per-market escrow account
// (place_order: a bid escrows USDC, an ask escrows Yes tokens). Orders that never filled keep
// that collateral locked until the owner cancels them — so after an experiment ends, a bot can
// show $0 tokens (already redeemed) yet still have money "in orders". This script cancels each
// bot's own resting orders, which refunds the escrow back to its wallet. Each bot signs its own
// cancel with its own keypair (cancel is owner-only).
//
// This is the order-book counterpart to scripts/claim-bot-winnings.mjs (which redeems settled
// *tokens*). Run claim to clear POSITIONS, then this to clear IN ORDERS — together they return
// a bot to all-cash. Cancel is allowed even when the market is paused or settled, so this is
// safe to run at any point after trading.
//
// Executes by default. Use --dry-run to preview what WOULD be cancelled without sending.
//
// Usage:
//   node scripts/cancel-bot-orders.mjs              # local validator (default), cancels
//   node scripts/cancel-bot-orders.mjs --dry-run    # preview only, sends nothing
//   RPC_URL=... node scripts/cancel-bot-orders.mjs  # other cluster
//
// One cancel transaction is sent per resting order (per bot, per market, per order). A single
// failed cancel logs a warning and the run continues to the next order.

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Connection, Keypair, Transaction } from "@solana/web3.js";
import {
  getProgram,
  fetchConfig,
  fetchMarket,
  fetchAllOrderBooks,
  cancelOrder,
  OrderSide,
  PRICE_SCALE,
  tickerToSymbol,
  USDC_DECIMALS,
} from "@meridian/sdk";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, "..");

const RPC_URL = process.env.RPC_URL ?? "http://127.0.0.1:8899";
const DRY_RUN = process.argv.includes("--dry-run");

const USDC_UNIT = 10 ** USDC_DECIMALS; // base units per 1 USDC (6dp -> 1e6)
const toUsdc = (baseUnitsBigInt) => Number(baseUnitsBigInt) / USDC_UNIT;
const PRICE_SCALE_BI = BigInt(PRICE_SCALE.toString());
// A bid escrows ceil(price * size / PRICE_SCALE) USDC; reported as the reclaimable amount.
const bidEscrowUsdc = (price, size) =>
  (price * size + (PRICE_SCALE_BI - 1n)) / PRICE_SCALE_BI;

function expandHome(p) {
  return p.startsWith("~") ? join(homedir(), p.slice(1)) : p;
}

function loadKeypair(path) {
  const secret = JSON.parse(readFileSync(expandHome(path), "utf8"));
  return Keypair.fromSecretKey(Uint8Array.from(secret));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Send a signed transaction and confirm it by HTTP polling (getSignatureStatuses), NOT the
 * WebSocket signatureSubscribe that web3.js's sendAndConfirmTransaction uses — Alchemy's
 * standard Solana endpoints don't expose signatureSubscribe and flood the logs with
 * "-32601 Method not found". Mirrors packages/traders/src/chain.ts. Returns the signature.
 */
async function sendAndConfirmByPolling(connection, tx, signers) {
  const { blockhash, lastValidBlockHeight } =
    await connection.getLatestBlockhash("confirmed");
  tx.recentBlockhash = blockhash;
  tx.lastValidBlockHeight = lastValidBlockHeight;
  tx.feePayer = signers[0].publicKey;
  tx.sign(...signers);

  const signature = await connection.sendRawTransaction(tx.serialize(), {
    preflightCommitment: "confirmed",
  });

  for (;;) {
    const { value } = await connection.getSignatureStatuses([signature]);
    const status = value[0];
    if (status?.err) {
      throw new Error(
        `transaction ${signature} failed: ${JSON.stringify(status.err)}`
      );
    }
    if (
      status?.confirmationStatus === "confirmed" ||
      status?.confirmationStatus === "finalized"
    ) {
      return signature;
    }
    const height = await connection.getBlockHeight("confirmed");
    if (height > lastValidBlockHeight) {
      throw new Error(`transaction ${signature} expired`);
    }
    await sleep(1000);
  }
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
  // base58 owner -> bot, so we can match a resting order's owner to one of our bots.
  const botByOwner = new Map(
    bots.map((b) => [b.keypair.publicKey.toBase58(), b])
  );

  const connection = new Connection(RPC_URL, "confirmed");

  // A program bound to a throwaway pubkey: we only use it to build instructions and read
  // accounts. Each cancel is signed with the owning bot's keypair, not this provider.
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

  // One batched read of every order book, joined to its market (for the ticker label and the
  // market PDA the cancel needs). Market.orderBook is the join key.
  const booksByAddr = await fetchAllOrderBooks(program);
  const rawMarkets = await program.account.market.all();
  const marketByOrderBook = new Map();
  for (const r of rawMarkets) {
    const m = await fetchMarket(program, r.publicKey);
    if (m)
      marketByOrderBook.set(m.orderBook.toBase58(), {
        address: r.publicKey,
        account: m,
      });
  }

  // Collect every resting order owned by one of our bots, with the fields cancel needs.
  // side = which array it's in (bids -> Bid, asks -> Ask); escrow value is for reporting only.
  const orders = []; // { bot, market, ticker, side, seq, reclaimBase }
  for (const [obAddr, book] of booksByAddr) {
    const mk = marketByOrderBook.get(obAddr);
    if (!mk) continue; // an order book with no matching market (shouldn't happen) — skip.
    const ticker = tickerToSymbol(mk.account.ticker);
    const consider = (o, side) => {
      const bot = botByOwner.get(o.owner.toBase58());
      if (!bot) return; // not one of our bots' orders.
      const price = BigInt(o.price.toString());
      const size = BigInt(o.size.toString());
      // Reclaimable: a bid refunds USDC; an ask refunds Yes tokens (valued 1:1 for display).
      const reclaimBase =
        side === OrderSide.Bid ? bidEscrowUsdc(price, size) : size;
      orders.push({
        bot,
        market: mk.address,
        ticker,
        side,
        seq: o.seq,
        reclaimBase,
      });
    };
    for (const o of book.bids) consider(o, OrderSide.Bid);
    for (const o of book.asks) consider(o, OrderSide.Ask);
  }

  console.log(
    `\nMeridian — cancel bot orders — ${RPC_URL}  ` +
      `(${orders.length} resting order(s) across ${bots.length} bot(s))` +
      (DRY_RUN ? "  [DRY RUN — nothing will be sent]" : "")
  );

  let cancelled = 0;
  let failures = 0;
  let reclaimedBase = 0n; // USDC-equivalent reclaimed (bids exact; asks valued 1:1 as tokens)

  // Group by bot for a readable per-bot summary.
  for (const bot of bots) {
    const owner = bot.keypair.publicKey;
    const mine = orders.filter((o) => o.bot === bot);
    if (mine.length === 0) continue;
    let botReclaimBase = 0n;

    for (const o of mine) {
      const sideLabel = o.side === OrderSide.Bid ? "BID" : "ASK";
      const line =
        `  ${bot.name.padEnd(16)} ${o.ticker.padEnd(6)} ${sideLabel} ` +
        `seq ${o.seq.toString().padStart(4)}  ~$${toUsdc(o.reclaimBase).toFixed(
          2
        )}`;

      if (DRY_RUN) {
        console.log(`${line}  (would cancel)`);
        botReclaimBase += o.reclaimBase;
        reclaimedBase += o.reclaimBase;
        cancelled += 1;
        continue;
      }

      try {
        const ix = await cancelOrder(program, {
          user: owner,
          market: o.market,
          side: o.side,
          seq: o.seq,
          usdcMint,
        });
        const tx = new Transaction().add(ix);
        const sig = await sendAndConfirmByPolling(connection, tx, [
          bot.keypair,
        ]);
        console.log(`${line}  ✓ ${sig.slice(0, 12)}…`);
        botReclaimBase += o.reclaimBase;
        reclaimedBase += o.reclaimBase;
        cancelled += 1;
      } catch (e) {
        console.log(`${line}  ✗ ${e.message ?? e}`);
        failures += 1;
      }
    }

    if (botReclaimBase > 0n) {
      console.log(
        `  ${bot.name.padEnd(16)} ${" ".repeat(10)} ~$${toUsdc(
          botReclaimBase
        ).toFixed(2)} ${DRY_RUN ? "reclaimable" : "reclaimed"}`
      );
    }
  }

  const verb = DRY_RUN ? "reclaimable" : "reclaimed";
  console.log(
    `\n${DRY_RUN ? "Would cancel" : "Cancelled"} ${cancelled} order(s) — ` +
      `~$${toUsdc(reclaimedBase).toFixed(2)} ${verb} ` +
      `(bids exact USDC; asks valued 1:1 as Yes tokens).` +
      (failures > 0 ? `  ⚠ ${failures} cancel(s) failed (see above).` : "")
  );
  console.log();
}

main().catch((e) => {
  console.error("✗ cancel-bot-orders failed:", e.message ?? e);
  process.exit(1);
});
