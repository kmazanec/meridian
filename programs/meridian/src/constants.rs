//! Frozen contracts for Meridian.
//!
//! These values are a **cross-cutting contract** (see ROADMAP.md concerns #2 and #3).
//! Downstream features (F-02 mint/redeem, F-03 order book, F-04 settlement,
//! F-05 market creation, F-06 SDK) must consume these *verbatim*. Changing any of
//! them is a breaking change for the whole system.

use anchor_lang::prelude::*;

// ---------------------------------------------------------------------------
// Fixed-point / units contract (no floats anywhere — ROADMAP concern #2)
// ---------------------------------------------------------------------------

/// Decimals for the collateral token (USDC). USDC on Solana has 6 decimals,
/// so all monetary amounts are expressed in USDC base units.
#[constant]
pub const USDC_DECIMALS: u8 = 6;

/// Decimals for the Yes/No outcome tokens. We mirror USDC (6) so that token
/// base units map 1:1 to collateral base units: minting 1 pair deposits
/// `PAYOFF_UNIT` USDC base units and issues `PAYOFF_UNIT` of each token.
#[constant]
pub const TOKEN_DECIMALS: u8 = 6;

/// The number of base units that represent **$1.00**.
/// `1.00 USDC = 1_000_000` base units (because `10^6`).
/// A winning token redeems for exactly `PAYOFF_UNIT` USDC base units.
#[constant]
pub const PAYOFF_UNIT: u64 = 1_000_000;

/// Order prices are integers in USDC-per-Yes at 6-decimal scale.
/// The price domain is `[0, PRICE_SCALE]` i.e. `[$0.00, $1.00]`.
/// Example: a Yes price of $0.65 is `650_000`.
#[constant]
pub const PRICE_SCALE: u64 = 1_000_000;

// ---------------------------------------------------------------------------
// Order book sizing (ROADMAP concern #3 — frozen account shape)
// ---------------------------------------------------------------------------

/// Maximum number of resting orders **per side** (bids and asks each).
/// Sizes the `OrderBook` account up-front. Tunable in production, but frozen
/// for this build so downstream features can rely on the account size.
pub const ORDERBOOK_N: usize = 128;

/// Number of supported underlying tickers (the MAG7).
pub const NUM_TICKERS: usize = 7;

// ---------------------------------------------------------------------------
// PDA seed prefixes (ROADMAP concern #3 — frozen derivation contract)
// ---------------------------------------------------------------------------
//
// Derivation contract (all PDAs are derived from the Meridian program id):
//   Config        : [CONFIG_SEED]
//   Market        : [MARKET_SEED, ticker_index (u8), strike (u64 LE), trading_day (i64 LE)]
//   OrderBook     : [ORDER_BOOK_SEED, market.key()]
//   Vault (USDC)  : [VAULT_SEED, market.key()]
//   Mint authority: [MINT_AUTH_SEED, market.key()]
//   Yes mint      : [YES_MINT_SEED, market.key()]
//   No mint       : [NO_MINT_SEED, market.key()]
//
// Downstream features MUST use these exact byte strings and seed orderings.

/// Singleton global config PDA seed.
pub const CONFIG_SEED: &[u8] = b"config";
/// Per stock-strike-day market PDA seed.
pub const MARKET_SEED: &[u8] = b"market";
/// Per-market order book PDA seed.
pub const ORDER_BOOK_SEED: &[u8] = b"order_book";
/// Per-market USDC collateral vault PDA seed.
pub const VAULT_SEED: &[u8] = b"vault";
/// Per-market mint authority PDA seed (authority over the Yes/No mints).
pub const MINT_AUTH_SEED: &[u8] = b"mint_auth";
/// Per-market Yes mint PDA seed.
pub const YES_MINT_SEED: &[u8] = b"yes_mint";
/// Per-market No mint PDA seed.
pub const NO_MINT_SEED: &[u8] = b"no_mint";
