//! `place_order` — post a limit/market order, crossing the book then resting.
//!
//! Flow (taker-crosses-on-placement, per the brief's "immediately sells Yes … one wallet
//! approval"):
//!   1. validate (size > 0, limit price in [0, PRICE_SCALE], not paused, market Open,
//!      book wired);
//!   2. cross the opposite side at maker price-time priority, settling token+USDC
//!      transfers atomically (see `crate::instructions::matching`);
//!   3. the remainder rests (limit) or is dropped with escrow refunded (market).
//!
//! Side semantics on the single Yes-vs-USDC book:
//!   - **Bid** = buy Yes: escrows USDC `ceil(price*size/PRICE_SCALE)`; on a fill, pays the
//!     resting ask's (maker) price and receives Yes.
//!   - **Ask** = sell Yes: escrows `size` Yes tokens; on a fill, delivers Yes and receives
//!     USDC at the resting bid's (maker) price.
//!
//! Escrow lives in the per-market `usdc_escrow` / `yes_escrow` accounts (NOT the
//! collateralization vault), so invariant #1 is untouched by trading.
//!
//! Maker payout accounts are supplied via `ctx.remaining_accounts` and verified in the
//! matching code against each resting order's recorded `owner` and the correct mint, so
//! the cranker/taker cannot misdirect funds or alter prices/sizes.

use crate::constants::{
    MINT_AUTH_SEED, ORDER_BOOK_SEED, PRICE_SCALE, USDC_ESCROW_SEED, YES_ESCROW_SEED, YES_MINT_SEED,
};
use crate::error::MeridianError;
use crate::instructions::matching;
use crate::state::{Config, Market, MarketState, Order, OrderBook, OrderSide};
use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct PlaceOrderArgs {
    pub side: OrderSide,
    /// Limit price in USDC-per-Yes at PRICE_SCALE. Ignored when `is_market`.
    pub price: u64,
    /// Order size in Yes-token base units.
    pub size: u64,
    /// Market order: cross at any price, fill-or-cancel the remainder (no rest).
    pub is_market: bool,
}

#[derive(Accounts)]
pub struct PlaceOrder<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(
        seeds = [crate::constants::CONFIG_SEED],
        bump = config.bump,
        constraint = !config.paused @ MeridianError::MarketPaused,
    )]
    pub config: Box<Account<'info, Config>>,

    #[account(
        seeds = [
            crate::constants::MARKET_SEED,
            &[market.ticker as u8],
            &market.strike.to_le_bytes(),
            &market.trading_day.to_le_bytes(),
        ],
        bump = market.bump,
        constraint = market.state == MarketState::Open @ MeridianError::MarketSettled,
        has_one = order_book @ MeridianError::InvalidArgument,
        has_one = yes_mint @ MeridianError::InvalidArgument,
    )]
    pub market: Box<Account<'info, Market>>,

    #[account(
        mut,
        seeds = [ORDER_BOOK_SEED, market.key().as_ref()],
        bump = order_book.bump,
    )]
    pub order_book: Box<Account<'info, OrderBook>>,

    /// CHECK: PDA authority for the escrow accounts; not deserialized.
    #[account(seeds = [MINT_AUTH_SEED, market.key().as_ref()], bump = market.mint_authority_bump)]
    pub mint_authority: UncheckedAccount<'info>,

    #[account(seeds = [YES_MINT_SEED, market.key().as_ref()], bump)]
    pub yes_mint: Box<Account<'info, Mint>>,

    #[account(mut, seeds = [USDC_ESCROW_SEED, market.key().as_ref()], bump)]
    pub usdc_escrow: Box<Account<'info, TokenAccount>>,
    #[account(mut, seeds = [YES_ESCROW_SEED, market.key().as_ref()], bump)]
    pub yes_escrow: Box<Account<'info, TokenAccount>>,

    /// Taker's USDC account (pays for buys, receives proceeds of sells).
    #[account(
        mut,
        constraint = user_usdc.mint == usdc_escrow.mint @ MeridianError::InvalidArgument,
        constraint = user_usdc.owner == user.key() @ MeridianError::InvalidArgument,
    )]
    pub user_usdc: Box<Account<'info, TokenAccount>>,

    /// Taker's Yes account (delivers Yes on sells, receives Yes on buys).
    #[account(
        mut,
        constraint = user_yes.mint == yes_mint.key() @ MeridianError::InvalidArgument,
        constraint = user_yes.owner == user.key() @ MeridianError::InvalidArgument,
    )]
    pub user_yes: Box<Account<'info, TokenAccount>>,

    pub token_program: Program<'info, Token>,
    // remaining_accounts: maker counterparty token accounts for any orders filled.
}

pub fn handler<'info>(
    mut ctx: Context<'info, PlaceOrder<'info>>,
    args: PlaceOrderArgs,
) -> Result<()> {
    require!(args.size > 0, MeridianError::InvalidOrderSize);
    if !args.is_market {
        // Limit price must be in [1, PRICE_SCALE]. A 0-price bid would escrow nothing yet
        // could acquire Yes for free from a market-sell taker and squat a book slot at no
        // cost; a 0-price ask is economically meaningless.
        require!(
            args.price > 0 && args.price <= PRICE_SCALE,
            MeridianError::PriceOutOfRange
        );
    }

    // --- 1. Cross the opposite side (taker-crosses-on-placement). ---
    let fill = matching::cross_incoming(&mut ctx, &args)?;
    let remaining = args
        .size
        .checked_sub(fill.filled_size)
        .ok_or(MeridianError::MathOverflow)?;

    // --- 2. Rest the remainder (limit) or drop it (market, fill-or-cancel). ---
    if remaining > 0 && !args.is_market {
        rest_remainder(&mut ctx, &args, remaining)?;
    }

    Ok(())
}

/// Escrow the taker's funds for the resting remainder and push the order.
fn rest_remainder<'info>(
    ctx: &mut Context<'info, PlaceOrder<'info>>,
    args: &PlaceOrderArgs,
    size: u64,
) -> Result<()> {
    let order_book = &ctx.accounts.order_book;
    // Capacity check before taking any funds.
    let side_len = match args.side {
        OrderSide::Bid => order_book.bids.len(),
        OrderSide::Ask => order_book.asks.len(),
    };
    require!(
        side_len < crate::constants::ORDERBOOK_N,
        MeridianError::BookFull
    );

    // Escrow: bid → USDC (ceil), ask → Yes (exact).
    match args.side {
        OrderSide::Bid => {
            let escrow_usdc = matching::bid_cost_ceil(args.price, size)?;
            token::transfer(
                CpiContext::new(
                    ctx.accounts.token_program.key(),
                    Transfer {
                        from: ctx.accounts.user_usdc.to_account_info(),
                        to: ctx.accounts.usdc_escrow.to_account_info(),
                        authority: ctx.accounts.user.to_account_info(),
                    },
                ),
                escrow_usdc,
            )?;
        }
        OrderSide::Ask => {
            token::transfer(
                CpiContext::new(
                    ctx.accounts.token_program.key(),
                    Transfer {
                        from: ctx.accounts.user_yes.to_account_info(),
                        to: ctx.accounts.yes_escrow.to_account_info(),
                        authority: ctx.accounts.user.to_account_info(),
                    },
                ),
                size,
            )?;
        }
    }

    // Assign a sequence number and insert in price-time order.
    let order_book = &mut ctx.accounts.order_book;
    let seq = order_book.next_seq;
    order_book.next_seq = seq.checked_add(1).ok_or(MeridianError::MathOverflow)?;
    let order = Order {
        owner: ctx.accounts.user.key(),
        price: args.price,
        size,
        seq,
        side: args.side,
        active: true,
    };
    matching::insert_sorted(order_book, order);

    emit!(crate::events::OrderPlaced {
        market: ctx.accounts.market.key(),
        owner: ctx.accounts.user.key(),
        side: args.side as u8,
        price: args.price,
        size,
        seq,
    });

    Ok(())
}
