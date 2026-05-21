//! Shared events for Meridian.
//!
//! F-01 declares the events emitted by the scaffold + `initialize_config`.
//! Later features add their own events here (e.g. `PairMinted`, `MarketSettled`,
//! `OrderPlaced`). Keeping them in one module gives the SDK (F-06) and any
//! indexer a single place to find the event schema.

use crate::state::Ticker;
use anchor_lang::prelude::*;

/// Emitted once when the global config is created.
#[event]
pub struct ConfigInitialized {
    pub admin: Pubkey,
    pub usdc_mint: Pubkey,
    pub fee_account: Option<Pubkey>,
}

/// Emitted when a stock-strike-day market is provisioned (F-02).
#[event]
pub struct MarketCreated {
    pub market: Pubkey,
    pub ticker: Ticker,
    pub strike: u64,
    pub trading_day: i64,
    pub yes_mint: Pubkey,
    pub no_mint: Pubkey,
}

/// Emitted when a user mints a Yes/No pair (F-02).
#[event]
pub struct PairMinted {
    pub market: Pubkey,
    pub user: Pubkey,
    /// Token base units of each side minted (== USDC base units deposited).
    pub amount: u64,
    pub pairs_minted: u64,
}

/// Emitted when a user redeems settled tokens (F-02).
#[event]
pub struct Redeemed {
    pub market: Pubkey,
    pub user: Pubkey,
    pub won: bool,
    pub tokens_burned: u64,
    pub usdc_paid: u64,
}
