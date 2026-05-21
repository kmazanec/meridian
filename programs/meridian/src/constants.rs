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
// Settlement & oracle parameters (F-04)
// ---------------------------------------------------------------------------
//
// Timing contract: `Market.trading_day` is the unix timestamp of the market's
// 4:00 PM ET close instant (the off-chain automation, which owns the DST-aware
// market calendar per ADR-005, computes it). On-chain settlement timing is then a
// single integer comparison — the program never reimplements a timezone calendar.

/// Delay after close before the admin override (`admin_settle`) becomes callable.
/// 1 hour (ADR-004/§7.5): long enough that the permissionless `settle_market`
/// path is the default, short enough that a stuck market still settles same-day.
pub const ADMIN_OVERRIDE_DELAY: i64 = 60 * 60;

/// Maximum age (seconds) of a Pyth price update accepted by `settle_market`.
/// Equity feeds update during market hours; settlement fires right after close,
/// so a tight window rejects a stale post-close snapshot. (ARCHITECTURE §7.6.)
pub const DEFAULT_MAX_STALENESS: i64 = 120;

/// Maximum acceptable oracle confidence band, in basis points of the price
/// (`conf / price <= MAX_CONFIDENCE_BPS / 10_000`). 100 bps = 1%. Wider bands are
/// rejected (`WideConfidence`) so a near-strike outcome isn't decided on noise.
pub const MAX_CONFIDENCE_BPS: u64 = 100;

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
//   USDC escrow   : [USDC_ESCROW_SEED, market.key()]   (order-book bid escrow — added in F-03)
//   Yes escrow    : [YES_ESCROW_SEED, market.key()]    (order-book ask escrow — added in F-03)
//
// Downstream features MUST use these exact byte strings and seed orderings.
//
// NOTE (F-03 contract addition): the two escrow seeds below were NOT anticipated
// by F-01. The order book needs token accounts to hold bidders' USDC and askers'
// Yes tokens *separately from the collateralization vault* (invariant #1 requires
// the vault to equal PAYOFF_UNIT * pairs_minted - winning_redeemed exactly, so it
// must never hold order-book funds). These seeds are the source of truth and are
// mirrored in ROADMAP.md concern #3 so F-06 (SDK) derives them identically.

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
/// Per-market order-book USDC escrow token account PDA seed (holds bidders'
/// escrowed USDC while buy-Yes orders rest). Added in F-03; distinct from the
/// collateralization vault so it never affects invariant #1.
pub const USDC_ESCROW_SEED: &[u8] = b"usdc_escrow";
/// Per-market order-book Yes escrow token account PDA seed (holds askers'
/// escrowed Yes tokens while sell-Yes orders rest). Added in F-03.
pub const YES_ESCROW_SEED: &[u8] = b"yes_escrow";
