#!/usr/bin/env node
// Per-bot results report: how much money each trading bot won/lost after settlement.
//
// Reads each bot's wallet (from packages/traders/bots.config.json), and for every bot:
//   net = (current USDC balance) + (value of any UNREDEEMED winning outcome tokens)
//   pnl = net - START_USDC
// Winning tokens on a settled market are worth 1:1 in USDC base units (payoutFor); losing
// tokens and tokens on unsettled markets are worth 0. Since redeem converts winners to USDC,
// already-redeemed winnings are captured by the USDC balance; the token term only adds value
// for winners a bot never bothered to redeem.
//
// Usage:
//   node scripts/bot-results.mjs                 # local validator (default)
//   RPC_URL=... node scripts/bot-results.mjs     # other cluster
//   START_USDC=1000 node scripts/bot-results.mjs # override per-bot starting capital (whole USDC)
//   node scripts/bot-results.mjs --json          # machine-readable output

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import {
  getProgram,
  fetchConfig,
  fetchMarket,
  fetchAllOrderBooks,
  fetchBalance,
  payoutFor,
  ata,
  tickerToSymbol,
  OrderSide,
  PRICE_SCALE,
  USDC_DECIMALS,
} from "@meridian/sdk";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, "..");

const RPC_URL = process.env.RPC_URL ?? "http://127.0.0.1:8899";
const START_USDC = Number(process.env.START_USDC ?? 1000); // whole USDC each bot was funded with
const AS_JSON = process.argv.includes("--json"); // print JSON instead of the table
// --out <path>: also write the JSON artifact to <path> (still prints the table unless --json).
const outIdx = process.argv.indexOf("--out");
const OUT_PATH = outIdx >= 0 ? process.argv[outIdx + 1] : null;

const USDC_UNIT = 10 ** USDC_DECIMALS; // base units per 1 USDC (6dp -> 1e6)
const toUsdc = (baseUnitsBigInt) => Number(baseUnitsBigInt) / USDC_UNIT;
const startBase = BigInt(Math.round(START_USDC * USDC_UNIT));

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
  // Read-only provider: a throwaway pubkey is fine, we never sign.
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

  // Enumerate all markets once, normalize each (state/outcome) via fetchMarket, keeping its
  // on-chain address (fetchMarket drops publicKey, so we carry it from market.all()).
  const rawMarkets = await program.account.market.all();
  const markets = [];
  for (const r of rawMarkets) {
    const m = await fetchMarket(program, r.publicKey);
    if (m) markets.push({ address: r.publicKey, account: m });
  }
  const settled = markets.filter((m) => m.account.state === "settled");

  // Resting limit orders escrow collateral OUT of the wallet into per-market escrow accounts
  // (place_order: bids escrow USDC, asks escrow Yes tokens). That value isn't in a bot's ATAs,
  // so we must credit each order's owner for it or every bot with open orders looks poorer than
  // it is. Build owner -> escrowed-USDC-value across all books. (We value an ask's escrowed Yes
  // tokens by the market's settled payout; an unsettled ask is marked $0 and counted as a warning
  // so the total is never silently wrong.)
  const PRICE_SCALE_BI = BigInt(PRICE_SCALE.toString());
  const bidEscrowUsdc = (price, size) =>
    (price * size + (PRICE_SCALE_BI - 1n)) / PRICE_SCALE_BI; // ceil(price*size/PRICE_SCALE)

  const booksByAddr = await fetchAllOrderBooks(program);
  const marketByOrderBook = new Map(
    markets.map((m) => [m.account.orderBook.toBase58(), m])
  );
  const escrowByOwner = new Map(); // base58 -> { usdc: bigint, openOrders: number }
  let unsettledAskWarnings = 0;
  const creditEscrow = (owner, base) => {
    const k = owner.toBase58();
    const cur = escrowByOwner.get(k) ?? { usdc: 0n, openOrders: 0 };
    cur.usdc += base;
    cur.openOrders += 1;
    escrowByOwner.set(k, cur);
  };
  for (const [obAddr, book] of booksByAddr) {
    const mk = marketByOrderBook.get(obAddr);
    for (const o of book.bids) {
      const price = BigInt(o.price.toString());
      const size = BigInt(o.size.toString());
      creditEscrow(o.owner, bidEscrowUsdc(price, size));
    }
    for (const o of book.asks) {
      const size = BigInt(o.size.toString());
      // Escrowed Yes tokens: worth their settled payout. If the market isn't settled we can't
      // mark them, so count $0 and flag it.
      if (mk && mk.account.state === "settled") {
        creditEscrow(
          o.owner,
          BigInt(payoutFor(mk.account, "yes", o.size).toString())
        );
      } else {
        creditEscrow(o.owner, 0n);
        unsettledAskWarnings += 1;
      }
    }
  }

  const rows = [];
  for (const bot of bots) {
    const owner = bot.keypair.publicKey;

    const usdcBal = await fetchBalance(connection, ata(usdcMint, owner));

    // Value any winning tokens the bot still holds on settled markets (unredeemed winnings).
    let unredeemedBase = 0n;
    const unredeemedDetail = [];
    for (const { address, account: m } of settled) {
      const yesBal = await fetchBalance(connection, ata(m.yesMint, owner));
      const noBal = await fetchBalance(connection, ata(m.noMint, owner));
      const yesPay = BigInt(payoutFor(m, "yes", yesBal).toString());
      const noPay = BigInt(payoutFor(m, "no", noBal).toString());
      const pay = yesPay + noPay;
      if (pay > 0n) {
        unredeemedBase += pay;
        unredeemedDetail.push({
          market: address.toBase58(),
          ticker: tickerToSymbol(m.ticker),
          strike: toUsdc(BigInt(m.strike.toString())),
          payoutUsdc: toUsdc(pay),
        });
      }
    }

    const usdcBase = BigInt(usdcBal.toString());
    const esc = escrowByOwner.get(owner.toBase58()) ?? {
      usdc: 0n,
      openOrders: 0,
    };
    const escrowBase = esc.usdc;
    const netBase = usdcBase + unredeemedBase + escrowBase;
    const pnlBase = netBase - startBase;

    rows.push({
      name: bot.name,
      model: bot.model,
      pubkey: owner.toBase58(),
      usdc: toUsdc(usdcBase),
      unredeemedWinnings: toUsdc(unredeemedBase),
      escrow: toUsdc(escrowBase),
      openOrders: esc.openOrders,
      net: toUsdc(netBase),
      start: START_USDC,
      pnl: toUsdc(pnlBase),
      pnlPct: (toUsdc(pnlBase) / START_USDC) * 100,
      unredeemedDetail,
    });
  }

  rows.sort((a, b) => b.pnl - a.pnl);

  const report = {
    generatedAt: new Date().toISOString(),
    rpcUrl: RPC_URL,
    startUsdc: START_USDC,
    settledMarkets: settled.length,
    unsettledAskWarnings,
    bots: rows,
  };

  // Optional artifact: write the JSON report to --out, creating the directory.
  if (OUT_PATH) {
    mkdirSync(dirname(OUT_PATH), { recursive: true });
    writeFileSync(OUT_PATH, JSON.stringify(report, null, 2));
    if (!AS_JSON) console.log(`\n✓ Wrote report artifact: ${OUT_PATH}`);
  }

  if (AS_JSON) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  const money = (n) => (n >= 0 ? "+" : "-") + "$" + Math.abs(n).toFixed(2);
  console.log(
    `\nMeridian bot results — ${RPC_URL}  (start $${START_USDC.toFixed(
      0
    )}/bot, ${settled.length} settled markets)\n`
  );
  const head = ["#", "bot", "model", "net", "pnl", "pnl%", "in-orders"];
  const widths = [3, 16, 30, 11, 10, 8, 11];
  const fmt = (cells) =>
    cells.map((c, i) => String(c).padEnd(widths[i])).join("  ");
  console.log(fmt(head));
  console.log(fmt(widths.map((w) => "-".repeat(w))));
  rows.forEach((r, i) => {
    const locked = r.escrow + r.unredeemedWinnings;
    console.log(
      fmt([
        i + 1,
        r.name,
        r.model,
        "$" + r.net.toFixed(2),
        money(r.pnl),
        r.pnlPct.toFixed(1) + "%",
        locked > 0 ? "$" + locked.toFixed(2) : "—",
      ])
    );
  });

  const totalPnl = rows.reduce((s, r) => s + r.pnl, 0);
  console.log(
    `\nField total PnL: ${money(totalPnl)}` +
      `  (net = wallet USDC + unredeemed winnings + collateral in resting orders)`
  );
  if (unsettledAskWarnings > 0) {
    console.log(
      `⚠ ${unsettledAskWarnings} resting sell order(s) on UNSETTLED markets valued at $0 — ` +
        `settle all markets for an exact total.`
    );
  }
  console.log();
}

main().catch((e) => {
  console.error("✗ bot-results failed:", e.message ?? e);
  process.exit(1);
});
