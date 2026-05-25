//! Meridian — binary stock-outcome markets on Solana.
//!
//! The program scaffold, the account/data model, the frozen-contract constants,
//! shared errors/events, and the one-time `initialize_config` instruction.
//! Trading, minting, settlement, and redemption are implemented against the
//! account shapes defined here.

// `diverging_sub_expression` fires inside Anchor's `#[program]` macro expansion
// (the generated dispatch/handler glue), not in our handler bodies. The lint is
// emitted against macro-generated code that a module-level `#[allow]` can't
// reach, so suppress it crate-wide.
#![allow(clippy::diverging_sub_expression)]
// Instruction modules each expose `handler` (and admin_pause `pause`/`unpause`),
// surfaced only via fully qualified paths. The `pub use instructions::*` /
// `pub use state::*` globs below — and the per-module globs in instructions.rs —
// re-export the Anchor `Context`/`*Args` types; the resulting name overlap is
// harmless. The ambiguity surfaces at every glob layer, so suppress it crate-wide.
#![allow(ambiguous_glob_reexports)]

pub mod constants;
pub mod error;
pub mod events;
pub mod instructions;
pub mod oracle;
pub mod state;

use anchor_lang::prelude::*;

pub use constants::*;
pub use error::*;
pub use events::*;
pub use instructions::*;
pub use state::*;

declare_id!("9R3jRbvh9jeQLGEggB3VXQTwj88YjUKqKM8x75SefGen");

// On-chain `security.txt` — surfaced as a "Security" tab on the Solana Explorer.
// Embedded in the program binary, so it lands with the next `program upgrade`.
// Excluded from CPI/no-entrypoint builds (no point carrying it in a consumer's
// binary), matching how the rest of the entrypoint-only glue is gated.
#[cfg(not(feature = "no-entrypoint"))]
solana_security_txt::security_txt! {
    name: "Meridian",
    project_url: "https://meridian.llmonster.dev",
    contacts: "email:keith@devforward.com",
    policy: "https://github.com/kmazanec/meridian/blob/main/SECURITY.md",
    source_code: "https://github.com/kmazanec/meridian",
    preferred_languages: "en"
}

#[program]
pub mod meridian {
    use super::*;

    /// One-time global setup. Creates the singleton `Config` PDA.
    pub fn initialize_config(
        ctx: Context<InitializeConfig>,
        args: InitializeConfigArgs,
    ) -> Result<()> {
        instructions::initialize_config::handler(ctx, args)
    }

    /// Provision one stock-strike-day market: Market PDA, Yes/No mints, and the
    /// USDC vault. Admin-gated.
    pub fn create_strike_market(
        ctx: Context<CreateStrikeMarket>,
        args: CreateStrikeMarketArgs,
    ) -> Result<()> {
        instructions::create_strike_market::handler(ctx, args)
    }

    /// Deposit $1.00 USDC, receive 1 Yes + 1 No token.
    pub fn mint_pair(ctx: Context<MintPair>) -> Result<()> {
        instructions::mint_pair::handler(ctx)
    }

    /// Burn settled tokens for their payout (winning side pays $1.00 each).
    pub fn redeem(ctx: Context<Redeem>, side: RedeemSide, amount: u64) -> Result<()> {
        instructions::redeem::handler(ctx, side, amount)
    }

    /// Create the bounded order book (at initial size) + escrow accounts.
    /// Permissionless; first half of two-step creation (see `grow_order_book`).
    pub fn init_order_book(ctx: Context<InitOrderBook>) -> Result<()> {
        instructions::init_order_book::handler(ctx)
    }

    /// Realloc the order book to full size and wire it into the market (enables
    /// trading). Second half of two-step creation. Permissionless.
    pub fn grow_order_book(ctx: Context<GrowOrderBook>) -> Result<()> {
        instructions::grow_order_book::handler(ctx)
    }

    /// Post a limit or market order: cross the resting opposite side at price-time
    /// priority (settling atomically), then rest the limit remainder.
    pub fn place_order<'info>(
        ctx: Context<'info, PlaceOrder<'info>>,
        args: PlaceOrderArgs,
    ) -> Result<()> {
        instructions::place_order::handler(ctx, args)
    }

    /// Cancel a caller's own resting order and return its escrow.
    pub fn cancel_order(ctx: Context<CancelOrder>, args: CancelOrderArgs) -> Result<()> {
        instructions::cancel_order::handler(ctx, args)
    }

    /// Permissionless crank: settle any crossed resting bid/ask pairs.
    pub fn match_orders<'info>(
        ctx: Context<'info, MatchOrders<'info>>,
        args: MatchOrdersArgs,
    ) -> Result<()> {
        instructions::match_orders::handler(ctx, args)
    }

    /// After 4:00 PM ET: read the Pyth oracle, validate it, and write the
    /// immutable Yes/No outcome. Permissionless and idempotent.
    pub fn settle_market(ctx: Context<SettleMarket>) -> Result<()> {
        instructions::settle_market::handler(ctx)
    }

    /// Admin-only, time-delayed settlement fallback when the oracle path can't
    /// run. Admin supplies the closing price (USDC base units). Idempotent.
    pub fn admin_settle(ctx: Context<AdminSettle>, settlement_price: u64) -> Result<()> {
        instructions::admin_settle::handler(ctx, settlement_price)
    }

    /// Provision an additional strike market intraday for an existing
    /// ticker/day. Admin-gated; same provisioning as the initial create.
    pub fn add_strike(ctx: Context<AddStrike>, args: CreateStrikeMarketArgs) -> Result<()> {
        instructions::add_strike::handler(ctx, args)
    }

    /// Admin emergency stop: halt new minting and all trading program-wide.
    pub fn pause(ctx: Context<SetPause>) -> Result<()> {
        instructions::admin_pause::pause(ctx)
    }

    /// Admin: lift the emergency stop, restoring minting and trading.
    pub fn unpause(ctx: Context<SetPause>) -> Result<()> {
        instructions::admin_pause::unpause(ctx)
    }
}
