import BN from "bn.js";
import { PublicKey } from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { PROGRAM_ID } from "./program";
import { Ticker } from "./types";

/**
 * PDA derivation — the frozen seed contract (program `constants.rs`).
 *
 * All PDAs are derived from the Meridian program id. The seed byte strings and
 * orderings here MUST match the program verbatim; a divergence silently produces a
 * different address and every instruction referencing it fails. These are pinned by
 * tests that compare each derivation to the account the program actually creates.
 *
 *   Config        : [b"config"]
 *   Market        : [b"market", ticker(u8), strike(u64 LE), trading_day(i64 LE)]
 *   OrderBook     : [b"order_book", market]
 *   Vault (USDC)  : [b"vault",      market]
 *   Mint authority: [b"mint_auth",  market]   ← note: "mint_auth", NOT "mint_authority"
 *   Yes mint      : [b"yes_mint",   market]
 *   No mint       : [b"no_mint",    market]
 *   USDC escrow   : [b"usdc_escrow", market]
 *   Yes escrow    : [b"yes_escrow",  market]
 */

// Seed byte strings, verbatim from constants.rs.
const CONFIG_SEED = Buffer.from("config");
const MARKET_SEED = Buffer.from("market");
const ORDER_BOOK_SEED = Buffer.from("order_book");
const VAULT_SEED = Buffer.from("vault");
const MINT_AUTH_SEED = Buffer.from("mint_auth");
const YES_MINT_SEED = Buffer.from("yes_mint");
const NO_MINT_SEED = Buffer.from("no_mint");
const USDC_ESCROW_SEED = Buffer.from("usdc_escrow");
const YES_ESCROW_SEED = Buffer.from("yes_escrow");

/** A `BN`, or anything `BN`'s constructor accepts (number, decimal string). */
export type BNLike = BN | number | string;

function toBN(value: BNLike): BN {
  return BN.isBN(value) ? value : new BN(value);
}

/** Encode a `u64` as 8 little-endian bytes (matches `u64::to_le_bytes`). */
function u64le(value: BNLike): Buffer {
  const bn = toBN(value);
  if (bn.isNeg()) {
    throw new Error(
      `u64 seed component must be non-negative: ${bn.toString()}`
    );
  }
  return bn.toArrayLike(Buffer, "le", 8);
}

/**
 * Encode an `i64` as 8 little-endian bytes (matches `i64::to_le_bytes`), including
 * two's-complement for negatives. `trading_day` is a unix timestamp, normally
 * positive, but the encoding is faithful to the program's `i64` type.
 */
function i64le(value: BNLike): Buffer {
  let bn = toBN(value);
  if (bn.isNeg()) {
    // Two's complement over 64 bits.
    bn = bn.toTwos(64);
  }
  return bn.toArrayLike(Buffer, "le", 8);
}

/** Derive the singleton config PDA. */
export function configPda(): PublicKey {
  return PublicKey.findProgramAddressSync([CONFIG_SEED], PROGRAM_ID)[0];
}

/**
 * Derive a market PDA from its identity (ticker, strike, trading day).
 *
 * @param ticker      the underlying (ordinal-encoded as a single byte)
 * @param strike      strike price in USDC base units (u64)
 * @param tradingDay  the 4:00 PM ET close instant, unix seconds (i64)
 */
export function marketPda(
  ticker: Ticker,
  strike: BNLike,
  tradingDay: BNLike
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [MARKET_SEED, Buffer.from([ticker]), u64le(strike), i64le(tradingDay)],
    PROGRAM_ID
  )[0];
}

// --- Per-market PDAs (all seeded by [seed, market.key()]). ---

function perMarket(seed: Buffer, market: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [seed, market.toBuffer()],
    PROGRAM_ID
  )[0];
}

export const orderBookPda = (market: PublicKey): PublicKey =>
  perMarket(ORDER_BOOK_SEED, market);
export const vaultPda = (market: PublicKey): PublicKey =>
  perMarket(VAULT_SEED, market);
export const mintAuthorityPda = (market: PublicKey): PublicKey =>
  perMarket(MINT_AUTH_SEED, market);
export const yesMintPda = (market: PublicKey): PublicKey =>
  perMarket(YES_MINT_SEED, market);
export const noMintPda = (market: PublicKey): PublicKey =>
  perMarket(NO_MINT_SEED, market);
export const usdcEscrowPda = (market: PublicKey): PublicKey =>
  perMarket(USDC_ESCROW_SEED, market);
export const yesEscrowPda = (market: PublicKey): PublicKey =>
  perMarket(YES_ESCROW_SEED, market);

/**
 * Every PDA bound to one market, derived in a single call. Convenient for builders
 * that need most of them (e.g. provisioning, trading).
 */
export interface MarketPdas {
  market: PublicKey;
  orderBook: PublicKey;
  vault: PublicKey;
  mintAuthority: PublicKey;
  yesMint: PublicKey;
  noMint: PublicKey;
  usdcEscrow: PublicKey;
  yesEscrow: PublicKey;
}

/** Derive all per-market PDAs for an already-known market address. */
export function deriveMarketPdas(market: PublicKey): MarketPdas {
  return {
    market,
    orderBook: orderBookPda(market),
    vault: vaultPda(market),
    mintAuthority: mintAuthorityPda(market),
    yesMint: yesMintPda(market),
    noMint: noMintPda(market),
    usdcEscrow: usdcEscrowPda(market),
    yesEscrow: yesEscrowPda(market),
  };
}

/** Derive all market PDAs from the market's identity (ticker/strike/day). */
export function deriveMarketPdasFromIdentity(
  ticker: Ticker,
  strike: BNLike,
  tradingDay: BNLike
): MarketPdas {
  return deriveMarketPdas(marketPda(ticker, strike, tradingDay));
}

// --- Associated token accounts (standard SPL ATA derivation). ---

/**
 * The associated token account for `owner` and `mint`. Used for user USDC / Yes / No
 * balances. `allowOwnerOffCurve` defaults to false (owners are normal wallets); pass
 * true only for a PDA owner.
 */
export function ata(
  mint: PublicKey,
  owner: PublicKey,
  allowOwnerOffCurve = false
): PublicKey {
  return getAssociatedTokenAddressSync(
    mint,
    owner,
    allowOwnerOffCurve,
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID
  );
}

/** The user's USDC / Yes / No ATAs for a market, in one call. */
export function userTokenAccounts(
  owner: PublicKey,
  usdcMint: PublicKey,
  yesMint: PublicKey,
  noMint: PublicKey
): { usdc: PublicKey; yes: PublicKey; no: PublicKey } {
  return {
    usdc: ata(usdcMint, owner),
    yes: ata(yesMint, owner),
    no: ata(noMint, owner),
  };
}
