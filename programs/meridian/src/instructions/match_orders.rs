//! `match_orders` — permissionless crank that settles crossed resting pairs (F-03).
//!
//! With taker-crosses-on-placement (`place_order`), the book is normally un-crossed, so
//! this is usually a no-op. It exists for **trustlessness and liveness** (ARCHITECTURE.md
//! §5): anyone — a counterparty or the automation service — can trigger settlement of any
//! bid/ask that cross, and the cranker can only *trigger* it. Trade price and size come
//! solely from the on-chain orders; the cranker cannot alter them or misdirect funds.
//!
//! For each matched (bid, ask) pair (best bid vs best ask), funds move entirely from the
//! escrow accounts (no signer needed from either party):
//!   - Yes: `yes_escrow` → the bid owner's Yes account   (bid owner bought Yes)
//!   - USDC: `usdc_escrow` → the ask owner's USDC account (ask owner sold Yes)
//!
//! **Trade price = the bid's price.** When the book is crossed (bid.price ≥ ask.price),
//! settling at the bid's price drains the bid's USDC escrow *exactly* (it escrowed
//! `ceil(bid.price * size)`), so no price-improvement surplus has to be refunded and no
//! third account is needed per fill — the seller simply receives at least their ask. This
//! is a deliberate simplification of a path that, under taker-crosses-on-placement, is a
//! defensive/liveness no-op in normal operation (placement already crosses the book, so
//! `match_orders` only ever finds a crossed pair in unusual orderings). It stays fully
//! trustless and conservative (no funds created; escrow conserved).
//!
//! `remaining_accounts` are consumed in pairs, in match order:
//!   [bid_owner_yes_account, ask_owner_usdc_account] per fill.
//! `max_fills` bounds the work per call (compute budget); call again to continue.

use crate::constants::{MINT_AUTH_SEED, ORDER_BOOK_SEED, USDC_ESCROW_SEED, YES_ESCROW_SEED};
use crate::error::MeridianError;
use crate::instructions::matching;
use crate::state::{Config, Market, MarketState, OrderBook};
use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct MatchOrdersArgs {
    /// Maximum number of fills to perform this call (compute-budget bound).
    pub max_fills: u8,
}

#[derive(Accounts)]
pub struct MatchOrders<'info> {
    /// Anyone may crank. Pays no funds; only triggers settlement.
    pub cranker: Signer<'info>,

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

    pub yes_mint: Box<Account<'info, Mint>>,

    #[account(mut, seeds = [USDC_ESCROW_SEED, market.key().as_ref()], bump)]
    pub usdc_escrow: Box<Account<'info, TokenAccount>>,
    #[account(mut, seeds = [YES_ESCROW_SEED, market.key().as_ref()], bump)]
    pub yes_escrow: Box<Account<'info, TokenAccount>>,

    pub token_program: Program<'info, Token>,
    // remaining_accounts: [bid_owner_yes, ask_owner_usdc] per fill, in match order.
}

/// A planned crank fill between a resting bid and a resting ask.
struct CrankFill {
    bid_index: usize,
    ask_index: usize,
    bid_owner: Pubkey,
    ask_owner: Pubkey,
    bid_seq: u64,
    ask_seq: u64,
    /// Trade price = the bid's price (see module docs).
    trade_price: u64,
    fill_size: u64,
    usdc_amount: u64,
}

pub fn handler<'info>(
    ctx: Context<'info, MatchOrders<'info>>,
    args: MatchOrdersArgs,
) -> Result<()> {
    // --- Phase 1: plan up to max_fills crossings (read-only). ---
    let book = &ctx.accounts.order_book;
    let mut plans: Vec<CrankFill> = Vec::new();

    // Working copies of the front-of-book remaining sizes as we plan.
    let mut bid_i = 0usize;
    let mut ask_i = 0usize;
    let mut bid_rem = book.bids.first().map(|o| o.size).unwrap_or(0);
    let mut ask_rem = book.asks.first().map(|o| o.size).unwrap_or(0);

    while plans.len() < args.max_fills as usize
        && bid_i < book.bids.len()
        && ask_i < book.asks.len()
    {
        let bid = &book.bids[bid_i];
        let ask = &book.asks[ask_i];
        // Best bid must meet/exceed best ask to cross.
        if bid.price < ask.price {
            break;
        }
        let fill_size = bid_rem.min(ask_rem);
        if fill_size == 0 {
            break;
        }
        // Settle at the bid's price (drains the bid's escrow exactly via telescoping).
        let trade_price = bid.price;
        let usdc_amount = matching::fill_usdc(trade_price, bid_rem, bid_rem - fill_size)?;

        plans.push(CrankFill {
            bid_index: bid_i,
            ask_index: ask_i,
            bid_owner: bid.owner,
            ask_owner: ask.owner,
            bid_seq: bid.seq,
            ask_seq: ask.seq,
            trade_price,
            fill_size,
            usdc_amount,
        });

        bid_rem -= fill_size;
        ask_rem -= fill_size;
        if bid_rem == 0 {
            bid_i += 1;
            bid_rem = book.bids.get(bid_i).map(|o| o.size).unwrap_or(0);
        }
        if ask_rem == 0 {
            ask_i += 1;
            ask_rem = book.asks.get(ask_i).map(|o| o.size).unwrap_or(0);
        }
    }

    if plans.is_empty() {
        return Ok(());
    }
    require!(
        ctx.remaining_accounts.len() >= plans.len() * 2,
        MeridianError::InvalidArgument
    );

    // --- Phase 2: settle each fill from escrow, verifying both owners' accounts. ---
    let market_key = ctx.accounts.market.key();
    let signer_seeds: &[&[&[u8]]] = &[&[
        MINT_AUTH_SEED,
        market_key.as_ref(),
        &[ctx.accounts.market.mint_authority_bump],
    ]];

    for (i, plan) in plans.iter().enumerate() {
        let bid_owner_yes = &ctx.remaining_accounts[i * 2];
        let ask_owner_usdc = &ctx.remaining_accounts[i * 2 + 1];

        let bid_ta = TokenAccount::try_deserialize(&mut &bid_owner_yes.data.borrow()[..])
            .map_err(|_| MeridianError::InvalidArgument)?;
        require_keys_eq!(bid_ta.owner, plan.bid_owner, MeridianError::NotOrderOwner);
        require_keys_eq!(bid_ta.mint, ctx.accounts.yes_mint.key(), MeridianError::InvalidArgument);

        let ask_ta = TokenAccount::try_deserialize(&mut &ask_owner_usdc.data.borrow()[..])
            .map_err(|_| MeridianError::InvalidArgument)?;
        require_keys_eq!(ask_ta.owner, plan.ask_owner, MeridianError::NotOrderOwner);
        require_keys_eq!(
            ask_ta.mint,
            ctx.accounts.usdc_escrow.mint,
            MeridianError::InvalidArgument
        );

        // Yes: yes_escrow → bid owner (bought Yes).
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.key(),
                Transfer {
                    from: ctx.accounts.yes_escrow.to_account_info(),
                    to: bid_owner_yes.clone(),
                    authority: ctx.accounts.mint_authority.to_account_info(),
                },
                signer_seeds,
            ),
            plan.fill_size,
        )?;
        // USDC: usdc_escrow → ask owner (sold Yes).
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.key(),
                Transfer {
                    from: ctx.accounts.usdc_escrow.to_account_info(),
                    to: ask_owner_usdc.clone(),
                    authority: ctx.accounts.mint_authority.to_account_info(),
                },
                signer_seeds,
            ),
            plan.usdc_amount,
        )?;

        // If the bid was filled at a price below what it escrowed (trade_price <
        // bid.price can't happen here since trade_price ∈ {bid,ask} and ask ≤ bid), any
        // surplus stays as escrow for the bid's remaining size or is returned on cancel.

        emit!(crate::events::OrderMatched {
            market: market_key,
            maker_seq: plan.bid_seq.min(plan.ask_seq),
            maker: if plan.bid_seq < plan.ask_seq { plan.bid_owner } else { plan.ask_owner },
            taker: ctx.accounts.cranker.key(),
            price: plan.trade_price,
            fill_size: plan.fill_size,
            usdc_amount: plan.usdc_amount,
        });
    }

    // --- Phase 3: apply size decrements / removals (back-to-front per side). ---
    apply_crank_fills(&mut ctx.accounts.order_book, &plans);

    Ok(())
}

fn apply_crank_fills(book: &mut OrderBook, plans: &[CrankFill]) {
    // Decrement remaining sizes first (by accumulated fill per index), then remove
    // emptied orders back-to-front so earlier indices stay valid.
    use std::collections::BTreeMap;
    let mut bid_fill: BTreeMap<usize, u64> = BTreeMap::new();
    let mut ask_fill: BTreeMap<usize, u64> = BTreeMap::new();
    for p in plans {
        *bid_fill.entry(p.bid_index).or_default() += p.fill_size;
        *ask_fill.entry(p.ask_index).or_default() += p.fill_size;
    }
    for (idx, amt) in &bid_fill {
        book.bids[*idx].size -= amt;
    }
    for (idx, amt) in &ask_fill {
        book.asks[*idx].size -= amt;
    }
    // Remove emptied (size == 0) back-to-front.
    for idx in bid_fill.keys().rev() {
        if book.bids[*idx].size == 0 {
            book.bids.remove(*idx);
        }
    }
    for idx in ask_fill.keys().rev() {
        if book.asks[*idx].size == 0 {
            book.asks.remove(*idx);
        }
    }
}
