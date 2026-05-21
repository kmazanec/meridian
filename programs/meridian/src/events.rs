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

// --- Order book (F-03) ---

/// Emitted when the order book + escrow accounts are created for a market.
#[event]
pub struct OrderBookInitialized {
    pub market: Pubkey,
    pub order_book: Pubkey,
}

/// Emitted when an order (or the unfilled remainder of one) comes to rest.
#[event]
pub struct OrderPlaced {
    pub market: Pubkey,
    pub owner: Pubkey,
    /// 0 = Bid (buy Yes), 1 = Ask (sell Yes) — mirrors `OrderSide`'s ordinal.
    pub side: u8,
    pub price: u64,
    /// Remaining size that came to rest (post any immediate fills).
    pub size: u64,
    pub seq: u64,
}

/// Emitted for each maker order touched by a fill (taker placement or crank).
#[event]
pub struct OrderMatched {
    pub market: Pubkey,
    /// The resting (maker) order's sequence number.
    pub maker_seq: u64,
    pub maker: Pubkey,
    pub taker: Pubkey,
    /// Trade price (the maker's resting price), USDC-per-Yes at PRICE_SCALE.
    pub price: u64,
    /// Yes-token base units exchanged in this fill.
    pub fill_size: u64,
    /// USDC base units exchanged in this fill.
    pub usdc_amount: u64,
}

/// Emitted when a resting order is cancelled and its escrow returned.
#[event]
pub struct OrderCancelled {
    pub market: Pubkey,
    pub owner: Pubkey,
    pub seq: u64,
    /// Escrow returned to the owner (USDC for a bid, Yes tokens for an ask).
    pub refunded: u64,
}
