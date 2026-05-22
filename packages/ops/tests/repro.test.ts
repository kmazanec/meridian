/**
 * Reproducibility verification (the binding F-10 testing requirement): the deploy + lifecycle
 * scripts are *themselves exercised* against a real validator, not assumed to work.
 *
 * Validator-gated (skips cleanly without a `solana-test-validator` + a built `.so`, exactly
 * like the convergence suite). It boots a real validator and runs the **actual ops bins** as
 * subprocesses — the same commands `make` and the operator run — in order:
 *   deploy → bootstrap → create-markets → lifecycle
 * then asserts the deploy manifest is well-formed and the on-chain invariants hold (read back
 * via the SDK). A non-zero exit from any bin, or a broken invariant, fails the test. This is
 * what makes "reproducible" a checked claim rather than a hope.
 *
 * Not in the Node-only CI job (no Solana toolchain there); CI runs this package's *typecheck*
 * and pure *.contract* tests. Run locally with: `yarn workspace @meridian/ops test`.
 */

import { expect } from "chai";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fetchConfig, getProgram } from "@meridian/sdk";
import {
  startLocalValidator,
  describeOnValidator,
  type LocalValidator,
} from "@meridian/e2e";
import { readManifest } from "../src/manifest";

const OPS_DIR = resolve(__dirname, "..");

describeOnValidator("ops scripts reproducibility", function () {
  this.timeout(600_000);

  let validator: LocalValidator;
  let work: string;
  let deployerPath: string;
  let manifestPath: string;

  before(async () => {
    // startLocalValidator deploys the program upfront; the ops `deploy` bin we run below
    // therefore exercises its idempotent UPGRADE path, and bootstrap/create-markets/lifecycle
    // run fresh against it — the full operator pipeline end to end.
    validator = await startLocalValidator();

    work = mkdtempSync(resolve(tmpdir(), "ops-repro-"));
    // Reuse the validator's funded deployer (it is the program's upgrade authority, which
    // initialize_config requires) by writing its secret to a keypair file the bins read.
    deployerPath = resolve(work, "deployer.json");
    writeFileSync(
      deployerPath,
      JSON.stringify(Array.from(validator.deployer.secretKey))
    );
    manifestPath = resolve(work, "deploy-manifest.json");
  });

  after(async () => {
    await validator?.stop();
    if (work) rmSync(work, { recursive: true, force: true });
  });

  /** Run an ops bin via ts-node with the repro env; throws (failing the test) on non-zero exit. */
  function runBin(script: string, extraEnv: Record<string, string> = {}): void {
    execFileSync(
      "ts-node",
      [
        "--project",
        resolve(OPS_DIR, "tsconfig.json"),
        resolve(OPS_DIR, "src", "bin", script),
      ],
      {
        cwd: OPS_DIR,
        env: {
          ...process.env,
          RPC_URL: validator.rpcUrl,
          DEPLOYER_KEYPAIR: deployerPath,
          OPS_MANIFEST: manifestPath,
          // The worktree target/ is empty; the validator harness already resolved the .so via
          // MERIDIAN_SO (CI builds it in-tree). Pass the same overrides through to the bins.
          ...(process.env.MERIDIAN_SO
            ? { MERIDIAN_SO: process.env.MERIDIAN_SO }
            : {}),
          ...(process.env.MERIDIAN_PROGRAM_KEYPAIR
            ? { MERIDIAN_PROGRAM_KEYPAIR: process.env.MERIDIAN_PROGRAM_KEYPAIR }
            : {}),
          ...extraEnv,
        },
        stdio: "pipe",
        timeout: 300_000,
      }
    );
  }

  it("runs deploy → bootstrap → create-markets → lifecycle and holds the invariants", async () => {
    // ── the actual operator pipeline, as subprocesses ──
    runBin("deploy.ts");
    runBin("bootstrap.ts");
    runBin("create-markets.ts", { TICKERS: "META", MOCK_CLOSE_META: "680" });
    runBin("lifecycle.ts");

    // ── manifest is well-formed and secret-free ──
    const manifest = readManifest(manifestPath);
    expect(manifest, "manifest written").to.not.equal(null);
    expect(manifest!.programId).to.be.a("string").with.length.greaterThan(0);
    expect(manifest!.usdcMint).to.be.a("string").with.length.greaterThan(0);
    // No secret material in the manifest (only public addresses + RPC).
    const raw = readFileSync(manifestPath, "utf8");
    expect(raw, "manifest carries no inline keypair").to.not.match(
      /\[\s*\d+(\s*,\s*\d+){63}\s*\]/
    );

    // ── Config is initialized with the manifest's USDC mint (deploy+bootstrap really ran) ──
    const program = getProgram({
      connection: validator.connection,
      publicKey: validator.deployer.publicKey,
    } as never);
    const config = await fetchConfig(program);
    expect(config, "Config initialized on-chain").to.not.equal(null);
    expect(config!.usdcMint.toBase58()).to.equal(manifest!.usdcMint);
    expect(config!.admin.toBase58()).to.equal(
      validator.deployer.publicKey.toBase58()
    );

    // The lifecycle bin asserts the §7 invariants *internally* at every phase
    // (collateralization after each step, payout completeness via the drained vault,
    // settlement timing via the admin delay) and throws on any violation — so a zero exit
    // from `runBin("lifecycle.ts")` above is itself the invariant proof. The Config +
    // manifest checks here confirm deploy + bootstrap really ran end to end.
  });
});
