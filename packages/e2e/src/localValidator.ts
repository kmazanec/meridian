/**
 * Local-validator harness for the convergence suite.
 *
 * Boots a real `solana-test-validator`, deploys the compiled program **upgradeably**
 * (so a ProgramData account exists with our deployer as upgrade authority —
 * `initialize_config` requires it), and hands back a live `Connection` plus the funded
 * deployer keypair. Unlike the SDK's LiteSVM `Harness`, this drives a real validator, so
 * `getProgramAccounts` (market discovery), real ATAs, and the automation service's
 * `RpcChainClient` all run for real — the actual cross-stack convergence surface.
 *
 * Mirrors the bring-up proven in the web e2e harness (boot → upgradeable deploy → fund),
 * generalized for reuse and TypeScript. A boot takes tens of seconds, so callers boot
 * once per test file in a `before` hook and `stop()` in `after`.
 */

import { spawn, execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import {
  Connection,
  Keypair,
  PublicKey,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";

/** Default RPC for a freshly booted local validator. */
const DEFAULT_RPC = "http://127.0.0.1:8899";

/** The on-chain upgradeable BPF loader; ProgramData is a PDA of [programId] under it. */
const BPF_LOADER_UPGRADEABLE = new PublicKey(
  "BPFLoaderUpgradeab1e11111111111111111111111"
);

/**
 * Locate the repo root from this file. In a normal checkout `target/deploy/` lives here;
 * in a git *worktree* `target/` is typically empty, so callers should set `MERIDIAN_SO`
 * (and, if needed, `MERIDIAN_PROGRAM_KEYPAIR`) to a `.so` built elsewhere for the same
 * program source. CI builds it in-tree.
 */
function repoRoot(): string {
  // packages/e2e/src -> packages/e2e -> packages -> repo root
  return resolve(__dirname, "..", "..", "..");
}

/** Path to the compiled program `.so` (env override wins; useful in a worktree). */
export function programSoPath(): string {
  return (
    process.env.MERIDIAN_SO ??
    resolve(repoRoot(), "target", "deploy", "meridian.so")
  );
}

/** Path to the program's deploy keypair (env override wins; useful in a worktree). */
export function programKeypairPath(): string {
  return (
    process.env.MERIDIAN_PROGRAM_KEYPAIR ??
    resolve(repoRoot(), "target", "deploy", "meridian-keypair.json")
  );
}

/** Resolve the `solana`/`solana-test-validator` binaries (env override for odd installs). */
function solanaBin(name: "solana" | "solana-test-validator"): string {
  const override =
    name === "solana"
      ? process.env.SOLANA_BIN
      : process.env.SOLANA_TEST_VALIDATOR_BIN;
  return override ?? name;
}

/** True when this machine can run the on-validator suite (binaries + built program present). */
export function validatorAvailable(): boolean {
  if (!existsSync(programSoPath()) || !existsSync(programKeypairPath())) {
    return false;
  }
  try {
    execFileSync(solanaBin("solana-test-validator"), ["--version"], {
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * A `describe` that becomes `describe.skip` when no local validator can run (missing
 * binary or un-built program). Keeps a Node-only CI runner green without the Solana
 * toolchain, exactly as the SDK's `describeOnChain` does for LiteSVM. Set
 * `E2E_REQUIRE_VALIDATOR=1` to make a missing validator a hard failure instead (so a
 * misconfigured local run doesn't silently skip everything).
 */
export const describeOnValidator: Mocha.SuiteFunction = (() => {
  const available = validatorAvailable();
  if (available) return describe;
  if (process.env.E2E_REQUIRE_VALIDATOR) {
    return ((title: string, fn: (this: Mocha.Suite) => void) =>
      describe(title, function () {
        it("requires a local validator (E2E_REQUIRE_VALIDATOR is set)", () => {
          throw new Error(
            `No runnable local validator. Checked:\n` +
              `  program .so:      ${programSoPath()}\n` +
              `  program keypair:  ${programKeypairPath()}\n` +
              `  solana-test-validator on PATH (or SOLANA_TEST_VALIDATOR_BIN)\n` +
              `Build with \`anchor build\` (or set MERIDIAN_SO) and install the Solana CLI.`
          );
        });
        // Still register the suite body so failures are obvious rather than empty.
        fn.call(this);
      })) as unknown as Mocha.SuiteFunction;
  }
  return describe.skip;
})() as Mocha.SuiteFunction;

/** A booted validator: a live connection, the funded deployer, and a teardown hook. */
export interface LocalValidator {
  readonly connection: Connection;
  readonly deployer: Keypair;
  readonly programId: PublicKey;
  readonly programData: PublicKey;
  readonly rpcUrl: string;
  /** Stop the validator and remove its temp dirs. Idempotent. */
  stop(): void;
}

export interface StartLocalValidatorOptions {
  /** Lamports/SOL to airdrop the deployer (it pays for everything). Default 100 SOL. */
  deployerSol?: number;
  /** Override the RPC URL (default 127.0.0.1:8899). */
  rpcUrl?: string;
  /** Max ms to wait for the validator RPC to come up. Default 60s. */
  bootTimeoutMs?: number;
}

async function waitFor<T>(
  fn: () => Promise<T>,
  timeoutMs: number,
  label: string
): Promise<T> {
  const start = Date.now();
  let lastErr: unknown;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      if (Date.now() - start > timeoutMs) {
        throw new Error(
          `${label} (after ${timeoutMs}ms): ${
            lastErr instanceof Error ? lastErr.message : String(lastErr)
          }`
        );
      }
      await new Promise((r) => setTimeout(r, 500));
    }
  }
}

/**
 * Boot a validator, deploy the program upgradeably, fund the deployer, and return a
 * {@link LocalValidator}. Throws (after cleaning up) if any step fails — so a failed boot
 * never leaks a validator process or temp dir.
 */
export async function startLocalValidator(
  opts: StartLocalValidatorOptions = {}
): Promise<LocalValidator> {
  const rpcUrl = opts.rpcUrl ?? DEFAULT_RPC;
  const deployerSol = opts.deployerSol ?? 100;
  const bootTimeoutMs = opts.bootTimeoutMs ?? 60_000;

  const soPath = programSoPath();
  const keypairPath = programKeypairPath();
  if (!existsSync(soPath)) {
    throw new Error(
      `Program binary missing at ${soPath}. Run \`anchor build\` from the repo root, ` +
        `or set MERIDIAN_SO to a .so built for the same program source.`
    );
  }
  if (!existsSync(keypairPath)) {
    throw new Error(
      `Program keypair missing at ${keypairPath}. Set MERIDIAN_PROGRAM_KEYPAIR if your ` +
        `target/ is not populated (e.g. in a worktree).`
    );
  }

  // This harness binds the validator's default RPC port (8899). That makes two
  // assumptions, both load-bearing:
  //   1. Mocha runs spec files sequentially in one process (the default). Do NOT add
  //      `--parallel` to the test script — parallel files would each boot a validator on
  //      the same port and all but one would fail to bind.
  //   2. No other validator is already on the port. A stale validator from a crashed prior
  //      run would answer the RPC poll immediately, and we'd deploy onto its dirty ledger —
  //      giving silently wrong results. Fail loudly instead of reusing a foreign validator.
  const preexisting = await new Connection(rpcUrl, "confirmed")
    .getVersion()
    .then(() => true)
    .catch(() => false);
  if (preexisting) {
    throw new Error(
      `Something is already serving RPC at ${rpcUrl} (a stale or external solana-test-validator?). ` +
        `Stop it before running the convergence suite — this harness manages its own validator ` +
        `and must start from a clean ledger.`
    );
  }

  // Two temp dirs: the validator's ledger (wiped by --reset) and a work dir for the
  // deployer keypair file the CLI deploy reads (must survive the reset).
  const ledger = mkdtempSync(resolve(tmpdir(), "meridian-e2e-ledger-"));
  const work = mkdtempSync(resolve(tmpdir(), "meridian-e2e-work-"));
  const deployer = Keypair.generate();
  const deployerPath = resolve(work, "deployer.json");
  writeFileSync(deployerPath, JSON.stringify(Array.from(deployer.secretKey)));

  // Detached + unref'd so a crashed test runner doesn't leave it attached to a dead
  // parent's pipes; we kill it explicitly in stop().
  const validator = spawn(
    solanaBin("solana-test-validator"),
    ["--reset", "--quiet", "--ledger", ledger],
    { stdio: "ignore", detached: true }
  );
  validator.unref();

  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    if (validator.pid !== undefined) {
      try {
        process.kill(validator.pid, "SIGTERM");
      } catch {
        /* already gone */
      }
    }
    for (const dir of [ledger, work]) {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        /* best effort */
      }
    }
  };

  // If the child fails to spawn at all (e.g. binary not found), surface it AND clean up —
  // the spawn error is async and lands outside the try/catch below, so without stop() here
  // the ledger/work temp dirs created above would leak.
  validator.on("error", (e) => {
    // eslint-disable-next-line no-console
    console.error("solana-test-validator failed to spawn:", e.message);
    stop();
  });

  try {
    const connection = new Connection(rpcUrl, "confirmed");
    await waitFor(
      () => connection.getVersion(),
      bootTimeoutMs,
      "validator RPC"
    );

    // Fund the deployer (airdrop, confirmed).
    const sig = await connection.requestAirdrop(
      deployer.publicKey,
      deployerSol * LAMPORTS_PER_SOL
    );
    await connection.confirmTransaction(sig, "confirmed");

    // Upgradeable deploy with our program keypair. --keypair/--url are GLOBAL flags
    // (before the subcommand); the deployer is also the explicit fee payer and upgrade
    // authority (what initialize_config checks against).
    execFileSync(
      solanaBin("solana"),
      [
        "--keypair",
        deployerPath,
        "--url",
        rpcUrl,
        "program",
        "deploy",
        soPath,
        "--program-id",
        keypairPath,
        "--fee-payer",
        deployerPath,
        "--upgrade-authority",
        deployerPath,
      ],
      { stdio: "pipe" }
    );

    const programId = programIdFromKeypairFile(keypairPath);
    const programData = PublicKey.findProgramAddressSync(
      [programId.toBuffer()],
      BPF_LOADER_UPGRADEABLE
    )[0];

    return { connection, deployer, programId, programData, rpcUrl, stop };
  } catch (e) {
    stop();
    throw e;
  }
}

/** Read a Solana CLI keypair file (JSON byte array) and return its public key. */
function programIdFromKeypairFile(path: string): PublicKey {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const bytes = JSON.parse(
    require("node:fs").readFileSync(path, "utf8")
  ) as number[];
  return Keypair.fromSecretKey(Uint8Array.from(bytes)).publicKey;
}
