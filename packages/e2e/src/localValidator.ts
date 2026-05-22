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

import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  writeFileSync,
  rmSync,
  readFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { createServer } from "node:net";
import {
  Connection,
  Keypair,
  PublicKey,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";

/** Ask the OS for an unused TCP port (bind :0, read the assigned port, release it). */
function freePort(): Promise<number> {
  return new Promise((res, rej) => {
    const srv = createServer();
    srv.on("error", rej);
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      if (addr && typeof addr === "object") {
        const { port } = addr;
        srv.close(() => res(port));
      } else {
        srv.close(() => rej(new Error("could not determine a free port")));
      }
    });
  });
}

/**
 * A free port for the faucet that is distinct from the RPC port AND the WebSocket port
 * (`rpcPort + 1`, which the validator/web3.js use for confirmations). Retries until it
 * lands clear of both.
 */
async function freeFaucetPort(rpcPort: number): Promise<number> {
  for (let i = 0; i < 20; i++) {
    const p = await freePort();
    if (p !== rpcPort && p !== rpcPort + 1) return p;
  }
  throw new Error("could not find a faucet port clear of the RPC/WS ports");
}

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
 * Resolve the right `describe` for the current environment: the real one when a validator
 * can run, a single failing test when `E2E_REQUIRE_VALIDATOR` is set but none is available,
 * or `describe.skip` otherwise. Resolved **lazily, at call time** (not module load) so this
 * module is safe to `import` from non-Mocha code — e.g. the `@meridian/ops` deploy/lifecycle
 * scripts reuse the harness primitives below (`startLocalValidator`, paths) without a Mocha
 * global in scope. The previous module-load IIFE crashed (`describe is not defined`) when
 * imported outside a test runner.
 */
function resolveDescribe(): Mocha.SuiteFunction {
  const available = validatorAvailable();
  if (available) return describe;
  if (process.env.E2E_REQUIRE_VALIDATOR) {
    // Validator required but unavailable: emit ONE clear failing test and do NOT register
    // the real suite body. Calling `fn()` would register the suite's `before(startLocalValidator)`,
    // and Mocha runs `before` hooks ahead of any `it` — so the boot would throw its own
    // (less actionable) error first and mask this diagnostic.
    return ((title: string, _fn: (this: Mocha.Suite) => void) =>
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
      })) as unknown as Mocha.SuiteFunction;
  }
  return describe.skip as unknown as Mocha.SuiteFunction;
}

/**
 * A `describe` that becomes `describe.skip` when no local validator can run (missing binary
 * or un-built program). Keeps a Node-only CI runner green without the Solana toolchain,
 * exactly as the SDK's `describeOnChain` does for LiteSVM. Set `E2E_REQUIRE_VALIDATOR=1` to
 * make a missing validator a hard failure instead.
 *
 * Implemented as a thunk that resolves `describe`/`describe.skip` on first call so importing
 * this module never touches the Mocha globals (see {@link resolveDescribe}).
 */
function makeLazyDescribe(): Mocha.SuiteFunction {
  const fn = function (this: unknown, ...args: unknown[]) {
    return (resolveDescribe() as unknown as (...a: unknown[]) => unknown).apply(
      this,
      args
    );
  };
  // Forward `.skip` / `.only` to the resolved describe lazily too, so call sites using
  // `describeOnValidator.skip(...)` keep working.
  const forward = (key: "skip" | "only") =>
    function (this: unknown, ...args: unknown[]) {
      return (
        resolveDescribe() as unknown as Record<
          string,
          (...a: unknown[]) => unknown
        >
      )[key].apply(this, args);
    };
  return Object.assign(fn, {
    skip: forward("skip"),
    only: forward("only"),
  }) as unknown as Mocha.SuiteFunction;
}

export const describeOnValidator: Mocha.SuiteFunction = makeLazyDescribe();

/** A booted validator: a live connection, the funded deployer, and a teardown hook. */
export interface LocalValidator {
  readonly connection: Connection;
  readonly deployer: Keypair;
  readonly programId: PublicKey;
  readonly programData: PublicKey;
  readonly rpcUrl: string;
  /**
   * Stop the validator and remove its temp dirs. Idempotent. **Await it** — it waits for
   * the child to exit and the RPC port to stop responding before resolving, so the next
   * boot can't collide with a still-shutting-down validator.
   */
  stop(): Promise<void>;
}

export interface StartLocalValidatorOptions {
  /** Lamports/SOL to airdrop the deployer (it pays for everything). Default 100 SOL. */
  deployerSol?: number;
  /**
   * Fixed RPC port to bind. Default: an OS-assigned free port (so concurrent or
   * back-to-back boots never collide). The validator is actually spawned on this port
   * (`--rpc-port`), and the returned `rpcUrl` reflects it.
   */
  rpcPort?: number;
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

  // Each boot binds its own ports. Default to OS-assigned free ports so back-to-back boots
  // (one per spec file) and even concurrent runs never collide — and so a still
  // shutting-down validator from the previous file can't be mistaken for ours.
  //
  // IMPORTANT: solana-test-validator serves its PubSub WebSocket on `rpc-port + 1`, and
  // web3.js derives that same WS endpoint for `confirmTransaction`. So the faucet must NOT
  // sit on `rpc-port + 1` — that would clobber the WS port and every confirmation would
  // hang. We reserve rpcPort, require rpcPort+1 (the WS port) to be free, and give the
  // faucet a *separate*, non-adjacent free port.
  const rpcPort = opts.rpcPort ?? (await freePort());
  const faucetPort = await freeFaucetPort(rpcPort);
  const rpcUrl = `http://127.0.0.1:${rpcPort}`;

  // Guard against an existing validator on the chosen port: a stale process (or, with an
  // explicit rpcPort, a foreign one) would answer the RPC poll, and we'd deploy onto its
  // dirty ledger — silently wrong. Fail loudly. (With a dynamic port this is also a cheap
  // sanity check that the just-freed port wasn't grabbed by something else.)
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
  // parent's pipes; we kill it explicitly in stop(). Bound to our chosen ports.
  const validator: ChildProcess = spawn(
    solanaBin("solana-test-validator"),
    [
      "--reset",
      "--quiet",
      "--ledger",
      ledger,
      "--rpc-port",
      String(rpcPort),
      "--faucet-port",
      String(faucetPort),
    ],
    { stdio: "ignore", detached: true }
  );
  validator.unref();

  // Resolves when the child has actually exited (so stop() can await it).
  const exited = new Promise<void>((res) => {
    validator.once("exit", () => res());
    validator.once("error", () => res()); // failed spawn → treat as "not running"
  });

  let stopped: Promise<void> | undefined;
  const stop = (): Promise<void> => {
    if (stopped) return stopped;
    stopped = (async () => {
      if (validator.pid !== undefined && validator.exitCode === null) {
        try {
          process.kill(validator.pid, "SIGTERM");
        } catch {
          /* already gone */
        }
        // Wait for the process to exit AND the RPC port to stop answering, so the next
        // boot's preexisting-RPC guard doesn't trip on our own dying validator.
        await Promise.race([exited, delay(10_000)]);
        await waitForPortFree(rpcUrl, 10_000);
      }
      for (const dir of [ledger, work]) {
        try {
          rmSync(dir, { recursive: true, force: true });
        } catch {
          /* best effort */
        }
      }
    })();
    return stopped;
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

    // Fund the deployer (airdrop, confirmed). Use the blockhash form of confirmTransaction —
    // the deprecated signature-only form can resolve before the airdrop is finalized on a
    // busy validator, causing intermittent boot failures in the repro/convergence suites.
    const sig = await connection.requestAirdrop(
      deployer.publicKey,
      deployerSol * LAMPORTS_PER_SOL
    );
    const bh = await connection.getLatestBlockhash("confirmed");
    await connection.confirmTransaction(
      {
        signature: sig,
        blockhash: bh.blockhash,
        lastValidBlockHeight: bh.lastValidBlockHeight,
      },
      "confirmed"
    );

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
    await stop();
    throw e;
  }
}

/** Resolve after `ms`. */
function delay(ms: number): Promise<void> {
  return new Promise((res) => setTimeout(res, ms));
}

/** Poll until nothing answers RPC at `rpcUrl` (the validator has fully released the port). */
async function waitForPortFree(
  rpcUrl: string,
  timeoutMs: number
): Promise<void> {
  const start = Date.now();
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const answering = await new Connection(rpcUrl, "confirmed")
      .getVersion()
      .then(() => true)
      .catch(() => false);
    if (!answering) return;
    if (Date.now() - start > timeoutMs) return; // best effort; don't hang teardown forever
    await delay(250);
  }
}

/** Read a Solana CLI keypair file (JSON byte array) and return its public key. */
function programIdFromKeypairFile(path: string): PublicKey {
  const bytes = JSON.parse(readFileSync(path, "utf8")) as number[];
  return Keypair.fromSecretKey(Uint8Array.from(bytes)).publicKey;
}
