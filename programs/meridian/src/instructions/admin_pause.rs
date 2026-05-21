//! `pause` / `unpause` — the admin emergency stop.
//!
//! Both flip the single global `Config.paused` flag, which minting and trading
//! already honor (their handlers reject when `paused` is true). `pause` halts new
//! minting and all trading program-wide; `unpause` restores them. Both are
//! admin-only and idempotent (setting the flag to its current value is a harmless
//! no-op write).
//!
//! Instructions that honor the pause flag: `mint_pair`, `place_order`,
//! `match_orders`. Intentionally **exempt** (must stay available so a paused
//! program can wind down safely): `cancel_order` (a user must always be able to
//! reclaim their own escrowed funds), `redeem` (claim payouts on a settled
//! market), and both settlement paths `settle_market` / `admin_settle`. Do not add
//! a pause gate to any of those without revisiting this wind-down guarantee.

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
    set_paused(&mut ctx.accounts.config, true)
}

pub fn unpause(ctx: Context<SetPause>) -> Result<()> {
    set_paused(&mut ctx.accounts.config, false)
}

fn set_paused(config: &mut Account<Config>, paused: bool) -> Result<()> {
    config.paused = paused;
    // `config.admin` is the verified authority (the accounts struct enforces
    // `has_one = admin`), so it is the correct actor to record.
    emit!(crate::events::PauseSet {
        paused,
        admin: config.admin,
    });
    Ok(())
}
