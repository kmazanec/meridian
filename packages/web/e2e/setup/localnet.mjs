/**
 * Local-validator orchestration for the e2e suite.
 *
 * Boots `solana-test-validator`, deploys the compiled program **upgradeably** (so a
 * ProgramData account exists with our deployer as upgrade authority — `initialize_config`
 * requires it), initializes Config, creates a mock USDC mint, provisions two markets
 * (one open for the trade paths, one already past close for settle+redeem), funds a
 * generated test wallet (SOL + USDC), and writes the addresses + the test wallet secret
 * to `e2e/.localnet.json` for the app and the spec to load.
 *
 * Plain ESM (run via tsx/node) so it can drive the Solana CLI + RPC directly. The SDK is
 * imported for its instruction builders / PDA derivations (the same surface the app uses).
 */

import { spawn, execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  createMint,
  getOrCreateAssociatedTokenAccount,
  getAssociatedTokenAddressSync,
  createTransferInstruction,
  mintTo,
} from "@solana/spl-token";

// Runs as a standalone Node ESM script (spawned by global-setup via `node`, never
// imported by Playwright's loader) so Node resolves `@meridian/sdk` → its built
// dist/cjs cleanly, without the app's TS path alias (which points at the source).
const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..", "..", "..", "..");
// The built program binary. `target/` is gitignored, so allow an env override
// (`MERIDIAN_SO`) — useful in a worktree whose `target/` isn't populated, pointing at a
// `.so` built elsewhere for the *same* program source. CI builds it in-tree.
const SO_PATH =
  process.env.MERIDIAN_SO ?? resolve(repoRoot, "target", "deploy", "meridian.so");
const PROGRAM_KEYPAIR = resolve(
  repoRoot,
  "target",
  "deploy",
  "meridian-keypair.json"
);
const OUT_PATH = resolve(__dirname, "..", ".localnet.json");
const RPC = "http://127.0.0.1:8899";
const BPF_LOADER_UPGRADEABLE = new PublicKey(
  "BPFLoaderUpgradeab1e11111111111111111111111"
);

function waitFor(fn, timeoutMs, label) {
  return (async () => {
    const start = Date.now();
    // eslint-disable-next-line no-constant-condition
    while (true) {
      try {
        return await fn();
      } catch (e) {
        if (Date.now() - start > timeoutMs) {
          throw new Error(`${label}: ${e instanceof Error ? e.message : e}`);
        }
        await new Promise((r) => setTimeout(r, 500));
      }
    }
  })();
}

export async function startLocalnet() {
  if (!existsSync(SO_PATH)) {
    throw new Error(
      `Program binary missing at ${SO_PATH}. Run \`anchor build\` from the repo root first.`
    );
  }

  // Two separate temp dirs: one is the validator's ledger (it gets `--reset`-wiped),
  // the other holds the deployer keypair file (must survive the reset, since the CLI
  // deploy reads it). Co-locating them was a bug: `--reset` deleted the keypair.
  const ledger = mkdtempSync(resolve(tmpdir(), "meridian-e2e-ledger-"));
  const work = mkdtempSync(resolve(tmpdir(), "meridian-e2e-work-"));
  const deployer = Keypair.generate();
  const deployerPath = resolve(work, "deployer.json");
  writeFileSync(deployerPath, JSON.stringify(Array.from(deployer.secretKey)));

  // Bare validator; we deploy the program upgradeably afterward so ProgramData exists.
  // Detached + unref'd so it outlives this setup script (the parent reads its PID from
  // `.localnet.json` and stops it in teardown).
  const validator = spawn(
    "solana-test-validator",
    ["--reset", "--quiet", "--ledger", ledger],
    { stdio: "ignore", detached: true }
  );
  validator.unref();

  const connection = new Connection(RPC, "confirmed");
  await waitFor(() => connection.getVersion(), 40_000, "validator RPC");

  const stop = () => {
    try {
      process.kill(validator.pid, "SIGTERM");
    } catch {
      /* already gone */
    }
    for (const dir of [ledger, work]) {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        /* best effort */
      }
    }
  };

  try {
    await airdrop(connection, deployer.publicKey, 100);

    // Upgradeable deploy with our program keypair. `--keypair`/`--url` are GLOBAL flags
    // (before the subcommand) and set the default signer. We also pass the deployer
    // explicitly as the fee payer and the upgrade authority — the latter is what
    // `initialize_config` checks against — since the ephemeral deployer isn't the
    // machine's configured default keypair.
    execFileSync(
      "solana",
      [
        "--keypair",
        deployerPath,
        "--url",
        RPC,
        "program",
        "deploy",
        SO_PATH,
        "--program-id",
        PROGRAM_KEYPAIR,
        "--fee-payer",
        deployerPath,
        "--upgrade-authority",
        deployerPath,
      ],
      { stdio: "pipe" }
    );

    // Node resolves the package to its built dist/cjs (the `pretest:e2e` script runs
    // `yarn workspace @meridian/sdk build` first). Running standalone avoids the app's
    // TS path alias that points `@meridian/sdk` at the source.
    const sdk = await import("@meridian/sdk");
    const {
      getProgram,
      initializeConfig,
      createStrikeMarket,
      initOrderBook,
      growOrderBook,
      Ticker,
      NUM_TICKERS,
      PROGRAM_ID,
      configPda,
      deriveMarketPdasFromIdentity,
    } = sdk;

    const program = getProgram({ connection, publicKey: deployer.publicKey });
    const usdcMint = await createMint(
      connection,
      deployer,
      deployer.publicKey,
      null,
      6
    );
    const programData = PublicKey.findProgramAddressSync(
      [PROGRAM_ID.toBuffer()],
      BPF_LOADER_UPGRADEABLE
    )[0];

    const tickers = Array.from({ length: NUM_TICKERS }, (_, i) => ({
      ticker: i,
      feedId: new Array(32).fill(i + 1),
    }));
    await sendIx(connection, deployer, [
      await initializeConfig(program, {
        admin: deployer.publicKey,
        programData,
        usdcMint,
        tickers,
      }),
    ]);

    const now = Math.floor(Date.now() / 1000);
    // Two open markets (close ~2h out) for the trade paths. We pre-fund the wallet with
    // single-side inventory in each so the four paths are economically valid AND don't
    // trip the position-constraint guard (which blocks acquiring the opposite side while
    // holding one): the Yes-side paths run on the Yes-funded market, the No-side paths on
    // the No-funded market.
    const yesMarket = {
      ticker: Ticker.Meta, // META → Yes-side paths
      strike: 680_000_000,
      tradingDay: now + 2 * 3600,
    };
    const noMarket = {
      ticker: Ticker.Aapl, // AAPL → No-side paths
      strike: 190_000_000,
      tradingDay: now + 2 * 3600,
    };
    // Settle-able market (closed >1h ago, past the admin-override delay) for redeem.
    const settledMarket = {
      ticker: Ticker.Nvda,
      strike: 120_000_000,
      tradingDay: now - 2 * 3600,
    };

    for (const m of [yesMarket, noMarket, settledMarket]) {
      await sendIx(connection, deployer, [
        await createStrikeMarket(program, {
          admin: deployer.publicKey,
          usdcMint,
          market: m,
        }),
      ]);
      await sendIx(connection, deployer, [
        await initOrderBook(program, {
          payer: deployer.publicKey,
          usdcMint,
          market: m,
        }),
      ]);
      await sendIx(connection, deployer, [
        await growOrderBook(program, { payer: deployer.publicKey, market: m }),
      ]);
    }

    const yesK = deriveMarketPdasFromIdentity(
      yesMarket.ticker,
      yesMarket.strike,
      yesMarket.tradingDay
    );
    const noK = deriveMarketPdasFromIdentity(
      noMarket.ticker,
      noMarket.strike,
      noMarket.tradingDay
    );
    const settledK = deriveMarketPdasFromIdentity(
      settledMarket.ticker,
      settledMarket.strike,
      settledMarket.tradingDay
    );

    // The browser-driven test wallet: SOL + 100 USDC.
    const wallet = Keypair.generate();
    await airdrop(connection, wallet.publicKey, 10);
    const walletUsdc = await getOrCreateAssociatedTokenAccount(
      connection,
      deployer,
      usdcMint,
      wallet.publicKey
    );
    await mintTo(
      connection,
      deployer,
      usdcMint,
      walletUsdc.address,
      deployer,
      100_000_000
    );

    const { mintPair, adminSettle } = sdk;

    // Pre-fund single-side inventory. The wallet mints 2 pairs in each open market
    // (getting Yes+No), then moves the *unwanted* side to the deployer so it holds only
    // Yes in the Yes-market and only No in the No-market. That makes Sell Yes / Sell No
    // economically valid (there's inventory to escrow) and keeps the position-constraint
    // guard satisfied (it never holds both sides of a strike).
    await fundSingleSide(connection, sdk, {
      wallet,
      deployer,
      usdcMint,
      market: yesMarket,
      keep: "yes",
      pairs: 2,
    });
    await fundSingleSide(connection, sdk, {
      wallet,
      deployer,
      usdcMint,
      market: noMarket,
      keep: "no",
      pairs: 2,
    });

    // Seed a *redeemable* position so the browser can drive the redeem flow: the wallet
    // mints a pair in the settled market (it signs), then the admin (deployer) settles it
    // Yes-wins (past the override delay). The browser then redeems the Yes.
    await sendIx(
      connection,
      wallet,
      [
        await mintPair(program, {
          user: wallet.publicKey,
          usdcMint,
          market: settledMarket,
        }),
      ],
      [wallet]
    );
    await sendIx(connection, deployer, [
      await adminSettle(program, {
        admin: deployer.publicKey,
        market: settledMarket,
        // Closing price ≥ strike → Yes wins; the test wallet's Yes becomes redeemable.
        settlementPrice: settledMarket.strike + 1,
      }),
    ]);

    const out = {
      rpc: RPC,
      programId: PROGRAM_ID.toBase58(),
      usdcMint: usdcMint.toBase58(),
      config: configPda().toBase58(),
      deployer: Array.from(deployer.secretKey),
      yesMarket: {
        address: yesK.market.toBase58(),
        identity: yesMarket,
        symbol: "META",
      },
      noMarket: {
        address: noK.market.toBase58(),
        identity: noMarket,
        symbol: "AAPL",
      },
      settledMarket: {
        address: settledK.market.toBase58(),
        identity: settledMarket,
        symbol: "NVDA",
      },
      wallet: Array.from(wallet.secretKey),
      walletPubkey: wallet.publicKey.toBase58(),
      // Recorded so a separate teardown process can stop the validator + clean dirs.
      validatorPid: validator.pid,
      ledger,
      work,
    };
    writeFileSync(OUT_PATH, JSON.stringify(out, null, 2));
    return { out, stop };
  } catch (e) {
    stop();
    throw e;
  }
}

async function airdrop(connection, pubkey, sol) {
  const sig = await connection.requestAirdrop(pubkey, sol * 1_000_000_000);
  await connection.confirmTransaction(sig, "confirmed");
}

async function sendIx(connection, payer, ixs, signers = [payer]) {
  const tx = new Transaction().add(...ixs);
  return sendAndConfirmTransaction(connection, tx, signers, {
    commitment: "confirmed",
  });
}

/**
 * Give the wallet single-side inventory in a market: mint `pairs` pairs (wallet signs,
 * gets Yes+No), then transfer the side it should NOT keep to the deployer — leaving it
 * holding only `keep`. PAYOFF_UNIT base units per pair.
 */
async function fundSingleSide(
  connection,
  sdk,
  { wallet, deployer, usdcMint, market, keep, pairs }
) {
  const { mintPair, yesMintPda, noMintPda, marketPda, PAYOFF_UNIT } = sdk;
  const marketAddr = marketPda(market.ticker, market.strike, market.tradingDay);
  const yesMint = yesMintPda(marketAddr);
  const noMint = noMintPda(marketAddr);

  for (let i = 0; i < pairs; i++) {
    await sendIx(
      connection,
      wallet,
      [await mintPair(sdk.getProgram({ connection, publicKey: wallet.publicKey }), {
        user: wallet.publicKey,
        usdcMint,
        market,
      })],
      [wallet]
    );
  }

  // Move the unwanted side to the deployer so the wallet holds only `keep`.
  const dropMint = keep === "yes" ? noMint : yesMint;
  const walletDrop = getAssociatedTokenAddressSync(dropMint, wallet.publicKey);
  const deployerDrop = await getOrCreateAssociatedTokenAccount(
    connection,
    deployer,
    dropMint,
    deployer.publicKey
  );
  const amount = BigInt(PAYOFF_UNIT.toString()) * BigInt(pairs);
  await sendIx(
    connection,
    wallet,
    [
      createTransferInstruction(
        walletDrop,
        deployerDrop.address,
        wallet.publicKey,
        amount
      ),
    ],
    [wallet]
  );
}

// Spawned standalone by global-setup (`node e2e/setup/localnet.mjs`). On success it
// has written `.localnet.json`; the parent reads that. Always runs as main here.
startLocalnet()
  .then(({ out }) => {
    // eslint-disable-next-line no-console
    console.log("localnet ready:", out.walletPubkey);
  })
  .catch((e) => {
    // eslint-disable-next-line no-console
    console.error(e);
    process.exit(1);
  });
