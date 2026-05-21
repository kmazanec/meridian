//! Shared order-book matching engine (F-03).
//!
//! Pure helpers (`bid_cost_ceil`, `insert_sorted`, ordering predicates) plus the
//! `cross_incoming` routine used by `place_order` (taker crosses on placement). The
//! `match_orders` crank (Chunk 5) reuses the same fill primitives so price-time priority
//! and settlement are defined in exactly one place.
//!
//! Ordering contract:
//!   - **bids** are kept sorted by price **descending**, ties by `seq` **ascending**
//!     (best bid first);
//!   - **asks** are kept sorted by price **ascending**, ties by `seq` **ascending**
//!     (best ask first).
//! So the best order on each side is always index 0, and price-time priority is a simple
//! front-to-back scan.

use crate::error::MeridianError;
use crate::state::{Order, OrderBook, OrderSide};
use anchor_lang::prelude::*;

/// Result of crossing an incoming order against the resting book.
#[derive(Default, Clone, Copy, Debug)]
pub struct FillResult {
    /// Total Yes-token base units filled for the taker.
    pub filled_size: u64,
    /// Total USDC base units the taker paid (buys) or received (sells).
    pub usdc_total: u64,
}

/// Worst-case USDC cost of a bid for `size` Yes at `price`, rounded **up** so the
/// escrow always covers the trade. `price` is USDC-per-Yes at PRICE_SCALE.
pub fn bid_cost_ceil(price: u64, size: u64) -> Result<u64> {
    let scale = crate::constants::PRICE_SCALE as u128;
    let numer = (price as u128)
        .checked_mul(size as u128)
        .ok_or(MeridianError::MathOverflow)?;
    // ceil(numer / scale)
    let cost = numer
        .checked_add(scale - 1)
        .ok_or(MeridianError::MathOverflow)?
        / scale;
    u64::try_from(cost).map_err(|_| MeridianError::MathOverflow.into())
}

/// Actual USDC cost of a fill at the maker's price for `size` Yes, rounded **down**
/// (the buyer never pays more than the truncated product; the ceil-escrow covers it and
/// the difference is refunded).
pub fn fill_cost_floor(price: u64, size: u64) -> Result<u64> {
    let scale = crate::constants::PRICE_SCALE as u128;
    let numer = (price as u128)
        .checked_mul(size as u128)
        .ok_or(MeridianError::MathOverflow)?;
    u64::try_from(numer / scale).map_err(|_| MeridianError::MathOverflow.into())
}

/// Insert an order keeping the side sorted by price-time priority.
pub fn insert_sorted(book: &mut OrderBook, order: Order) {
    match order.side {
        OrderSide::Bid => {
            // price desc, then seq asc
            let pos = book
                .bids
                .iter()
                .position(|o| {
                    order.price > o.price || (order.price == o.price && order.seq < o.seq)
                })
                .unwrap_or(book.bids.len());
            book.bids.insert(pos, order);
        }
        OrderSide::Ask => {
            // price asc, then seq asc
            let pos = book
                .asks
                .iter()
                .position(|o| {
                    order.price < o.price || (order.price == o.price && order.seq < o.seq)
                })
                .unwrap_or(book.asks.len());
            book.asks.insert(pos, order);
        }
    }
}

/// Cross an incoming order against the resting opposite side.
///
/// Chunk 2 stub: no crossing yet (returns an empty fill), so a non-crossing limit order
/// rests as-is. Chunk 3 implements taker-crosses-on-placement here, settling transfers
/// via `ctx.remaining_accounts`.
pub fn cross_incoming<'info>(
    _ctx: &Context<'info, super::place_order::PlaceOrder<'info>>,
    _args: &super::place_order::PlaceOrderArgs,
) -> Result<FillResult> {
    Ok(FillResult::default())
}
