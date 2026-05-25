//! `settle_market` — read the oracle and write the immutable outcome.
//!
//! After the market's close instant (`Market.trading_day`, the 4:00 PM ET unix
//! timestamp set at creation), anyone may settle: the caller supplies the Pyth
//! price-update account that a client posted on-chain via the Pyth Solana
//! Receiver, and the program validates it and records the outcome.
//!
//! **Permissionless (ADR-005 resilience):** settlement carries no `admin`
//! signer — if the automation service is down, any party can post the Pyth update
//! and crank settlement after close. The cranker cannot influence the result; the
//! outcome is a deterministic function of the on-chain price vs. the strike.
//!
//! **Idempotent:** a second call on an already-`Settled` market is a safe no-op
//! (the immutable outcome is never rewritten). This makes retries safe.
//!
//! Validation enforced (ARCHITECTURE §7 invariants 4–6):
//! - timing: `now >= trading_day` else `TooEarlyToSettle`
//! - feed match: price-update account owned by the Pyth receiver, and its
//!   `feed_id` equals `Config.tickers[ticker].feed_id` else `WrongFeed`
//! - freshness: not older than `DEFAULT_MAX_STALENESS` else `StalePrice`
//! - confidence: band within `MAX_CONFIDENCE_BPS` else `WideConfidence`

use crate::constants::{CONFIG_SEED, DEFAULT_MAX_STALENESS, MARKET_SEED, MAX_CONFIDENCE_BPS};
use crate::error::MeridianError;
use crate::oracle::{self, PYTH_RECEIVER_PROGRAM_ID};
use crate::state::{Config, Market, MarketState, Outcome};
use anchor_lang::prelude::*;

#[derive(Accounts)]
pub struct SettleMarket<'info> {
    /// Whoever cranks settlement (pays the tx fee). Not privileged.
    #[account(mut)]
    pub cranker: Signer<'info>,

    #[account(
        seeds = [CONFIG_SEED],
        bump = config.bump,
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

    /// The Pyth `PriceUpdateV2` account posted via the Pyth Solana Receiver.
    /// CHECK: validated in the handler — owner must be the receiver program and the
    /// parsed `feed_id` must match the market's configured feed. Parsed by bytes
    /// (no Pyth SDK dependency; see `oracle.rs`).
    pub price_update: UncheckedAccount<'info>,
}

pub fn handler(ctx: Context<SettleMarket>) -> Result<()> {
    // Idempotent: already settled → safe no-op (never rewrite the immutable
    // outcome). Note: on this path the `price_update` account is intentionally NOT
    // validated — a retry after a successful settle should succeed regardless of
    // what (possibly stale) update the caller passes. Off-chain monitors must not
    // infer oracle validity from a successful settle on an already-settled market;
    // the absence of a second `MarketSettled` event distinguishes the no-op.
    if ctx.accounts.market.state == MarketState::Settled {
        return Ok(());
    }

    let now = Clock::get()?.unix_timestamp;
    let market = &ctx.accounts.market;

    // Timing: cannot settle before the close instant (invariant 5).
    require!(now >= market.trading_day, MeridianError::TooEarlyToSettle);

    // The price-update account must be owned by the Pyth Solana Receiver program.
    // A spoofed account with arbitrary owner is rejected here (trust boundary).
    require_keys_eq!(
        *ctx.accounts.price_update.owner,
        PYTH_RECEIVER_PROGRAM_ID,
        MeridianError::WrongFeed
    );

    // Parse the price update from raw bytes (defensive, bounds-checked). The
    // discriminator is verified inside the parser, so this confirms the account
    // is genuinely a PriceUpdateV2 (not another receiver-owned account type).
    let data = ctx.accounts.price_update.try_borrow_data()?;
    let price = oracle::parse_price_update(&data)?;

    // Require *full* guardian verification. `Partial` updates clear a lower
    // guardian-collusion bar and Pyth documents them as unsafe for settlement;
    // an attacker who could post a Partial update must not be able to settle.
    require!(
        price.fully_verified,
        MeridianError::InsufficientVerification
    );

    // Feed match: the update must be for *this* market's configured feed. Reject a
    // zero feed id outright so an unconfigured ticker (all-zero Config slot) can
    // never be settled by an all-zero update that happens to align.
    let expected_feed = config_feed_for(&ctx.accounts.config, market)?;
    require!(expected_feed != [0u8; 32], MeridianError::WrongFeed);
    require!(price.feed_id == expected_feed, MeridianError::WrongFeed);

    // Freshness (invariant 6a).
    require!(
        !price.is_stale(now, DEFAULT_MAX_STALENESS),
        MeridianError::StalePrice
    );

    // Confidence band (invariant 6b).
    require!(
        price.confidence_ok(MAX_CONFIDENCE_BPS),
        MeridianError::WideConfidence
    );

    // Normalize to USDC base units (6 dp) for an apples-to-apples strike compare.
    let settlement_price = price.to_usdc_base_units()?;

    let market_key = ctx.accounts.market.key();
    write_settlement(
        &mut ctx.accounts.market,
        market_key,
        settlement_price,
        now,
        false,
    )
}

/// Look up the configured Pyth feed id for the market's ticker.
fn config_feed_for(config: &Config, market: &Market) -> Result<[u8; 32]> {
    config
        .tickers
        .iter()
        .find(|tc| tc.ticker == market.ticker)
        .map(|tc| tc.feed_id)
        .ok_or(error!(MeridianError::WrongFeed))
}

/// Write the immutable outcome (shared by `settle_market` and `admin_settle` so
/// both produce an identical decision: `settlement_price >= strike` → `YesWins`,
/// else `NoWins` — the at-strike boundary belongs to Yes, ARCHITECTURE §7).
///
/// Caller guarantees the market is not yet settled (both paths short-circuit on
/// `Settled` first), so this only ever writes once — settlement immutability
/// (invariant 4) holds.
pub fn write_settlement(
    market: &mut Market,
    market_key: Pubkey,
    settlement_price: u64,
    now: i64,
    by_admin: bool,
) -> Result<()> {
    let outcome = if settlement_price >= market.strike {
        Outcome::YesWins
    } else {
        Outcome::NoWins
    };

    market.outcome = outcome;
    market.settlement_price = Some(settlement_price);
    market.settled_at = Some(now);
    market.state = MarketState::Settled;

    emit!(crate::events::MarketSettled {
        market: market_key,
        outcome,
        settlement_price,
        settled_at: now,
        by_admin,
    });

    Ok(())
}
