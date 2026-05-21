//! `pause` / `unpause` — the admin emergency stop.
//!
//! Both flip the single global `Config.paused` flag, which minting and trading
//! already honor (their handlers reject when `paused` is true). `pause` halts new
//! minting and all trading program-wide; `unpause` restores them. Both are
//! admin-only and idempotent (setting the flag to its current value is a harmless
//! no-op write). Settlement and redemption are intentionally *not* gated by the
//! pause flag, so a paused program can still wind down safely.

use crate::constants::CONFIG_SEED;
use crate::error::MeridianError;
use crate::state::Config;
use anchor_lang::prelude::*;

#[derive(Accounts)]
pub struct SetPause<'info> {
    pub admin: Signer<'info>,

    #[account(
        mut,
        seeds = [CONFIG_SEED],
        bump = config.bump,
        has_one = admin @ MeridianError::Unauthorized,
    )]
    pub config: Box<Account<'info, Config>>,
}

pub fn pause(ctx: Context<SetPause>) -> Result<()> {
    set_paused(&mut ctx.accounts.config, ctx.accounts.admin.key(), true)
}

pub fn unpause(ctx: Context<SetPause>) -> Result<()> {
    set_paused(&mut ctx.accounts.config, ctx.accounts.admin.key(), false)
}

fn set_paused(config: &mut Account<Config>, admin: Pubkey, paused: bool) -> Result<()> {
    config.paused = paused;
    emit!(crate::events::PauseSet { paused, admin });
    Ok(())
}
