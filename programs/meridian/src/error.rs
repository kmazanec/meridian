//! Shared error codes for Meridian.
//!
//! Anchor v1 allows only ONE `#[error_code]` block per program, so every
//! error in the program lives in this single enum. Declaring them all here
//! keeps a single source of truth and stable error numbers. Do not reorder
//! existing variants (their ordinal positions become the on-chain error codes);
//! append new variants at the end.

use anchor_lang::prelude::*;

#[error_code]
pub enum MeridianError {
    // --- Config / admin ---
    #[msg("Config has already been initialized")]
    AlreadyInitialized,
    #[msg("Signer is not the configured admin")]
    Unauthorized,

    // --- Global / market lifecycle ---
    #[msg("Program is paused")]
    MarketPaused,
    #[msg("Market is already settled")]
    MarketSettled,
    #[msg("Market is not settled yet")]
    MarketNotSettled,
    #[msg("Market with these parameters already exists")]
    MarketAlreadyExists,

    // --- Mint / redeem / vault ---
    #[msg("Arithmetic overflow")]
    MathOverflow,
    #[msg("Insufficient token balance for this operation")]
    InsufficientBalance,
    #[msg("Vault collateralization invariant violated")]
    InvariantViolated,

    // --- Order book ---
    #[msg("Order book is full")]
    BookFull,
    #[msg("Order not found")]
    OrderNotFound,
    #[msg("Order price out of range [0, PRICE_SCALE]")]
    PriceOutOfRange,
    #[msg("Order size must be greater than zero")]
    InvalidOrderSize,
    #[msg("Caller does not own this order")]
    NotOrderOwner,

    // --- Settlement / oracle ---
    #[msg("Too early to settle: before market close")]
    TooEarlyToSettle,
    #[msg("Too early for admin override: enforced delay not elapsed")]
    OverrideDelayNotElapsed,
    #[msg("Oracle price is stale")]
    StalePrice,
    #[msg("Oracle confidence band is too wide")]
    WideConfidence,
    #[msg("Oracle feed id does not match the configured feed for this ticker")]
    WrongFeed,

    // --- Generic validation ---
    #[msg("Invalid argument")]
    InvalidArgument,

    // --- Settlement / oracle (appended to preserve error-code ordinals) ---
    #[msg("Oracle price update is not the expected PriceUpdateV2 account")]
    InvalidPriceUpdateAccount,
    #[msg("Oracle price update is not fully verified (Full verification required)")]
    InsufficientVerification,
}
