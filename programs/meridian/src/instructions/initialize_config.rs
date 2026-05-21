//! `initialize_config` — one-time global setup (ARCHITECTURE.md §5).
//!
//! Creates the singleton `Config` PDA holding the admin authority, the USDC
//! collateral mint, the supported tickers + their oracle feed ids, the global
//! pause flag, and an optional fee account. Idempotency is enforced by Anchor's
//! `init` constraint: a second call fails because the PDA already exists.

use crate::constants::{CONFIG_SEED, NUM_TICKERS};
use crate::state::{Config, TickerConfig};
use anchor_lang::prelude::*;

/// Arguments for `initialize_config`.
///
/// `tickers` provides the per-ticker oracle feed ids. The full set of MAG7
/// tickers must be supplied (exactly `NUM_TICKERS`).
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct InitializeConfigArgs {
    pub tickers: [TickerConfig; NUM_TICKERS],
    pub fee_account: Option<Pubkey>,
}

#[derive(Accounts)]
pub struct InitializeConfig<'info> {
    /// The deployer / payer; becomes the admin authority.
    #[account(mut)]
    pub admin: Signer<'info>,

    /// The USDC mint used as collateral across all markets.
    /// CHECK: stored by key only; validated as a real mint when used by F-02.
    pub usdc_mint: UncheckedAccount<'info>,

    /// The singleton config PDA. `init` makes this idempotent — a second call
    /// fails with the account-already-in-use error.
    #[account(
        init,
        payer = admin,
        space = 8 + Config::INIT_SPACE,
        seeds = [CONFIG_SEED],
        bump,
    )]
    pub config: Account<'info, Config>,

    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<InitializeConfig>, args: InitializeConfigArgs) -> Result<()> {
    let config = &mut ctx.accounts.config;
    config.admin = ctx.accounts.admin.key();
    config.usdc_mint = ctx.accounts.usdc_mint.key();
    config.tickers = args.tickers;
    config.paused = false;
    config.fee_account = args.fee_account;
    config.bump = ctx.bumps.config;

    emit!(crate::events::ConfigInitialized {
        admin: config.admin,
        usdc_mint: config.usdc_mint,
        fee_account: config.fee_account,
    });

    Ok(())
}
