//! Shared error codes for Meridian.
//!
//! Anchor v1 allows only ONE `#[error_code]` block per program, so every
//! feature's errors live in this single enum. F-01 declares the codes that
//! downstream features (F-02–F-05) will attach to logic; declaring them here
//! keeps a single source of truth and stable error numbers. Do not reorder
//! existing variants (their ordinal positions become the on-chain error codes);
//! append new variants at the end.

use anchor_lang::prelude::*;

#[error_code]
pub enum MeridianError {
    // --- Config / admin (F-01, F-05) ---
    #[msg("Config has already been initialized")]
    AlreadyInitialized,
    #[msg("Signer is not the configured admin")]
    Unauthorized,

    // --- Global / market lifecycle (F-02, F-03, F-04, F-05) ---
    #[msg("Program is paused")]
    MarketPaused,
    #[msg("Market is already settled")]
    MarketSettled,
    #[msg("Market is not settled yet")]
    MarketNotSettled,
    #[msg("Market with these parameters already exists")]
    MarketAlreadyExists,

    // --- Mint / redeem / vault (F-02) ---
    #[msg("Arithmetic overflow")]
    MathOverflow,
    #[msg("Insufficient token balance for this operation")]
    InsufficientBalance,
    #[msg("Vault collateralization invariant violated")]
    InvariantViolated,

    // --- Order book (F-03) ---
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

    // --- Settlement / oracle (F-04) ---
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
}
