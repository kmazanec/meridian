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
}
