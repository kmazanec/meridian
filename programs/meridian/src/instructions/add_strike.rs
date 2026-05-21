//! `add_strike` — provision an additional strike market intraday.
//!
//! Identical provisioning to the day's initial market creation (Yes/No mints, the
//! PDA vault, an `Open` market on the ticker-strike-day seeds), exposed as a
//! distinct, named instruction so off-chain callers have a clear "add an extra
//! strike to an already-trading ticker/day" entry point and a distinct event.
//! Admin-gated; a duplicate ticker/strike/day is rejected by account `init`. The
//! strike value itself is supplied by the caller (the strike-selection algorithm
//! lives off-chain); the program only validates `strike > 0`.

use crate::constants::{
    MARKET_SEED, MINT_AUTH_SEED, NO_MINT_SEED, TOKEN_DECIMALS, VAULT_SEED, YES_MINT_SEED,
};
use crate::error::MeridianError;
use crate::instructions::create_strike_market::{populate_market, CreateStrikeMarketArgs, MarketBumps};
use crate::state::{Config, Market};
use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, Token, TokenAccount};

#[derive(Accounts)]
#[instruction(args: CreateStrikeMarketArgs)]
pub struct AddStrike<'info> {
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

    /// Per-market PDA: mint+freeze authority for both mints and the vault owner.
    /// No external signer exists for it.
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

pub fn handler(ctx: Context<AddStrike>, args: CreateStrikeMarketArgs) -> Result<()> {
    populate_market(
        &mut ctx.accounts.market,
        &args,
        ctx.accounts.yes_mint.key(),
        ctx.accounts.no_mint.key(),
        ctx.accounts.vault.key(),
        MarketBumps {
            market: ctx.bumps.market,
            vault: ctx.bumps.vault,
            mint_authority: ctx.bumps.mint_authority,
        },
    )?;

    emit!(crate::events::StrikeAdded {
        market: ctx.accounts.market.key(),
        ticker: args.ticker,
        strike: args.strike,
        trading_day: args.trading_day,
    });

    Ok(())
}
