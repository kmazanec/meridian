#!/usr/bin/env node
/**
 * Fund N test trader accounts with SOL (fees) + mock USDC (to trade with) on a target
 * cluster. The mock USDC mint authority is the deployer/admin (see bootstrap.ts), so the
 * deployer keypair can mint test USDC to anyone.
 *
 * Usage (run from repo root):
 *   RPC_URL=http://127.0.0.1:8899 DEPLOYER_KEYPAIR=.localnet/deployer.json \
 *   USDC_MINT=<localnet usdc> node scripts/fund-test-traders.mjs
 *
 *   RPC_URL=https://api.devnet.solana.com DEPLOYER_KEYPAIR=~/.config/solana/devnet.json \
 *   USDC_MINT=<devnet usdc> node scripts/fund-test-traders.mjs
 *
 * Env:
 *   RPC_URL           target cluster RPC (required)
 *   DEPLOYER_KEYPAIR  path to the cluster's deployer/admin keypair (the USDC mint authority)
 *   USDC_MINT         the cluster's mock USDC mint. Optional — falls back to the
 *                     deploy-manifest.json `usdcMint` for the matching cluster.
 *   TRADERS           comma list of keypair paths to fund/create
 *                     (default: ~/.config/solana/trader1.json,~/.config/solana/trader2.json)
 *   SOL_EACH          SOL to give each (default 1 on devnet, 10 on localnet)
 *   USDC_EACH         mock USDC (whole dollars) to mint each (default 1000)
 */
import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { execFileSync } from "node:child_process";
import {
  Connection,
  Keypair,
  PublicKey,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import { getOrCreateAssociatedTokenAccount, mintTo } from "@solana/spl-token";

const expand = (p) => (p.startsWith("~") ? p.replace("~", homedir()) : p);
const req = (k) => {
  const v = process.env[k];
  if (!v) throw new Error(`${k} is required`);
  return v;
};
const loadKp = (p) =>
  Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(readFileSync(expand(p), "utf8")))
  );

const rpc = req("RPC_URL");
const isLocal = rpc.includes("127.0.0.1") || rpc.includes("localhost");
const conn = new Connection(rpc, "confirmed");
const deployer = loadKp(req("DEPLOYER_KEYPAIR"));

/** USDC mint: explicit env, else the deploy manifest's mint (must match the target cluster). */
function resolveUsdcMint() {
  if (process.env.USDC_MINT) return new PublicKey(process.env.USDC_MINT);
  const path = process.env.OPS_MANIFEST ?? "deploy-manifest.json";
  if (!existsSync(path)) {
    throw new Error("USDC_MINT not set and no deploy-manifest.json found.");
  }
  const m = JSON.parse(readFileSync(path, "utf8"));
  const manifestIsLocal =
    m.rpcUrl?.includes("127.0.0.1") || m.rpcUrl?.includes("localhost");
  if (manifestIsLocal !== isLocal) {
    throw new Error(
      `deploy-manifest.json is for ${m.cluster} (${m.rpcUrl}) but RPC_URL targets a ` +
        `${isLocal ? "local" : "non-local"} cluster. Pass USDC_MINT explicitly.`
    );
  }
  return new PublicKey(m.usdcMint);
}
const usdcMint = resolveUsdcMint();
const solEach = Number(process.env.SOL_EACH ?? (isLocal ? 10 : 1));
const usdcEach = Number(process.env.USDC_EACH ?? 1000);
const traderPaths = (
  process.env.TRADERS ??
  "~/.config/solana/trader1.json,~/.config/solana/trader2.json"
)
  .split(",")
  .map((s) => s.trim());

console.log(
  `Funding ${traderPaths.length} test trader(s) on ${
    isLocal ? "localnet" : rpc
  }`
);
console.log(`  deployer/mint-authority: ${deployer.publicKey.toBase58()}`);
console.log(`  USDC mint: ${usdcMint.toBase58()}`);

for (const path of traderPaths) {
  // Create the keypair file if it doesn't exist yet (so the same paths work next time).
  if (!existsSync(expand(path))) {
    const kp = Keypair.generate();
    writeFileSync(expand(path), JSON.stringify(Array.from(kp.secretKey)));
    console.log(`\n• generated ${path}`);
  }
  const trader = loadKp(path);
  console.log(`\n• ${trader.publicKey.toBase58()}  (${path})`);

  // SOL: airdrop on localnet (unlimited); on devnet try the faucet, fall back to a transfer
  // from the deployer if the faucet is rate-limited.
  if (isLocal) {
    const sig = await conn.requestAirdrop(
      trader.publicKey,
      solEach * LAMPORTS_PER_SOL
    );
    await conn.confirmTransaction(sig, "confirmed");
    console.log(`  + ${solEach} SOL (airdrop)`);
  } else {
    try {
      execFileSync(
        "solana",
        ["airdrop", String(solEach), trader.publicKey.toBase58(), "--url", rpc],
        { stdio: "ignore" }
      );
      console.log(`  + ${solEach} SOL (devnet faucet)`);
    } catch {
      console.log(
        `  ! faucet failed (rate limit) — fund ${solEach} SOL manually if needed`
      );
    }
  }

  // Mock USDC: the deployer is the mint authority, so mint directly to the trader's ATA.
  const ata = await getOrCreateAssociatedTokenAccount(
    conn,
    deployer,
    usdcMint,
    trader.publicKey
  );
  await mintTo(
    conn,
    deployer,
    usdcMint,
    ata.address,
    deployer,
    BigInt(usdcEach) * 1_000_000n // 6dp
  );
  console.log(`  + ${usdcEach} mock USDC`);
}

console.log(
  "\n✓ done. Import these keypairs into your wallet to trade as them."
);
