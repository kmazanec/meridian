//! Shared events for Meridian.
//!
//! F-01 declares the events emitted by the scaffold + `initialize_config`.
//! Later features add their own events here (e.g. `PairMinted`, `MarketSettled`,
//! `OrderPlaced`). Keeping them in one module gives the SDK (F-06) and any
//! indexer a single place to find the event schema.

use anchor_lang::prelude::*;

/// Emitted once when the global config is created.
#[event]
pub struct ConfigInitialized {
    pub admin: Pubkey,
    pub usdc_mint: Pubkey,
    pub fee_account: Option<Pubkey>,
}
