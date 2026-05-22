/**
 * Pure contract tests for the ops environment loader. No validator, no RPC — just the
 * parsing/validation surface that every ops script depends on. Runs in CI (the *.contract
 * suite, mirroring @meridian/e2e) so the env contract can't drift from the loaders it
 * mirrors (@meridian/automation config/keypair).
 */

import { expect } from "chai";
import { writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { Keypair } from "@solana/web3.js";
import { loadOpsEnv, isLocalRpc, DEFAULT_LOCAL_RPC } from "../src/env";

/** A minimal valid env: a deployer keypair (inline JSON byte array) + an RPC. */
function baseEnv(
  extra: Record<string, string | undefined> = {}
): Record<string, string | undefined> {
  const kp = Keypair.generate();
  return {
    DEPLOYER_KEYPAIR: JSON.stringify(Array.from(kp.secretKey)),
    RPC_URL: "http://127.0.0.1:8899",
    ...extra,
  };
}

describe("ops env (contract)", () => {
  it("loads a deployer keypair from an inline JSON byte array", () => {
    const env = baseEnv();
    const cfg = loadOpsEnv(env);
    expect(cfg.deployer).to.be.instanceOf(Keypair);
    expect(cfg.rpcUrl).to.equal("http://127.0.0.1:8899");
  });

  it("loads a deployer keypair from a file PATH (the Solana CLI convention)", () => {
    const dir = mkdtempSync(resolve(tmpdir(), "ops-env-"));
    try {
      const kp = Keypair.generate();
      const path = resolve(dir, "id.json");
      writeFileSync(path, JSON.stringify(Array.from(kp.secretKey)));
      const cfg = loadOpsEnv(baseEnv({ DEPLOYER_KEYPAIR: path }));
      expect(cfg.deployer.publicKey.toBase58()).to.equal(
        kp.publicKey.toBase58()
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("accepts a base58 secret key inline", () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const bs58 = require("bs58");
    const enc = (bs58.default ?? bs58).encode;
    const kp = Keypair.generate();
    const cfg = loadOpsEnv(baseEnv({ DEPLOYER_KEYPAIR: enc(kp.secretKey) }));
    expect(cfg.deployer.publicKey.toBase58()).to.equal(kp.publicKey.toBase58());
  });

  it("treats a base58 secret as base58 even if a same-named file exists in CWD", () => {
    // Regression: the path heuristic must require a path marker (/, ~, .json) — a base58
    // secret (no marker) must never be read as a file just because the name collides on disk.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const bs58 = require("bs58");
    const enc = (bs58.default ?? bs58).encode;
    const kp = Keypair.generate();
    const b58 = enc(kp.secretKey);
    const prevCwd = process.cwd();
    const dir = mkdtempSync(resolve(tmpdir(), "ops-collide-"));
    try {
      // Create a file in CWD whose name is exactly the base58 secret (no extension).
      writeFileSync(resolve(dir, b58), "junk-not-a-keypair");
      process.chdir(dir);
      const cfg = loadOpsEnv(baseEnv({ DEPLOYER_KEYPAIR: b58 }));
      expect(cfg.deployer.publicKey.toBase58()).to.equal(
        kp.publicKey.toBase58()
      );
    } finally {
      process.chdir(prevCwd);
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("defaults RPC_URL to the local validator endpoint when unset", () => {
    const env = baseEnv();
    delete env.RPC_URL;
    const cfg = loadOpsEnv(env);
    expect(cfg.rpcUrl).to.equal(DEFAULT_LOCAL_RPC);
  });

  it("throws a clear error when the deployer keypair is missing", () => {
    const env = baseEnv();
    delete env.DEPLOYER_KEYPAIR;
    expect(() => loadOpsEnv(env)).to.throw(/DEPLOYER_KEYPAIR/);
  });

  it("throws when a keypair path points at a missing file", () => {
    expect(() =>
      loadOpsEnv(baseEnv({ DEPLOYER_KEYPAIR: "/no/such/keypair.json" }))
    ).to.throw(/keypair file/i);
  });

  it("rejects a malformed inline keypair (wrong byte length)", () => {
    expect(() =>
      loadOpsEnv(baseEnv({ DEPLOYER_KEYPAIR: JSON.stringify([1, 2, 3]) }))
    ).to.throw();
  });

  it("parses an optional USDC_MINT pubkey and rejects garbage", () => {
    const mint = Keypair.generate().publicKey;
    const cfg = loadOpsEnv(baseEnv({ USDC_MINT: mint.toBase58() }));
    expect(cfg.usdcMint?.toBase58()).to.equal(mint.toBase58());
    expect(loadOpsEnv(baseEnv()).usdcMint).to.equal(undefined);
    expect(() => loadOpsEnv(baseEnv({ USDC_MINT: "not-a-key" }))).to.throw(
      /USDC_MINT/
    );
  });

  it("derives a cluster label from RPC_URL, overridable by CLUSTER", () => {
    expect(loadOpsEnv(baseEnv()).cluster).to.equal("localnet");
    expect(
      loadOpsEnv(baseEnv({ RPC_URL: "https://api.devnet.solana.com" })).cluster
    ).to.equal("devnet");
    expect(
      loadOpsEnv(
        baseEnv({ RPC_URL: "https://api.devnet.solana.com", CLUSTER: "custom" })
      ).cluster
    ).to.equal("custom");
  });

  it("labels an unrecognized remote RPC 'unknown', NOT 'localnet'", () => {
    // A private/non-standard node must not be mislabeled local (that would fool dev-up's guard).
    expect(
      loadOpsEnv(baseEnv({ RPC_URL: "https://rpc.example-staging.io/x" }))
        .cluster
    ).to.equal("unknown");
    expect(
      loadOpsEnv(baseEnv({ RPC_URL: "http://10.0.1.5:8899" })).cluster
    ).to.equal("unknown");
  });

  it("isLocalRpc accepts only genuine loopback hosts (the dev-up safety guard)", () => {
    expect(isLocalRpc("http://127.0.0.1:8899")).to.equal(true);
    expect(isLocalRpc("http://localhost:8899")).to.equal(true);
    expect(isLocalRpc("http://[::1]:8899")).to.equal(true);
    // Remote / private / tricky URLs must NOT pass.
    expect(isLocalRpc("https://api.devnet.solana.com")).to.equal(false);
    expect(isLocalRpc("http://10.0.1.5:8899")).to.equal(false);
    expect(isLocalRpc("https://rpc.example.com/?host=localhost")).to.equal(
      false
    );
    expect(isLocalRpc("https://localhost.evil.com")).to.equal(false);
    expect(isLocalRpc("not-a-url")).to.equal(false);
  });

  it("parses per-ticker mock closes (dollars) into base units, default empty", () => {
    const cfg = loadOpsEnv(baseEnv({ MOCK_CLOSE_META: "680" }));
    // 680 USD -> 680_000000 base units (6 dp).
    expect(cfg.mockCloses.META?.toString()).to.equal("680000000");
    expect(loadOpsEnv(baseEnv()).mockCloses).to.deep.equal({});
    expect(() => loadOpsEnv(baseEnv({ MOCK_CLOSE_META: "-5" }))).to.throw(
      /MOCK_CLOSE_META/
    );
  });

  it("parses the TICKERS selection, defaulting to the full MAG7", () => {
    expect(loadOpsEnv(baseEnv()).tickers.length).to.equal(7);
    const cfg = loadOpsEnv(baseEnv({ TICKERS: "META,AAPL" }));
    expect(cfg.tickers.length).to.equal(2);
  });
});
