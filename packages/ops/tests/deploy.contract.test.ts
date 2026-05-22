/**
 * Pure contract tests for the deploy/bootstrap surface: the exact `solana program deploy`
 * argv, the ProgramData PDA derivation, the feed-id conversion + ticker-config assembly, and
 * the deploy-manifest round-trip. No validator, no CLI spawn — just the logic the live
 * scripts depend on, so the deploy invocation can't drift unnoticed (it must keep matching
 * the F-09 harness, which is the proven-correct reference).
 */

import { expect } from "chai";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { PublicKey } from "@solana/web3.js";
import { NUM_TICKERS, Ticker, TICKER_SYMBOLS } from "@meridian/sdk";
import {
  deployArgv,
  programDataAddress,
  BPF_LOADER_UPGRADEABLE,
} from "../src/deploy";
import {
  feedIdHexToBytes,
  testFeedId,
  buildTickerConfig,
} from "../src/bootstrap";
import { writeManifest, readManifest, requireManifest } from "../src/manifest";

describe("deploy argv (contract)", () => {
  it("places global --keypair/--url before the subcommand and sets upgrade authority", () => {
    const argv = deployArgv({
      rpcUrl: "https://api.devnet.solana.com",
      deployerPath: "/tmp/deployer.json",
      soPath: "/repo/target/deploy/meridian.so",
      programKeypairPath: "/repo/target/deploy/meridian-keypair.json",
    });
    expect(argv).to.deep.equal([
      "--keypair",
      "/tmp/deployer.json",
      "--url",
      "https://api.devnet.solana.com",
      "program",
      "deploy",
      "/repo/target/deploy/meridian.so",
      "--program-id",
      "/repo/target/deploy/meridian-keypair.json",
      "--fee-payer",
      "/tmp/deployer.json",
      "--upgrade-authority",
      "/tmp/deployer.json",
    ]);
  });

  it("global flags precede the `program deploy` subcommand", () => {
    const argv = deployArgv({
      rpcUrl: "http://127.0.0.1:8899",
      deployerPath: "d",
      soPath: "s",
      programKeypairPath: "k",
    });
    expect(argv.indexOf("--url")).to.be.lessThan(argv.indexOf("program"));
    expect(argv.indexOf("--keypair")).to.be.lessThan(argv.indexOf("program"));
  });
});

describe("programDataAddress (contract)", () => {
  it("derives the ProgramData PDA under the upgradeable loader", () => {
    const programId = new PublicKey(
      "9R3jRbvh9jeQLGEggB3VXQTwj88YjUKqKM8x75SefGen"
    );
    const expected = PublicKey.findProgramAddressSync(
      [programId.toBuffer()],
      BPF_LOADER_UPGRADEABLE
    )[0];
    expect(programDataAddress(programId).toBase58()).to.equal(
      expected.toBase58()
    );
  });
});

describe("feed ids (contract)", () => {
  it("converts a 64-hex feed id to 32 bytes (with and without 0x)", () => {
    const hex = "00".repeat(31) + "2a"; // 31 zero bytes + 0x2a
    const bytes = feedIdHexToBytes(hex);
    expect(bytes.length).to.equal(32);
    expect(bytes[31]).to.equal(0x2a);
    expect(feedIdHexToBytes("0x" + hex)).to.deep.equal(bytes);
  });

  it("rejects a wrong-length or non-hex feed id", () => {
    expect(() => feedIdHexToBytes("abc")).to.throw(/32 bytes/);
    expect(() => feedIdHexToBytes("zz".repeat(32))).to.throw(/32 bytes/);
  });

  it("testFeedId is the deterministic [i+1; 32] local pattern", () => {
    expect(testFeedId(Ticker.Aapl)).to.deep.equal(new Array(32).fill(1));
    expect(testFeedId(Ticker.Tsla)).to.deep.equal(new Array(32).fill(7));
  });

  it("buildTickerConfig emits all NUM_TICKERS entries, preferring configured hex feeds", () => {
    const metaHex = "11".repeat(32);
    const cfg = buildTickerConfig({ META: metaHex });
    expect(cfg.length).to.equal(NUM_TICKERS);
    // META (ordinal 5) uses the configured hex; the rest fall back to the test pattern.
    const meta = cfg.find((c) => c.ticker === Ticker.Meta)!;
    expect(meta.feedId).to.deep.equal(feedIdHexToBytes(metaHex));
    const aapl = cfg.find((c) => c.ticker === Ticker.Aapl)!;
    expect(aapl.feedId).to.deep.equal(testFeedId(Ticker.Aapl));
    // Every ticker ordinal is present exactly once.
    expect(new Set(cfg.map((c) => c.ticker)).size).to.equal(NUM_TICKERS);
    expect(TICKER_SYMBOLS.length).to.equal(NUM_TICKERS);
  });
});

describe("deploy manifest (contract)", () => {
  it("round-trips and stamps writtenAt; requireManifest throws when absent", () => {
    const dir = mkdtempSync(resolve(tmpdir(), "ops-manifest-"));
    try {
      const path = resolve(dir, "deploy-manifest.json");
      expect(readManifest(path)).to.equal(null);
      expect(() => requireManifest(path)).to.throw(/No deploy manifest/);

      writeManifest(
        {
          cluster: "devnet",
          rpcUrl: "https://api.devnet.solana.com",
          programId: "9R3jRbvh9jeQLGEggB3VXQTwj88YjUKqKM8x75SefGen",
          programData: "11111111111111111111111111111111",
          usdcMint: "11111111111111111111111111111111",
          config: "11111111111111111111111111111111",
          admin: "11111111111111111111111111111111",
        },
        path
      );
      const m = requireManifest(path);
      expect(m.cluster).to.equal("devnet");
      expect(m.programId).to.equal(
        "9R3jRbvh9jeQLGEggB3VXQTwj88YjUKqKM8x75SefGen"
      );
      expect(m.writtenAt).to.be.a("string");
      expect(new Date(m.writtenAt).toString()).to.not.equal("Invalid Date");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
