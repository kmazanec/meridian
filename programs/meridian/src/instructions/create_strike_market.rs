//! `create_strike_market` — provision one stock-strike-day market (F-02).
//!
//! Creates the `Market` PDA, the Yes and No SPL mints (6 decimals, mint+freeze
//! authority = the per-market mint-authority PDA), and the PDA-owned USDC vault
//! token account. Admin-gated. The order book account is created later by F-03;
//! `Market.order_book` is left as the default pubkey until then.
//!
//! Scope note: provisioning lives here (F-02 owns the single creation path);
//! F-05 reuses this for `add_strike`. See ROADMAP.md.

use crate::constants::{
    MARKET_SEED, MINT_AUTH_SEED, NO_MINT_SEED, TOKEN_DECIMALS, VAULT_SEED, YES_MINT_SEED,
};
use crate::error::MeridianError;
use crate::state::{Config, Market, MarketState, Outcome, Ticker};
use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, Token, TokenAccount};

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct CreateStrikeMarketArgs {
    pub ticker: Ticker,
    pub strike: u64,
    pub trading_day: i64,
}

#[derive(Accounts)]
#[instruction(args: CreateStrikeMarketArgs)]
pub struct CreateStrikeMarket<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    #[account(
        seeds = [crate::constants::CONFIG_SEED],
        bump = config.bump,
        has_one = admin @ MeridianError::Unauthorized,
        constraint = config.usdc_mint == usdc_mint.key() @ MeridianError::InvalidArgument,
    )]
    pub config: Box<Account<'info, Config>>,

    /// The USDC collateral mint (must match Config.usdc_mint).
    pub usdc_mint: Box<Account<'info, Mint>>,

    #[account(
        init,
        payer = admin,
        space = 8 + Market::INIT_SPACE,
        seeds = [
            MARKET_SEED,
            &[args.ticker as u8],
            &args.strike.to_le_bytes(),
            &args.trading_day.to_le_bytes(),
        ],
        bump,
    )]
    pub market: Box<Account<'info, Market>>,

    /// Per-market PDA that is the mint+freeze authority for both mints and the
    /// owner of the vault. No external signer exists for it.
    /// CHECK: PDA used only as an authority; not deserialized.
    #[account(seeds = [MINT_AUTH_SEED, market.key().as_ref()], bump)]
    pub mint_authority: UncheckedAccount<'info>,

    #[account(
        init,
        payer = admin,
        seeds = [YES_MINT_SEED, market.key().as_ref()],
        bump,
        mint::decimals = TOKEN_DECIMALS,
        mint::authority = mint_authority,
        mint::freeze_authority = mint_authority,
    )]
    pub yes_mint: Box<Account<'info, Mint>>,

    #[account(
        init,
        payer = admin,
        seeds = [NO_MINT_SEED, market.key().as_ref()],
        bump,
        mint::decimals = TOKEN_DECIMALS,
        mint::authority = mint_authority,
        mint::freeze_authority = mint_authority,
    )]
    pub no_mint: Box<Account<'info, Mint>>,

    #[account(
        init,
        payer = admin,
        seeds = [VAULT_SEED, market.key().as_ref()],
        bump,
        token::mint = usdc_mint,
        token::authority = mint_authority,
    )]
    pub vault: Box<Account<'info, TokenAccount>>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

pub fn handler(ctx: Context<CreateStrikeMarket>, args: CreateStrikeMarketArgs) -> Result<()> {
    require!(args.strike > 0, MeridianError::InvalidArgument);

    let market = &mut ctx.accounts.market;
    market.ticker = args.ticker;
    market.strike = args.strike;
    market.trading_day = args.trading_day;
    market.yes_mint = ctx.accounts.yes_mint.key();
    market.no_mint = ctx.accounts.no_mint.key();
    market.vault = ctx.accounts.vault.key();
    market.order_book = Pubkey::default(); // wired by F-03
    market.pairs_minted = 0;
    market.winning_redeemed = 0;
    market.state = MarketState::Open;
    market.outcome = Outcome::Unsettled;
    market.settlement_price = None;
    market.settled_at = None;
    market.bump = ctx.bumps.market;
    market.vault_bump = ctx.bumps.vault;
    market.mint_authority_bump = ctx.bumps.mint_authority;

    emit!(crate::events::MarketCreated {
        market: market.key(),
        ticker: args.ticker,
        strike: args.strike,
        trading_day: args.trading_day,
        yes_mint: market.yes_mint,
        no_mint: market.no_mint,
    });

    Ok(())
}
