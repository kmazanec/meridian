//! Meridian — binary stock-outcome markets on Solana.
//!
//! F-01 (this feature) delivers the program scaffold, the account/data model,
//! the frozen-contract constants, shared errors/events, and the one-time
//! `initialize_config` instruction. Trading, minting, settlement, and redemption
//! are implemented by later features (F-02–F-05) against the account shapes
//! defined here.

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
    /// USDC vault. Admin-gated. (F-02)
    pub fn create_strike_market(
        ctx: Context<CreateStrikeMarket>,
        args: CreateStrikeMarketArgs,
    ) -> Result<()> {
        instructions::create_strike_market::handler(ctx, args)
    }

    /// Deposit $1.00 USDC, receive 1 Yes + 1 No token. (F-02)
    pub fn mint_pair(ctx: Context<MintPair>) -> Result<()> {
        instructions::mint_pair::handler(ctx)
    }

    /// Burn settled tokens for their payout (winning side pays $1.00 each). (F-02)
    pub fn redeem(ctx: Context<Redeem>, side: RedeemSide, amount: u64) -> Result<()> {
        instructions::redeem::handler(ctx, side, amount)
    }

    /// Create the bounded order book (at initial size) + escrow accounts.
    /// Permissionless; first half of two-step creation (see `grow_order_book`). (F-03)
    pub fn init_order_book(ctx: Context<InitOrderBook>) -> Result<()> {
        instructions::init_order_book::handler(ctx)
    }

    /// Realloc the order book to full size and wire it into the market (enables
    /// trading). Second half of two-step creation. Permissionless. (F-03)
    pub fn grow_order_book(ctx: Context<GrowOrderBook>) -> Result<()> {
        instructions::grow_order_book::handler(ctx)
    }

    /// Post a limit or market order: cross the resting opposite side at price-time
    /// priority (settling atomically), then rest the limit remainder. (F-03)
    pub fn place_order<'info>(
        ctx: Context<'info, PlaceOrder<'info>>,
        args: PlaceOrderArgs,
    ) -> Result<()> {
        instructions::place_order::handler(ctx, args)
    }

    /// Cancel a caller's own resting order and return its escrow. (F-03)
    pub fn cancel_order(ctx: Context<CancelOrder>, args: CancelOrderArgs) -> Result<()> {
        instructions::cancel_order::handler(ctx, args)
    }

    /// Permissionless crank: settle any crossed resting bid/ask pairs. (F-03)
    pub fn match_orders<'info>(
        ctx: Context<'info, MatchOrders<'info>>,
        args: MatchOrdersArgs,
    ) -> Result<()> {
        instructions::match_orders::handler(ctx, args)
    }

    /// After 4:00 PM ET: read the Pyth oracle, validate it, and write the
    /// immutable Yes/No outcome. Permissionless and idempotent. (F-04)
    pub fn settle_market(ctx: Context<SettleMarket>) -> Result<()> {
        instructions::settle_market::handler(ctx)
    }
}
