/**
 * Local dev-stack seeding + web env wiring for `make dev`.
 *
 * After deploy + bootstrap + create-markets have run against a local validator, this seeds a
 * browser-usable demo wallet and writes the frontend's `.env.local` so a reviewer can open the
 * app and immediately trade/redeem against the running stack. It is the headless equivalent of
 * the web e2e `localnet.mjs` setup, reusing the SDK + `Fixture` rather than re-implementing it,
 * and is intended for a **local validator only** (it funds via airdrop/transfer and mints mock
 * USDC — never run against devnet/mainnet).
 *
 * What it produces:
 *   - a demo wallet (SOL + USDC) with single-side inventory in two open markets (so all four
 *     trade buttons are economically valid without tripping the position-constraint guard),
 *   - one already-settled market with a redeemable winning position (for the redeem flow),
 *   - `packages/web/.env.local` (NEXT_PUBLIC_RPC_URL / _USDC_MINT / _CLUSTER), and
 *   - `.localnet/dev.json` (addresses + the demo wallet secret) for inspection.
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import BN from "bn.js";
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  sendAndConfirmTransaction,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import {
  getOrCreateAssociatedTokenAccount,
  getAssociatedTokenAddressSync,
  createTransferInstruction,
  mintTo,
} from "@solana/spl-token";
import {
  Ticker,
  PAYOFF_UNIT,
  mintPair,
  yesMintPda,
  noMintPda,
  marketPda,
  fetchMarket,
  type MarketId,
} from "@meridian/sdk";
import { Fixture, sendTx, type TestUser } from "@meridian/e2e";
import type { ConsoleLog } from "./log";

const ONE = new BN(PAYOFF_UNIT);

export interface SeedDevStackOptions {
  rpcUrl: string;
  deployer: Keypair;
  usdcMint: PublicKey;
  programId: PublicKey;
  log?: ConsoleLog;
}

export interface DevStackInfo {
  rpcUrl: string;
  cluster: string;
  programId: string;
  usdcMint: string;
  walletPubkey: string;
  /** The demo wallet secret (LOCAL ONLY — written to a gitignored file for convenience). */
  walletSecret: number[];
  markets: { symbol: string; address: string; state: string }[];
}

/** Repo root from this file: packages/ops/src -> ... -> repo root. */
function repoRoot(): string {
  return resolve(__dirname, "..", "..", "..");
}

/**
 * Seed the demo wallet + markets and write the frontend env. Assumes deploy + bootstrap +
 * create-markets already ran (the open markets exist). Returns the dev-stack info written.
 */
export async function seedDevStack(
  opts: SeedDevStackOptions
): Promise<DevStackInfo> {
  const log = opts.log;
  const connection = new Connection(opts.rpcUrl, "confirmed");
  const fx = Fixture.attach(connection, opts.deployer, opts.usdcMint);
  const now = Math.floor(Date.now() / 1000);

  // Two open markets (close ~2h out) for the Yes-side and No-side trade paths, plus one
  // already-closed market (past the admin-override delay) for the redeem flow. Concrete
  // BN/number fields (not the widened MarketId) so arithmetic/PDA derivation stays typed.
  const yesMarket = {
    ticker: Ticker.Meta,
    strike: new BN(680_000_000),
    tradingDay: now + 2 * 3600,
  };
  const noMarket = {
    ticker: Ticker.Aapl,
    strike: new BN(190_000_000),
    tradingDay: now + 2 * 3600,
  };
  const settledMarket = {
    ticker: Ticker.Nvda,
    strike: new BN(120_000_000),
    tradingDay: now - 2 * 3600,
  };

  log?.section("Dev stack: provision demo markets");
  for (const m of [yesMarket, noMarket, settledMarket]) {
    // Skip if it already exists. `make dev` reuses a running validator, so a second `make dev`
    // (without `make stop`) hits the same fixed demo-market identities; creating again would
    // fail. Re-seeding a fresh demo wallet into existing markets below is harmless.
    const marketAddr = marketPda(m.ticker, m.strike, m.tradingDay);
    const exists = (await fetchMarket(fx.program, marketAddr)) !== null;
    if (exists) {
      log?.detail(`market ${Ticker[m.ticker]}`, "exists — reusing");
      continue;
    }
    await fx.createMarket({
      ticker: m.ticker,
      strike: m.strike,
      tradingDay: m.tradingDay,
    });
  }

  // The browser demo wallet: SOL (airdrop, local-only) + 100 USDC.
  log?.section("Dev stack: seed demo wallet");
  const wallet = Keypair.generate();
  const airdropSig = await connection.requestAirdrop(
    wallet.publicKey,
    10 * LAMPORTS_PER_SOL
  );
  // Confirm with the blockhash form (the bare-signature form is deprecated and can return
  // without catching a dropped tx on a busy validator).
  const bh = await connection.getLatestBlockhash("confirmed");
  await connection.confirmTransaction(
    {
      signature: airdropSig,
      blockhash: bh.blockhash,
      lastValidBlockHeight: bh.lastValidBlockHeight,
    },
    "confirmed"
  );
  const walletUsdc = await getOrCreateAssociatedTokenAccount(
    connection,
    opts.deployer,
    opts.usdcMint,
    wallet.publicKey
  );
  await mintTo(
    connection,
    opts.deployer,
    opts.usdcMint,
    walletUsdc.address,
    opts.deployer,
    100n * BigInt(PAYOFF_UNIT.toString())
  );
  const user: TestUser = {
    keypair: wallet,
    publicKey: wallet.publicKey,
    usdc: walletUsdc.address,
  };

  // Single-side inventory: mint 2 pairs in each open market, move the unwanted side to the
  // deployer so the wallet holds only Yes (yesMarket) / only No (noMarket). Keeps the four
  // trade buttons valid without tripping the position-constraint guard.
  await fundSingleSide(
    connection,
    fx,
    opts.deployer,
    user,
    yesMarket,
    "yes",
    2
  );
  await fundSingleSide(connection, fx, opts.deployer, user, noMarket, "no", 2);
  log?.step("Demo wallet given single-side inventory in the two open markets");

  // Redeemable position: wallet mints a pair in the settled market, admin settles it Yes-wins.
  await sendTx(
    connection,
    wallet,
    [
      await mintPair(fx.program, {
        user: wallet.publicKey,
        usdcMint: opts.usdcMint,
        market: settledMarket,
      }),
    ],
    [wallet]
  );
  await fx.settleAdmin(settledMarket, settledMarket.strike.add(new BN(1)));
  log?.step(
    "Settled market seeded with a redeemable winning position (Yes wins)"
  );

  const info: DevStackInfo = {
    rpcUrl: opts.rpcUrl,
    cluster: "localnet",
    programId: opts.programId.toBase58(),
    usdcMint: opts.usdcMint.toBase58(),
    walletPubkey: wallet.publicKey.toBase58(),
    walletSecret: Array.from(wallet.secretKey),
    markets: [
      { symbol: "META", address: addr(yesMarket), state: "open" },
      { symbol: "AAPL", address: addr(noMarket), state: "open" },
      { symbol: "NVDA", address: addr(settledMarket), state: "settled" },
    ],
  };

  writeWebEnv(info, log);
  writeDevJson(info, log);
  return info;
}

/** Write `packages/web/.env.local` so the frontend talks to the local stack. */
function writeWebEnv(info: DevStackInfo, log?: ConsoleLog): void {
  const path = resolve(repoRoot(), "packages", "web", ".env.local");
  const body =
    `# Generated by \`make dev\` — points the frontend at the local validator.\n` +
    `# Safe to delete; regenerated on the next \`make dev\`. Not committed (gitignored).\n` +
    `NEXT_PUBLIC_RPC_URL=${info.rpcUrl}\n` +
    `NEXT_PUBLIC_USDC_MINT=${info.usdcMint}\n` +
    `NEXT_PUBLIC_CLUSTER=${info.cluster}\n`;
  writeFileSync(path, body);
  log?.detail("web env", path);
}

/**
 * Write `.localnet/dev.json` (addresses + the demo wallet secret) for inspection. This file
 * contains an ed25519 secret key, so it is written **owner-only**: the dir is 0700 and the
 * file 0600, so other local users on a shared machine can't read it and drain the funded demo
 * wallet. (It is also gitignored; this is the on-disk hardening.)
 */
function writeDevJson(info: DevStackInfo, log?: ConsoleLog): void {
  const dir = resolve(repoRoot(), ".localnet");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const path = resolve(dir, "dev.json");
  writeFileSync(path, JSON.stringify(info, null, 2) + "\n", { mode: 0o600 });
  log?.detail("dev info", path);
}

function addr(m: MarketId): string {
  return marketPda(m.ticker, m.strike, m.tradingDay).toBase58();
}

/**
 * Give the demo wallet single-side inventory: mint `pairs` pairs (wallet signs, gets Yes+No),
 * then transfer the side it should NOT keep to the deployer. Mirrors the web localnet seeding.
 */
async function fundSingleSide(
  connection: Connection,
  fx: Fixture,
  deployer: Keypair,
  user: TestUser,
  market: MarketId,
  keep: "yes" | "no",
  pairs: number
): Promise<void> {
  await fx.mintPairs(user, market, pairs);

  const marketAddr = marketPda(market.ticker, market.strike, market.tradingDay);
  const dropMint =
    keep === "yes" ? noMintPda(marketAddr) : yesMintPda(marketAddr);
  const walletDrop = getAssociatedTokenAddressSync(dropMint, user.publicKey);
  const deployerDrop = await getOrCreateAssociatedTokenAccount(
    connection,
    deployer,
    dropMint,
    deployer.publicKey
  );
  const amount = BigInt(PAYOFF_UNIT.toString()) * BigInt(pairs);
  await sendAndConfirmTransaction(
    connection,
    new Transaction().add(
      createTransferInstruction(
        walletDrop,
        deployerDrop.address,
        user.publicKey,
        amount
      )
    ),
    [user.keypair],
    { commitment: "confirmed" }
  );
}
