//! `grow_order_book` — realloc the order book to full size and wire it (F-03).
//!
//! Second half of order-book creation (see `init_order_book` for why this is split):
//! the ~14.9 KB `OrderBook` exceeds Solana's 10,240-byte per-instruction data-increase
//! cap, and a PDA can't be created by a top-level `createAccount`, so we `init` it small
//! then `realloc` it here. The growth step (≈4.7 KB) is itself under the cap.
//!
//! On success this writes `Market.order_book`, which is the gate every trading
//! instruction checks (`market.order_book == order_book.key()`), so trading only
//! becomes possible once the book is at full size. Permissionless and single-shot:
//! a market whose book is already wired is rejected.

use crate::constants::ORDER_BOOK_SEED;
use crate::error::MeridianError;
use crate::state::{Market, OrderBook};
use anchor_lang::prelude::*;

#[derive(Accounts)]
pub struct GrowOrderBook<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(
        mut,
        seeds = [
            crate::constants::MARKET_SEED,
            &[market.ticker as u8],
            &market.strike.to_le_bytes(),
            &market.trading_day.to_le_bytes(),
        ],
        bump = market.bump,
        // Not yet wired → not yet grown. Rejects a second grow.
        constraint = market.order_book == Pubkey::default() @ MeridianError::AlreadyInitialized,
    )]
    pub market: Box<Account<'info, Market>>,

    /// The order book PDA, reallocated up to its full `8 + INIT_SPACE` size. `realloc`
    /// (vs `init`) keeps the existing data; `realloc::zero = false` is safe because the
    /// appended bytes are zeroed by the runtime and the borsh Vec length prefixes
    /// (already 0 from init) are untouched, so the book still deserializes as empty.
    #[account(
        mut,
        seeds = [ORDER_BOOK_SEED, market.key().as_ref()],
        bump = order_book.bump,
        constraint = order_book.market == market.key() @ MeridianError::InvalidArgument,
        realloc = 8 + OrderBook::INIT_SPACE,
        realloc::payer = payer,
        realloc::zero = false,
    )]
    pub order_book: Box<Account<'info, OrderBook>>,

    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<GrowOrderBook>) -> Result<()> {
    // Wire the market only now that the book is at full size — this is the flag the
    // trading instructions gate on.
    let order_book_key = ctx.accounts.order_book.key();
    ctx.accounts.market.order_book = order_book_key;

    emit!(crate::events::OrderBookInitialized {
        market: ctx.accounts.market.key(),
        order_book: order_book_key,
    });

    Ok(())
}
