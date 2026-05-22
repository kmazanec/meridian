/**
 * Config + keypair-loading tests.
 *
 * The automation keypair is loaded from an environment secret (never a path committed to
 * the repo): a JSON byte array (the Solana CLI keypair format) or a base58 string. The
 * loader rejects a missing/empty/garbage secret loudly. Config parsing validates required
 * fields and surfaces clear errors.
 */

import { expect } from "chai";
import { Keypair } from "@solana/web3.js";
import { Ticker } from "@meridian/sdk";
import { loadKeypairFromEnv } from "../src/keypair";
import { loadConfig, PriceSourceKind } from "../src/config";

describe("loadKeypairFromEnv", () => {
  it("loads a JSON byte-array secret (Solana CLI format)", () => {
    const kp = Keypair.generate();
    const secret = JSON.stringify(Array.from(kp.secretKey));
    const loaded = loadKeypairFromEnv({ AUTOMATION_KEYPAIR: secret });
    expect(loaded.publicKey.equals(kp.publicKey)).to.be.true;
  });

  it("loads a base58 secret-key string", () => {
    // bs58 is a transitive dep of @solana/web3.js; require it for the fixture.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const bs58 = require("bs58");
    const kp = Keypair.generate();
    const secret = (bs58.default ?? bs58).encode(kp.secretKey);
    const loaded = loadKeypairFromEnv({ AUTOMATION_KEYPAIR: secret });
    expect(loaded.publicKey.equals(kp.publicKey)).to.be.true;
  });

  it("throws when the secret env var is missing", () => {
    expect(() => loadKeypairFromEnv({})).to.throw(/AUTOMATION_KEYPAIR/);
  });

  it("throws when the secret env var is empty", () => {
    expect(() => loadKeypairFromEnv({ AUTOMATION_KEYPAIR: "   " })).to.throw(
      /empty|AUTOMATION_KEYPAIR/i
    );
  });

  it("throws on a malformed secret", () => {
    expect(() =>
      loadKeypairFromEnv({ AUTOMATION_KEYPAIR: "not-a-key" })
    ).to.throw();
  });

  it("never reads from a file path (security: secret comes only from env)", () => {
    // A path-looking value is treated as a (malformed) secret, not opened as a file.
    expect(() =>
      loadKeypairFromEnv({ AUTOMATION_KEYPAIR: "/etc/passwd" })
    ).to.throw();
  });
});

describe("loadConfig", () => {
  const base = {
    AUTOMATION_KEYPAIR: JSON.stringify(Array.from(Keypair.generate().secretKey)),
    RPC_URL: "https://api.devnet.solana.com",
    USDC_MINT: "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB",
  };

  it("parses a minimal valid config with the mock price source by default", () => {
    const cfg = loadConfig(base);
    expect(cfg.rpcUrl).to.equal("https://api.devnet.solana.com");
    expect(cfg.usdcMint.toBase58()).to.equal(base.USDC_MINT);
    expect(cfg.priceSourceKind).to.equal(PriceSourceKind.Mock);
    expect(cfg.keypair).to.be.instanceOf(Keypair);
  });

  it("selects the Pyth price source and parses feed ids", () => {
    const cfg = loadConfig({
      ...base,
      PRICE_SOURCE: "pyth",
      FEED_META: "0xmeta-feed",
      FEED_AAPL: "0xaapl-feed",
    });
    expect(cfg.priceSourceKind).to.equal(PriceSourceKind.Pyth);
    expect(cfg.feedIds[Ticker.Meta]).to.equal("0xmeta-feed");
    expect(cfg.feedIds[Ticker.Aapl]).to.equal("0xaapl-feed");
  });

  it("parses mock prices (dollar values) into the mock map", () => {
    const cfg = loadConfig({
      ...base,
      MOCK_CLOSE_META: "680",
      MOCK_CLOSE_AAPL: "214.5",
    });
    // $680 → 680_000_000 base units; $214.5 → 214_500000.
    expect(cfg.mockPrices[Ticker.Meta]?.toString()).to.equal("680000000");
    expect(cfg.mockPrices[Ticker.Aapl]?.toString()).to.equal("214500000");
  });

  it("defaults tickers to the full MAG7 set", () => {
    const cfg = loadConfig(base);
    expect(cfg.tickers).to.have.length(7);
  });

  it("restricts tickers when TICKERS is set", () => {
    const cfg = loadConfig({ ...base, TICKERS: "META,AAPL" });
    expect(cfg.tickers).to.deep.equal([Ticker.Meta, Ticker.Aapl]);
  });

  it("carries the alert webhook url through (optional)", () => {
    const cfg = loadConfig({ ...base, ALERT_WEBHOOK_URL: "https://hooks/x" });
    expect(cfg.alertWebhookUrl).to.equal("https://hooks/x");
  });

  it("throws on a missing RPC_URL", () => {
    const { RPC_URL, ...noRpc } = base;
    void RPC_URL;
    expect(() => loadConfig(noRpc)).to.throw(/RPC_URL/);
  });

  it("throws on a missing USDC_MINT", () => {
    const { USDC_MINT, ...noMint } = base;
    void USDC_MINT;
    expect(() => loadConfig(noMint)).to.throw(/USDC_MINT/);
  });

  it("throws on an invalid USDC_MINT pubkey", () => {
    expect(() => loadConfig({ ...base, USDC_MINT: "not-a-pubkey" })).to.throw();
  });
});
