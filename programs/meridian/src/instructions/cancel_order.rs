//! `cancel_order` — remove a caller's resting order and return its escrow (F-03).
//!
//! Finds the caller's own resting order by `(side, seq)`, refunds its full remaining
//! escrow (a bid escrowed `ceil(price*remaining)` USDC; an ask escrowed `remaining` Yes
//! tokens — both reconstructable from the on-chain order, since `fill_usdc` keeps a bid's
//! escrow exactly `ceil(price*remaining)` at all times), and removes the slot.
//!
//! Only the order's `owner` may cancel it (`NotOrderOwner`); a missing order is
//! `OrderNotFound`. Refunds are PDA-signed from the per-market escrow accounts, never the
//! collateralization vault, so invariant #1 is untouched. Allowed even when paused (a
//! user must always be able to reclaim their own escrowed funds); rejected only if the
//! market is settled is *not* enforced — cancelling/refunding after settlement is still
//! safe and desirable, so no state gate is applied here.

use crate::constants::{MINT_AUTH_SEED, ORDER_BOOK_SEED, USDC_ESCROW_SEED, YES_ESCROW_SEED};
use crate::error::MeridianError;
use crate::instructions::matching;
use crate::state::{Market, OrderBook, OrderSide};
use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct CancelOrderArgs {
    pub side: OrderSide,
    pub seq: u64,
}

#[derive(Accounts)]
pub struct CancelOrder<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(
        seeds = [
            crate::constants::MARKET_SEED,
            &[market.ticker as u8],
            &market.strike.to_le_bytes(),
            &market.trading_day.to_le_bytes(),
        ],
        bump = market.bump,
        has_one = order_book @ MeridianError::InvalidArgument,
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

    #[account(mut, seeds = [USDC_ESCROW_SEED, market.key().as_ref()], bump)]
    pub usdc_escrow: Box<Account<'info, TokenAccount>>,
    #[account(mut, seeds = [YES_ESCROW_SEED, market.key().as_ref()], bump)]
    pub yes_escrow: Box<Account<'info, TokenAccount>>,

    /// The caller's account that receives the refund: USDC for a bid, Yes for an ask.
    /// Ownership is checked in the handler against the chosen side's mint.
    #[account(
        mut,
        constraint = refund_to.owner == user.key() @ MeridianError::NotOrderOwner,
    )]
    pub refund_to: Box<Account<'info, TokenAccount>>,

    pub token_program: Program<'info, Token>,
}

pub fn handler(ctx: Context<CancelOrder>, args: CancelOrderArgs) -> Result<()> {
    // Locate the caller's order on the chosen side.
    let book = &ctx.accounts.order_book;
    let side_vec = match args.side {
        OrderSide::Bid => &book.bids,
        OrderSide::Ask => &book.asks,
    };
    let pos = side_vec
        .iter()
        .position(|o| o.seq == args.seq && o.active)
        .ok_or(MeridianError::OrderNotFound)?;
    let order = side_vec[pos];

    // Only the owner may cancel.
    require_keys_eq!(order.owner, ctx.accounts.user.key(), MeridianError::NotOrderOwner);

    // Compute and pay the refund from the matching escrow, PDA-signed.
    let market_key = ctx.accounts.market.key();
    let signer_seeds: &[&[&[u8]]] = &[&[
        MINT_AUTH_SEED,
        market_key.as_ref(),
        &[ctx.accounts.market.mint_authority_bump],
    ]];

    let (refund, escrow_ai) = match args.side {
        OrderSide::Bid => {
            // Bid escrow is exactly ceil(price * remaining) (invariant of fill_usdc).
            require_keys_eq!(
                ctx.accounts.refund_to.mint,
                ctx.accounts.usdc_escrow.mint,
                MeridianError::InvalidArgument
            );
            (
                matching::bid_cost_ceil(order.price, order.size)?,
                ctx.accounts.usdc_escrow.to_account_info(),
            )
        }
        OrderSide::Ask => {
            // Ask escrow is exactly `remaining` Yes tokens.
            require_keys_eq!(
                ctx.accounts.refund_to.mint,
                ctx.accounts.yes_escrow.mint,
                MeridianError::InvalidArgument
            );
            (order.size, ctx.accounts.yes_escrow.to_account_info())
        }
    };

    if refund > 0 {
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.key(),
                Transfer {
                    from: escrow_ai,
                    to: ctx.accounts.refund_to.to_account_info(),
                    authority: ctx.accounts.mint_authority.to_account_info(),
                },
                signer_seeds,
            ),
            refund,
        )?;
    }

    // Remove the order from the book.
    let book = &mut ctx.accounts.order_book;
    match args.side {
        OrderSide::Bid => {
            book.bids.remove(pos);
        }
        OrderSide::Ask => {
            book.asks.remove(pos);
        }
    }

    emit!(crate::events::OrderCancelled {
        market: market_key,
        owner: ctx.accounts.user.key(),
        seq: args.seq,
        refunded: refund,
    });

    Ok(())
}
