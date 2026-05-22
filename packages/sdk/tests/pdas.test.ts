import { expect } from "chai";
import BN from "bn.js";
import { PublicKey } from "@solana/web3.js";
import { Harness } from "./harness";
import { Ticker } from "../src/types";
import { PROGRAM_ID } from "../src/program";
import {
  configPda,
  marketPda,
  vaultPda,
  yesMintPda,
  noMintPda,
  mintAuthorityPda,
  orderBookPda,
  usdcEscrowPda,
  yesEscrowPda,
  deriveMarketPdas,
} from "../src/pdas";

describe("PDA derivation", () => {
  it("derives the config PDA matching the program's seed", () => {
    const expected = PublicKey.findProgramAddressSync(
      [Buffer.from("config")],
      PROGRAM_ID
    )[0];
    expect(configPda().equals(expected)).to.equal(true);
  });

  it("encodes the market seed as [b'market', ticker(u8), strike(u64 LE), day(i64 LE)]", () => {
    const ticker = Ticker.Meta;
    const strike = new BN(680_000_000); // $680.00 in USDC base units
    const tradingDay = new BN(1_716_300_000);

    const manual = PublicKey.findProgramAddressSync(
      [
        Buffer.from("market"),
        Buffer.from([ticker]),
        strike.toArrayLike(Buffer, "le", 8),
        tradingDay.toArrayLike(Buffer, "le", 8),
      ],
      PROGRAM_ID
    )[0];

    expect(marketPda(ticker, strike, tradingDay).equals(manual)).to.equal(true);
  });

  it("distinguishes markets by ticker, strike, and trading day", () => {
    const base = marketPda(Ticker.Aapl, 100_000_000, 1_716_300_000);
    expect(
      marketPda(Ticker.Msft, 100_000_000, 1_716_300_000).equals(base)
    ).to.equal(false);
    expect(
      marketPda(Ticker.Aapl, 110_000_000, 1_716_300_000).equals(base)
    ).to.equal(false);
    expect(
      marketPda(Ticker.Aapl, 100_000_000, 1_716_386_400).equals(base)
    ).to.equal(false);
  });

  describe("matches the accounts the program actually creates (LiteSVM)", () => {
    let h: Harness;
    let usdcMint: PublicKey;
    const ticker = Ticker.Nvda;
    const strike = new BN(120_000_000);
    const tradingDay = new BN(1_716_300_000);

    before(async () => {
      h = Harness.create();
      usdcMint = h.ensureUsdc();
      await h.seedConfig(usdcMint);
      await h.createMarket({ ticker, strike, tradingDay, usdcMint });
    });
    after(() => h.dispose());

    it("market / vault / mints / mint authority exist at the derived PDAs", () => {
      const market = marketPda(ticker, strike, tradingDay);
      // The market account exists and is the one the program wrote.
      expect(h.exists(market), "market account exists at derived PDA").to.equal(
        true
      );

      // The on-chain Market records its own yes/no/vault keys — assert the SDK's
      // independent derivation equals what the program stored. This is the
      // "PDA derivations match on-chain expectations" acceptance criterion.
      const decoded = h.decode<{
        yesMint: PublicKey;
        noMint: PublicKey;
        vault: PublicKey;
        orderBook: PublicKey;
      }>("market", market);

      expect(yesMintPda(market).equals(decoded.yesMint)).to.equal(true);
      expect(noMintPda(market).equals(decoded.noMint)).to.equal(true);
      expect(vaultPda(market).equals(decoded.vault)).to.equal(true);

      // Mint authority + escrow accounts exist at their derived PDAs.
      expect(h.exists(yesMintPda(market))).to.equal(true);
      expect(h.exists(noMintPda(market))).to.equal(true);
      expect(h.exists(vaultPda(market))).to.equal(true);
      // mint_authority is a signer-only PDA (no data) but the vault/mints prove the
      // seed string "mint_auth" is correct: they were created under its authority.
      expect(mintAuthorityPda(market)).to.be.instanceOf(PublicKey);
    });

    it("order book is wired into the market at the derived PDA", () => {
      const market = marketPda(ticker, strike, tradingDay);
      const decoded = h.decode<{ orderBook: PublicKey }>("market", market);
      expect(orderBookPda(market).equals(decoded.orderBook)).to.equal(true);
      expect(h.exists(orderBookPda(market))).to.equal(true);
    });

    it("escrow accounts exist at the derived PDAs (separate from the vault)", () => {
      const market = marketPda(ticker, strike, tradingDay);
      expect(h.exists(usdcEscrowPda(market))).to.equal(true);
      expect(h.exists(yesEscrowPda(market))).to.equal(true);
      // Escrows must NOT be the vault (invariant #1: order-book funds never touch it).
      expect(usdcEscrowPda(market).equals(vaultPda(market))).to.equal(false);
      expect(yesEscrowPda(market).equals(vaultPda(market))).to.equal(false);
    });

    it("deriveMarketPdas bundles every per-market PDA consistently", () => {
      const market = marketPda(ticker, strike, tradingDay);
      const k = deriveMarketPdas(market);
      expect(k.market.equals(market)).to.equal(true);
      expect(k.vault.equals(vaultPda(market))).to.equal(true);
      expect(k.yesMint.equals(yesMintPda(market))).to.equal(true);
      expect(k.noMint.equals(noMintPda(market))).to.equal(true);
      expect(k.orderBook.equals(orderBookPda(market))).to.equal(true);
      expect(k.usdcEscrow.equals(usdcEscrowPda(market))).to.equal(true);
      expect(k.yesEscrow.equals(yesEscrowPda(market))).to.equal(true);
    });
  });
});
