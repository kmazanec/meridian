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

declare_id!("EWEYM6Ujg9j5SLxXeM2hcDY7XmWRRj6RTaJNnB8T3mn");

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
}
