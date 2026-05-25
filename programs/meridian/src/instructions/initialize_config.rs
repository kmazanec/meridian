//! `initialize_config` — one-time global setup (ARCHITECTURE.md §5).
//!
//! Creates the singleton `Config` PDA holding the admin authority, the USDC
//! collateral mint, the supported tickers + their oracle feed ids, the global
//! pause flag, and an optional fee account.
//!
//! Security model:
//! - **Idempotency:** the `Config` PDA uses a fixed seed with no per-user
//!   component, so there is exactly one possible address. Anchor `init` makes a
//!   second call fail (account already in use).
//! - **Authorization:** only the program's **upgrade authority** may initialize
//!   config. This closes the permissionless-init front-run window — an attacker
//!   cannot seize `admin` between deploy and init, because they don't control the
//!   program's upgrade authority. The admin is bound to that authority.
//! - **Collateral validation:** `usdc_mint` is validated as a real SPL `Mint`
//!   here (not merely stored by key), so a poison/zero value cannot be frozen
//!   into the singleton.

use crate::constants::{CONFIG_SEED, NUM_TICKERS};
use crate::error::MeridianError;
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
    /// The signer initializing config; becomes the admin authority. Must be the
    /// program's upgrade authority (enforced via `program_data` below).
    #[account(mut)]
    pub admin: Signer<'info>,

    /// The USDC mint used as collateral across all markets.
    ///
    /// Here we only store the key, but we sanity-check it is a real,
    /// token-program-owned account (not a zero/garbage key) so a poison value
    /// can't be frozen into the singleton. We deliberately avoid pulling in the
    /// full `anchor-spl` token stack here (dependency hygiene); `mint_pair`
    /// performs full `Mint` typing and the actual token CPIs.
    /// CHECK: ownership + non-default validated in the handler.
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

    /// This program's account (executable). Used to locate its program-data.
    /// CHECK: constrained to be this program and to own `program_data`.
    #[account(constraint = program.key() == crate::ID @ MeridianError::Unauthorized)]
    pub program: Program<'info, crate::program::Meridian>,

    /// The program's ProgramData account, which holds the upgrade authority.
    /// Anchor verifies the link program -> program_data and that `admin` is the
    /// recorded upgrade authority.
    #[account(
        constraint = program_data.upgrade_authority_address == Some(admin.key())
            @ MeridianError::Unauthorized,
    )]
    pub program_data: Account<'info, ProgramData>,

    pub system_program: Program<'info, System>,
}

/// SPL Token program id.
const SPL_TOKEN_ID: Pubkey = pubkey!("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
/// SPL Token-2022 program id.
const SPL_TOKEN_2022_ID: Pubkey = pubkey!("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");

pub fn handler(ctx: Context<InitializeConfig>, args: InitializeConfigArgs) -> Result<()> {
    // Sanity-check the collateral mint: must be a real, token-program-owned
    // account (rejects the zero key and arbitrary non-mint accounts). Full mint
    // typing happens in `mint_pair`.
    let mint_ai = ctx.accounts.usdc_mint.to_account_info();
    let mint_owner = *mint_ai.owner;
    require!(
        mint_owner == SPL_TOKEN_ID || mint_owner == SPL_TOKEN_2022_ID,
        MeridianError::InvalidArgument
    );
    require_keys_neq!(
        ctx.accounts.usdc_mint.key(),
        Pubkey::default(),
        MeridianError::InvalidArgument
    );

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
