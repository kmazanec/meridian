//! `mint_pair` — deposit $1.00 USDC, receive 1 Yes + 1 No token.
//!
//! Transfers `PAYOFF_UNIT` USDC base units from the user into the market vault,
//! then mints `PAYOFF_UNIT` of each outcome token to the user (PDA-signed). Each
//! call mints exactly one "pair" worth ($1.00 of collateral ⇄ 1.0 of each token
//! at 6 decimals). Increments `pairs_minted`, which backs the collateralization
//! invariant `vault == PAYOFF_UNIT * (pairs_minted - redeemed)`.

use crate::constants::{MINT_AUTH_SEED, NO_MINT_SEED, PAYOFF_UNIT, YES_MINT_SEED};
use crate::error::MeridianError;
use crate::state::{Config, Market, MarketState};
use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{self, Mint, MintTo, Token, TokenAccount, Transfer};

#[derive(Accounts)]
pub struct MintPair<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(
        seeds = [crate::constants::CONFIG_SEED],
        bump = config.bump,
        constraint = !config.paused @ MeridianError::MarketPaused,
    )]
    pub config: Box<Account<'info, Config>>,

    #[account(
        mut,
        seeds = [
            crate::constants::MARKET_SEED,
            &[market.ticker as u8],
            &market.strike.to_le_bytes(),
            &market.trading_day.to_le_bytes(),
        ],
        bump = market.bump,
        constraint = market.state == MarketState::Open @ MeridianError::MarketSettled,
        has_one = yes_mint @ MeridianError::InvalidArgument,
        has_one = no_mint @ MeridianError::InvalidArgument,
        has_one = vault @ MeridianError::InvalidArgument,
    )]
    pub market: Box<Account<'info, Market>>,

    /// CHECK: PDA mint+freeze authority / vault owner for this market.
    #[account(seeds = [MINT_AUTH_SEED, market.key().as_ref()], bump = market.mint_authority_bump)]
    pub mint_authority: UncheckedAccount<'info>,

    #[account(mut, seeds = [YES_MINT_SEED, market.key().as_ref()], bump)]
    pub yes_mint: Box<Account<'info, Mint>>,
    #[account(mut, seeds = [NO_MINT_SEED, market.key().as_ref()], bump)]
    pub no_mint: Box<Account<'info, Mint>>,

    #[account(mut, address = market.vault @ MeridianError::InvalidArgument)]
    pub vault: Box<Account<'info, TokenAccount>>,

    /// The USDC mint (must match the vault's mint).
    #[account(address = config.usdc_mint @ MeridianError::InvalidArgument)]
    pub usdc_mint: Box<Account<'info, Mint>>,

    #[account(
        mut,
        associated_token::mint = usdc_mint,
        associated_token::authority = user,
    )]
    pub user_usdc: Box<Account<'info, TokenAccount>>,

    #[account(
        init_if_needed,
        payer = user,
        associated_token::mint = yes_mint,
        associated_token::authority = user,
    )]
    pub user_yes: Box<Account<'info, TokenAccount>>,

    #[account(
        init_if_needed,
        payer = user,
        associated_token::mint = no_mint,
        associated_token::authority = user,
    )]
    pub user_no: Box<Account<'info, TokenAccount>>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<MintPair>) -> Result<()> {
    // 1. Pull $1.00 USDC from the user into the vault.
    token::transfer(
        CpiContext::new(
            ctx.accounts.token_program.key(),
            Transfer {
                from: ctx.accounts.user_usdc.to_account_info(),
                to: ctx.accounts.vault.to_account_info(),
                authority: ctx.accounts.user.to_account_info(),
            },
        ),
        PAYOFF_UNIT,
    )?;

    // 2. Mint 1.0 Yes + 1.0 No to the user, signed by the market mint-authority PDA.
    let market_key = ctx.accounts.market.key();
    let signer_seeds: &[&[&[u8]]] = &[&[
        MINT_AUTH_SEED,
        market_key.as_ref(),
        &[ctx.accounts.market.mint_authority_bump],
    ]];

    token::mint_to(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.key(),
            MintTo {
                mint: ctx.accounts.yes_mint.to_account_info(),
                to: ctx.accounts.user_yes.to_account_info(),
                authority: ctx.accounts.mint_authority.to_account_info(),
            },
            signer_seeds,
        ),
        PAYOFF_UNIT,
    )?;
    token::mint_to(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.key(),
            MintTo {
                mint: ctx.accounts.no_mint.to_account_info(),
                to: ctx.accounts.user_no.to_account_info(),
                authority: ctx.accounts.mint_authority.to_account_info(),
            },
            signer_seeds,
        ),
        PAYOFF_UNIT,
    )?;

    // 3. Track the pair (checked).
    let market = &mut ctx.accounts.market;
    market.pairs_minted = market
        .pairs_minted
        .checked_add(1)
        .ok_or(MeridianError::MathOverflow)?;

    emit!(crate::events::PairMinted {
        market: market.key(),
        user: ctx.accounts.user.key(),
        amount: PAYOFF_UNIT,
        pairs_minted: market.pairs_minted,
    });

    Ok(())
}
