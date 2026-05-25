//! `redeem` — burn settled tokens for their payout.
//!
//! After settlement, the winning side's tokens each redeem for `PAYOFF_UNIT`
//! USDC base units (1.0 token ⇄ $1.00); the losing side redeems for $0 (burn
//! only). The caller passes which side they are redeeming and the amount (in
//! token base units). Winning tokens remain redeemable indefinitely; partial
//! redemption is supported. Rejected before the market is settled.

use crate::constants::{MINT_AUTH_SEED, NO_MINT_SEED, YES_MINT_SEED};
use crate::error::MeridianError;
use crate::state::{Market, MarketState, Outcome};
use anchor_lang::prelude::*;
use anchor_spl::token::{self, Burn, Mint, Token, TokenAccount, Transfer};

/// Which outcome token the caller is redeeming.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug)]
pub enum RedeemSide {
    Yes,
    No,
}

#[derive(Accounts)]
pub struct Redeem<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(
        mut,
        seeds = [
            crate::constants::MARKET_SEED,
            &[market.ticker as u8],
            &market.strike.to_le_bytes(),
            &market.trading_day.to_le_bytes(),
        ],
        bump = market.bump,
        constraint = market.state == MarketState::Settled @ MeridianError::MarketNotSettled,
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

    /// The user's token account for the side being redeemed (Yes or No).
    /// Its mint is checked against the chosen side in the handler.
    #[account(mut, constraint = user_tokens.owner == user.key() @ MeridianError::NotOrderOwner)]
    pub user_tokens: Box<Account<'info, TokenAccount>>,

    /// The user's USDC account that receives the payout. Bound to the vault's
    /// mint and owned by the caller (defense-in-depth: payouts can't be
    /// redirected to a third party).
    #[account(
        mut,
        constraint = user_usdc.mint == vault.mint @ MeridianError::InvalidArgument,
        constraint = user_usdc.owner == user.key() @ MeridianError::InvalidArgument,
    )]
    pub user_usdc: Box<Account<'info, TokenAccount>>,

    pub token_program: Program<'info, Token>,
}

pub fn handler(ctx: Context<Redeem>, side: RedeemSide, amount: u64) -> Result<()> {
    require!(amount > 0, MeridianError::InvalidArgument);

    // The token account being burned must be the mint for the chosen side.
    let (side_mint, mint_ai) = match side {
        RedeemSide::Yes => (
            ctx.accounts.yes_mint.key(),
            ctx.accounts.yes_mint.to_account_info(),
        ),
        RedeemSide::No => (
            ctx.accounts.no_mint.key(),
            ctx.accounts.no_mint.to_account_info(),
        ),
    };
    require_keys_eq!(
        ctx.accounts.user_tokens.mint,
        side_mint,
        MeridianError::InvalidArgument
    );

    // Does this side win?
    let side_wins = matches!(
        (ctx.accounts.market.outcome, side),
        (Outcome::YesWins, RedeemSide::Yes) | (Outcome::NoWins, RedeemSide::No)
    );

    // Burn the redeemed tokens regardless of win/lose (tokens leave circulation).
    token::burn(
        CpiContext::new(
            ctx.accounts.token_program.key(),
            Burn {
                mint: mint_ai,
                from: ctx.accounts.user_tokens.to_account_info(),
                authority: ctx.accounts.user.to_account_info(),
            },
        ),
        amount,
    )?;

    // Winning side: pay `amount` USDC base units (1:1) from the vault, PDA-signed.
    if side_wins {
        // Defense-in-depth for the collateralization invariant (ARCH §7.1):
        // the vault must actually hold the collateral we're about to pay. SPL
        // would fail an over-transfer anyway, but this gives a clear program
        // error and guards the invariant explicitly.
        require!(
            ctx.accounts.vault.amount >= amount,
            MeridianError::InsufficientBalance
        );

        let market_key = ctx.accounts.market.key();
        let signer_seeds: &[&[&[u8]]] = &[&[
            MINT_AUTH_SEED,
            market_key.as_ref(),
            &[ctx.accounts.market.mint_authority_bump],
        ]];
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.key(),
                Transfer {
                    from: ctx.accounts.vault.to_account_info(),
                    to: ctx.accounts.user_usdc.to_account_info(),
                    authority: ctx.accounts.mint_authority.to_account_info(),
                },
                signer_seeds,
            ),
            amount,
        )?;

        // Track payouts so the collateralization invariant has on-chain
        // representation: vault == PAYOFF_UNIT * pairs_minted - winning_redeemed.
        let market = &mut ctx.accounts.market;
        market.winning_redeemed = market
            .winning_redeemed
            .checked_add(amount)
            .ok_or(MeridianError::MathOverflow)?;
    }

    emit!(crate::events::Redeemed {
        market: ctx.accounts.market.key(),
        user: ctx.accounts.user.key(),
        won: side_wins,
        tokens_burned: amount,
        usdc_paid: if side_wins { amount } else { 0 },
    });

    Ok(())
}
