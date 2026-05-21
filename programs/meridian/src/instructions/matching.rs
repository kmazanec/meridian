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
//!
//! So the best order on each side is always index 0, and price-time priority is a simple
//! front-to-back scan.

use crate::constants::MINT_AUTH_SEED;
use crate::error::MeridianError;
use crate::state::{Order, OrderBook, OrderSide};
use anchor_lang::prelude::*;
use anchor_spl::token::{self, Transfer};

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

/// USDC moved when a resting order at `price` shrinks from `s_before` to `s_after` Yes.
///
/// Defined as `ceil(price*s_before) - ceil(price*s_after)` so that, over *any* sequence
/// of partial fills, the amounts telescope to exactly `ceil(price*original_size)` — which
/// is precisely what a bid escrows (`bid_cost_ceil`). This makes escrow accounting exact
/// with **zero dust** and needs no per-order escrow field (the frozen `Order` has none):
/// the amount depends only on the on-chain before/after sizes. Used for both taker
/// directions so a buy and a sell at the same maker price move identical USDC.
pub fn fill_usdc(price: u64, s_before: u64, s_after: u64) -> Result<u64> {
    debug_assert!(s_after <= s_before);
    let before = bid_cost_ceil(price, s_before)?;
    let after = bid_cost_ceil(price, s_after)?;
    before
        .checked_sub(after)
        .ok_or(MeridianError::MathOverflow.into())
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

/// Validate a maker payout account supplied via `remaining_accounts` and return its
/// deserialized token-account view. Enforces the full trust boundary:
///   - the account is *owned by the SPL Token program* (so `try_deserialize` of raw bytes
///     can't be spoofed by a crafted non-token account — H-1);
///   - it is writable (clear error vs. a generic privilege failure — L-1);
///   - it is not frozen (a frozen payout account would revert the whole batch — M-1);
///   - its token-`owner` is the recorded order owner (no fund misdirection);
///   - its mint is `expected_mint` (right asset).
pub(crate) fn verify_maker_account(
    maker_acct: &AccountInfo,
    token_program_id: &Pubkey,
    expected_owner: &Pubkey,
    expected_mint: &Pubkey,
) -> Result<()> {
    require_keys_eq!(
        *maker_acct.owner,
        *token_program_id,
        MeridianError::InvalidArgument
    );
    require!(maker_acct.is_writable, MeridianError::InvalidArgument);
    let ta = anchor_spl::token::TokenAccount::try_deserialize(&mut &maker_acct.data.borrow()[..])
        .map_err(|_| MeridianError::InvalidArgument)?;
    require!(
        ta.state == anchor_spl::token::spl_token::state::AccountState::Initialized,
        MeridianError::InvalidArgument
    );
    require_keys_eq!(ta.owner, *expected_owner, MeridianError::NotOrderOwner);
    require_keys_eq!(ta.mint, *expected_mint, MeridianError::InvalidArgument);
    Ok(())
}

/// Does an incoming order at `price` (taker) cross a resting order at `maker_price`?
/// For a taker **Bid** (buying Yes), it crosses asks priced ≤ the taker's limit.
/// For a taker **Ask** (selling Yes), it crosses bids priced ≥ the taker's limit.
/// Market orders cross at any price.
fn crosses(taker_side: OrderSide, taker_price: u64, maker_price: u64, is_market: bool) -> bool {
    if is_market {
        return true;
    }
    match taker_side {
        OrderSide::Bid => maker_price <= taker_price,
        OrderSide::Ask => maker_price >= taker_price,
    }
}

/// One planned fill against a specific resting maker order.
struct PlannedFill {
    /// Index of the maker order on its side (front-to-back == price-time order).
    maker_index: usize,
    maker_owner: Pubkey,
    maker_seq: u64,
    maker_price: u64,
    fill_size: u64,
    usdc_amount: u64,
    /// Maker order fully consumed by this fill (→ remove from the book).
    maker_emptied: bool,
}

/// Cross an incoming order against the resting opposite side, settling token+USDC
/// transfers atomically (taker-crosses-on-placement). Returns the taker's totals.
///
/// Trustless: trade price and size come only from the on-chain resting `Order`s; the
/// caller supplies maker payout accounts via `remaining_accounts`, each verified against
/// the matched order's `owner` and the correct mint before any transfer. The cranker
/// cannot alter prices, sizes, or redirect funds.
///
/// `remaining_accounts` must list, in fill order (best price/time first), the receiving
/// token account of each maker touched:
///   - taker **Bid** (buys Yes) crosses **asks**: each maker (seller) receives **USDC**.
///   - taker **Ask** (sells Yes) crosses **bids**: each maker (buyer) receives **Yes**.
pub fn cross_incoming<'info>(
    ctx: &mut Context<'info, super::place_order::PlaceOrder<'info>>,
    args: &super::place_order::PlaceOrderArgs,
) -> Result<FillResult> {
    let book = &ctx.accounts.order_book;
    let taker_side = args.side;

    // --- Phase 1: plan the fills (read-only over the book). ---
    let resting = match taker_side {
        OrderSide::Bid => &book.asks, // taker buys Yes ← resting asks
        OrderSide::Ask => &book.bids, // taker sells Yes ← resting bids
    };

    let mut plans: Vec<PlannedFill> = Vec::new();
    let mut remaining = args.size;
    for (idx, maker) in resting.iter().enumerate() {
        if remaining == 0 {
            break;
        }
        if !maker.active {
            continue;
        }
        if !crosses(taker_side, args.price, maker.price, args.is_market) {
            break; // sorted: once one doesn't cross, none after it do
        }
        let fill_size = remaining.min(maker.size);
        // Trade settles at the MAKER's resting price (price-time priority). USDC moved
        // telescopes via ceil-before − ceil-after, so escrow stays exact (no dust).
        let s_after = maker.size - fill_size;
        let usdc_amount = fill_usdc(maker.price, maker.size, s_after)?;
        plans.push(PlannedFill {
            maker_index: idx,
            maker_owner: maker.owner,
            maker_seq: maker.seq,
            maker_price: maker.price,
            fill_size,
            usdc_amount,
            maker_emptied: fill_size == maker.size,
        });
        remaining -= fill_size;
    }

    if plans.is_empty() {
        return Ok(FillResult::default());
    }
    require!(
        ctx.remaining_accounts.len() >= plans.len(),
        MeridianError::InvalidArgument
    );

    // --- Phase 2: settle transfers (CPIs), verifying each maker account. ---
    let market_key = ctx.accounts.market.key();
    let signer_seeds: &[&[&[u8]]] = &[&[
        MINT_AUTH_SEED,
        market_key.as_ref(),
        &[ctx.accounts.market.mint_authority_bump],
    ]];

    let mut filled_size: u64 = 0;
    let mut usdc_total: u64 = 0;

    let token_program_id = ctx.accounts.token_program.key();
    for (i, plan) in plans.iter().enumerate() {
        let maker_acct = &ctx.remaining_accounts[i];

        match taker_side {
            OrderSide::Bid => {
                // Taker buys Yes: pay maker USDC (taker → maker), deliver Yes to taker
                // (yes_escrow → taker, PDA-signed). Maker (seller) receives USDC.
                verify_maker_account(
                    maker_acct,
                    &token_program_id,
                    &plan.maker_owner,
                    &ctx.accounts.usdc_escrow.mint,
                )?;
                token::transfer(
                    CpiContext::new(
                        ctx.accounts.token_program.key(),
                        Transfer {
                            from: ctx.accounts.user_usdc.to_account_info(),
                            to: maker_acct.clone(),
                            authority: ctx.accounts.user.to_account_info(),
                        },
                    ),
                    plan.usdc_amount,
                )?;
                token::transfer(
                    CpiContext::new_with_signer(
                        ctx.accounts.token_program.key(),
                        Transfer {
                            from: ctx.accounts.yes_escrow.to_account_info(),
                            to: ctx.accounts.user_yes.to_account_info(),
                            authority: ctx.accounts.mint_authority.to_account_info(),
                        },
                        signer_seeds,
                    ),
                    plan.fill_size,
                )?;
            }
            OrderSide::Ask => {
                // Taker sells Yes: deliver Yes to maker (taker → maker), pay taker USDC
                // (usdc_escrow → taker, PDA-signed). Maker (buyer) receives Yes.
                verify_maker_account(
                    maker_acct,
                    &token_program_id,
                    &plan.maker_owner,
                    &ctx.accounts.yes_mint.key(),
                )?;
                token::transfer(
                    CpiContext::new(
                        ctx.accounts.token_program.key(),
                        Transfer {
                            from: ctx.accounts.user_yes.to_account_info(),
                            to: maker_acct.clone(),
                            authority: ctx.accounts.user.to_account_info(),
                        },
                    ),
                    plan.fill_size,
                )?;
                token::transfer(
                    CpiContext::new_with_signer(
                        ctx.accounts.token_program.key(),
                        Transfer {
                            from: ctx.accounts.usdc_escrow.to_account_info(),
                            to: ctx.accounts.user_usdc.to_account_info(),
                            authority: ctx.accounts.mint_authority.to_account_info(),
                        },
                        signer_seeds,
                    ),
                    plan.usdc_amount,
                )?;
            }
        }

        filled_size = filled_size
            .checked_add(plan.fill_size)
            .ok_or(MeridianError::MathOverflow)?;
        usdc_total = usdc_total
            .checked_add(plan.usdc_amount)
            .ok_or(MeridianError::MathOverflow)?;

        emit!(crate::events::OrderMatched {
            market: market_key,
            maker_seq: plan.maker_seq,
            maker: plan.maker_owner,
            taker: ctx.accounts.user.key(),
            price: plan.maker_price,
            fill_size: plan.fill_size,
            usdc_amount: plan.usdc_amount,
        });
    }

    // --- Phase 3: apply the size decrements / removals to the book. ---
    apply_fills(&mut ctx.accounts.order_book, taker_side, &plans);

    Ok(FillResult {
        filled_size,
        usdc_total,
    })
}

/// Apply planned fills to the book: decrement partially-filled makers, remove emptied
/// ones. Removing back-to-front preserves the indices of not-yet-processed entries.
fn apply_fills(book: &mut OrderBook, taker_side: OrderSide, plans: &[PlannedFill]) {
    let side = match taker_side {
        OrderSide::Bid => &mut book.asks,
        OrderSide::Ask => &mut book.bids,
    };
    for plan in plans.iter().rev() {
        if plan.maker_emptied {
            side.remove(plan.maker_index);
        } else {
            side[plan.maker_index].size -= plan.fill_size;
        }
    }
}
