//! `init_order_book` — create and wire the order book for a market (F-03).
//!
//! F-02's `create_strike_market` provisions the `Market`, the Yes/No mints, and the
//! collateralization vault, but leaves `Market.order_book = Pubkey::default()` for
//! F-03 to fill. This instruction creates the bounded `OrderBook` account plus the
//! two order-book escrow token accounts (USDC for resting bids, Yes for resting
//! asks) and writes `Market.order_book`, after which trading is possible.
//!
//! Why the escrow accounts are NOT the vault: invariant #1 (ARCH §7.1, brief p10)
//! requires `vault == PAYOFF_UNIT * pairs_minted - winning_redeemed` *exactly*. If
//! order-book funds lived in the vault, that equality would break on every resting
//! order. So the book gets its own escrow accounts, owned by the same per-market
//! `mint_authority` PDA that already signs for the vault and mints (no new key).
//!
//! Permissioning: permissionless. The account is created once; the `init` constraint
//! plus the `Market.order_book == default` guard make a second call fail, so anyone
//! can ensure the book exists without being able to create a duplicate or rebind it.
//!
//! **Two-step creation (Solana realloc cap).** The `OrderBook` is ~14.9 KB (128 bids +
//! 128 asks at 58 B each — sizes frozen by F-01). Solana caps account-data growth at
//! `MAX_PERMITTED_DATA_INCREASE` = 10,240 bytes **per instruction**, and a PDA can only
//! be created via an `init`/`realloc` CPI (it has no key to sign a top-level
//! `createAccount`), so the full size cannot be allocated in one instruction. F-01's
//! handoff note assumed `init` would pre-allocate the whole budget in one shot; that
//! assumption is wrong on Solana. We therefore split creation:
//!   1. `init_order_book` — `init` the PDA at `INIT_ALLOC` (≤ 10 KB) + both escrow
//!      accounts; sets the book's fields. Leaves `Market.order_book` UNSET so trading
//!      can't begin against a half-sized book.
//!   2. `grow_order_book` — `realloc` the PDA up to the full `8 + INIT_SPACE`, top up
//!      rent, then wire `Market.order_book`. Trading instructions require
//!      `market.order_book == order_book.key()`, so they only succeed after this step.
//!
//! Both the frozen PDA seed (`[order_book, market]`) and the frozen `ORDERBOOK_N = 128`
//! are preserved; only the *creation mechanism* differs from F-01's note.

use crate::constants::{
    MINT_AUTH_SEED, ORDER_BOOK_SEED, USDC_ESCROW_SEED, YES_ESCROW_SEED, YES_MINT_SEED,
};
use crate::error::MeridianError;
use crate::state::{Market, OrderBook};
use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, Token, TokenAccount};

/// Initial allocation for the order book PDA, kept at/under Solana's 10,240-byte
/// per-instruction data-increase cap. `grow_order_book` reallocs to the full size.
/// An empty book serializes to far less than this, so all fields fit immediately.
pub const ORDER_BOOK_INIT_ALLOC: usize = 8 + 10_000;

#[derive(Accounts)]
pub struct InitOrderBook<'info> {
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
        // Single-wire guard: a market whose book is already wired cannot be
        // re-initialized. (The `init` on `order_book` also fails on the second call.)
        constraint = market.order_book == Pubkey::default() @ MeridianError::AlreadyInitialized,
        has_one = yes_mint @ MeridianError::InvalidArgument,
        has_one = vault @ MeridianError::InvalidArgument,
    )]
    pub market: Box<Account<'info, Market>>,

    /// The bounded on-chain order book for this market. Allocated at `INIT_ALLOC`
    /// here (under the 10 KB realloc cap) and grown to full size by `grow_order_book`.
    #[account(
        init,
        payer = payer,
        space = ORDER_BOOK_INIT_ALLOC,
        seeds = [ORDER_BOOK_SEED, market.key().as_ref()],
        bump,
    )]
    pub order_book: Box<Account<'info, OrderBook>>,

    /// Per-market PDA: owner/authority of both escrow accounts (and, elsewhere,
    /// the vault + mints). No external signer exists for it.
    /// CHECK: PDA used only as a token-account authority; not deserialized.
    #[account(seeds = [MINT_AUTH_SEED, market.key().as_ref()], bump = market.mint_authority_bump)]
    pub mint_authority: UncheckedAccount<'info>,

    /// The market's Yes mint (escrow holds Yes tokens for resting asks).
    #[account(seeds = [YES_MINT_SEED, market.key().as_ref()], bump)]
    pub yes_mint: Box<Account<'info, Mint>>,

    /// USDC mint, taken from the vault's mint (the vault is bound by `has_one`).
    #[account(address = vault.mint @ MeridianError::InvalidArgument)]
    pub usdc_mint: Box<Account<'info, Mint>>,

    /// The collateralization vault — bound only to read its mint and prove the
    /// `usdc_mint` passed is the right one. Not modified here.
    #[account(address = market.vault @ MeridianError::InvalidArgument)]
    pub vault: Box<Account<'info, TokenAccount>>,

    /// Order-book USDC escrow (resting bids). Authority = mint_authority PDA.
    #[account(
        init,
        payer = payer,
        seeds = [USDC_ESCROW_SEED, market.key().as_ref()],
        bump,
        token::mint = usdc_mint,
        token::authority = mint_authority,
    )]
    pub usdc_escrow: Box<Account<'info, TokenAccount>>,

    /// Order-book Yes escrow (resting asks). Authority = mint_authority PDA.
    #[account(
        init,
        payer = payer,
        seeds = [YES_ESCROW_SEED, market.key().as_ref()],
        bump,
        token::mint = yes_mint,
        token::authority = mint_authority,
    )]
    pub yes_escrow: Box<Account<'info, TokenAccount>>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

pub fn handler(ctx: Context<InitOrderBook>) -> Result<()> {
    let order_book = &mut ctx.accounts.order_book;
    order_book.market = ctx.accounts.market.key();
    order_book.next_seq = 0;
    order_book.bids = Vec::new();
    order_book.asks = Vec::new();
    order_book.bump = ctx.bumps.order_book;

    // NOTE: `Market.order_book` is intentionally left unset here; `grow_order_book`
    // wires it after the account reaches full size, so trading can't begin against a
    // not-yet-grown book.

    Ok(())
}
