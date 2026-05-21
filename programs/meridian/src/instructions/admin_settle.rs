//! `admin_settle` — admin-only, time-delayed settlement fallback (F-04, ADR-004).
//!
//! The guaranteed escape hatch for when the oracle path can't run (no fresh feed
//! on the cluster, persistently wide confidence, receiver outage). The admin
//! supplies the closing price directly (in USDC base units, 6 dp) and the program
//! records the same immutable outcome `settle_market` would.
//!
//! Centralization is bounded three ways (ARCHITECTURE §10 ADR-004):
//! - **admin-only:** gated on `Config.admin`.
//! - **time-delayed:** callable only after `trading_day + ADMIN_OVERRIDE_DELAY`,
//!   so the permissionless oracle path always gets first chance.
//! - **fallback-only + immutable:** like `settle_market` it writes once; a second
//!   call on a settled market is a safe no-op, and it cannot overwrite an outcome
//!   already written by the oracle path.

use crate::constants::{ADMIN_OVERRIDE_DELAY, CONFIG_SEED, MARKET_SEED};
use crate::error::MeridianError;
use crate::instructions::settle_market::write_settlement;
use crate::state::{Config, Market, MarketState};
use anchor_lang::prelude::*;

#[derive(Accounts)]
pub struct AdminSettle<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    #[account(
        seeds = [CONFIG_SEED],
        bump = config.bump,
        has_one = admin @ MeridianError::Unauthorized,
    )]
    pub config: Box<Account<'info, Config>>,

    #[account(
        mut,
        seeds = [
            MARKET_SEED,
            &[market.ticker as u8],
            &market.strike.to_le_bytes(),
            &market.trading_day.to_le_bytes(),
        ],
        bump = market.bump,
    )]
    pub market: Box<Account<'info, Market>>,
}

pub fn handler(ctx: Context<AdminSettle>, settlement_price: u64) -> Result<()> {
    // Idempotent: already settled (by either path) → safe no-op. This cannot
    // overwrite an oracle-written outcome, bounding the admin's power.
    if ctx.accounts.market.state == MarketState::Settled {
        return Ok(());
    }

    // Reject a zero price: a stock's close is never $0, so this guards against a
    // fat-fingered (or hostile-if-key-compromised) all-NoWins settlement and
    // keeps the override honest. Real prices are always > 0 in USDC base units.
    require!(settlement_price > 0, MeridianError::InvalidArgument);

    let now = Clock::get()?.unix_timestamp;
    let market = &ctx.accounts.market;

    // Enforce the override delay relative to the close instant.
    let earliest = market
        .trading_day
        .checked_add(ADMIN_OVERRIDE_DELAY)
        .ok_or(MeridianError::MathOverflow)?;
    require!(now >= earliest, MeridianError::OverrideDelayNotElapsed);

    let market_key = ctx.accounts.market.key();
    write_settlement(
        &mut ctx.accounts.market,
        market_key,
        settlement_price,
        now,
        true,
    )
}
