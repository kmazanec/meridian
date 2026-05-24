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
 *   SOL_FALLBACK      SOL to TRANSFER from the deployer to each trader when the devnet faucet
 *                     is rate-limited (default 0.1). Just enough for tx fees over a demo run;
 *                     kept small because it comes out of YOUR admin balance, not the faucet.
 *                     Skipped per-trader if they already hold at least this much.
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
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
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

/**
 * Top up `recipient` to at least `lamports` by transferring the shortfall from the deployer.
 * Idempotent: a trader who already holds enough is left untouched (so re-runs don't drain the
 * admin). Throws if the deployer can't cover the transfer (plus a small fee buffer).
 */
async function transferShortfall(recipient, lamports) {
  const have = await conn.getBalance(recipient, "confirmed");
  if (have >= lamports) return 0;
  const need = lamports - have;
  const deployerBal = await conn.getBalance(deployer.publicKey, "confirmed");
  if (deployerBal < need + 5000 /* fee buffer */) {
    throw new Error(
      `deployer balance ${(deployerBal / LAMPORTS_PER_SOL).toFixed(4)} SOL ` +
        `can't cover a ${(need / LAMPORTS_PER_SOL).toFixed(4)} SOL transfer.`
    );
  }
  const tx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: deployer.publicKey,
      toPubkey: recipient,
      lamports: need,
    })
  );
  await sendAndConfirmTransaction(conn, tx, [deployer], {
    commitment: "confirmed",
  });
  return need;
}
const solEach = Number(process.env.SOL_EACH ?? (isLocal ? 10 : 1));
const solFallback = Number(process.env.SOL_FALLBACK ?? 0.1);
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
      // Faucet rate-limited: top up from the deployer instead, just enough for fees.
      try {
        const sent = await transferShortfall(
          trader.publicKey,
          Math.round(solFallback * LAMPORTS_PER_SOL)
        );
        if (sent > 0) {
          console.log(
            `  + ${(sent / LAMPORTS_PER_SOL).toFixed(
              4
            )} SOL (deployer transfer — faucet rate-limited)`
          );
        } else {
          console.log(
            `  = already has ≥ ${solFallback} SOL (faucet rate-limited; no transfer needed)`
          );
        }
      } catch (err) {
        console.log(
          `  ! faucet rate-limited AND deployer transfer failed: ${err.message}`
        );
      }
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
