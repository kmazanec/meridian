//! On-chain account & data model for Meridian (ARCHITECTURE.md §4).
//!
//! Solana programs are stateless; all state lives in these accounts. F-01 defines
//! the *shape* and size of every account plus `initialize_config`'s logic. The
//! trading/settlement/mint logic is implemented by later features (F-02–F-05),
//! but the account layouts here are frozen so those features never reshape them.

use crate::constants::{NUM_TICKERS, ORDERBOOK_N};
use anchor_lang::prelude::*;

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

/// The supported MAG7 underlyings. Encoded as a `u8` discriminant on-chain.
///
/// Note: no explicit discriminants — borsh 1.x (Anchor v1) derives ordinal
/// encoding, and adding explicit `= N` values conflicts with the Anchor derive
/// macros. The ordinal order below *is* the on-chain encoding; do not reorder.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug, InitSpace)]
pub enum Ticker {
    Aapl,
    Msft,
    Googl,
    Amzn,
    Nvda,
    Meta,
    Tsla,
}

/// Lifecycle state of a market.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug, InitSpace)]
pub enum MarketState {
    /// Trading and minting allowed (subject to global pause).
    Open,
    /// Settled: outcome written, redemption allowed, no new trades/mints.
    Settled,
}

/// Settlement outcome of a market.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug, InitSpace)]
pub enum Outcome {
    /// Not yet settled.
    Unsettled,
    /// Closing price >= strike: Yes tokens pay $1.00, No tokens pay $0.
    YesWins,
    /// Closing price < strike: No tokens pay $1.00, Yes tokens pay $0.
    NoWins,
}

/// Which side of the (Yes-vs-USDC) order book an order rests on.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug, InitSpace)]
pub enum OrderSide {
    /// Bid: offering to buy Yes tokens (escrows USDC).
    Bid,
    /// Ask: offering to sell Yes tokens (escrows Yes tokens).
    Ask,
}

// ---------------------------------------------------------------------------
// Config (singleton, one per deployment)
// ---------------------------------------------------------------------------

/// Per-ticker configuration: which underlying and its oracle feed id.
///
/// The `feed_id` is a 32-byte Pyth feed identifier (the on-chain settlement
/// feature, F-04, uses it to validate the price update account). Stored as raw
/// bytes so it is oracle-implementation-agnostic at this layer.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, InitSpace)]
pub struct TickerConfig {
    pub ticker: Ticker,
    pub feed_id: [u8; 32],
}

/// Global configuration singleton. PDA: `[CONFIG_SEED]`.
#[account]
#[derive(InitSpace)]
pub struct Config {
    /// Authority allowed to create/settle/pause/override.
    pub admin: Pubkey,
    /// The USDC mint used as collateral for every market.
    pub usdc_mint: Pubkey,
    /// Supported tickers and their oracle feed ids.
    pub tickers: [TickerConfig; NUM_TICKERS],
    /// Emergency switch: when true, minting and trading are blocked.
    pub paused: bool,
    /// Optional account that receives fees (if any are ever charged).
    /// Fees must never be taken from a market vault — that would break the
    /// collateralization invariant (ARCHITECTURE.md §7.1).
    pub fee_account: Option<Pubkey>,
    /// PDA bump for the config account.
    pub bump: u8,
}

// ---------------------------------------------------------------------------
// Market (one per stock-strike-day)
// ---------------------------------------------------------------------------

/// A single binary market: one stock, one strike, one trading day.
/// PDA: `[MARKET_SEED, ticker_index, strike_le, trading_day_le]`.
#[account]
#[derive(InitSpace)]
pub struct Market {
    /// Underlying ticker.
    pub ticker: Ticker,
    /// Strike price in USDC base units (6 dp). E.g. $680.00 -> 680_000_000.
    pub strike: u64,
    /// The session date this market settles for (unix timestamp, seconds).
    pub trading_day: i64,
    /// SPL mint for Yes tokens (mint authority is the per-market PDA).
    pub yes_mint: Pubkey,
    /// SPL mint for No tokens.
    pub no_mint: Pubkey,
    /// PDA-owned USDC collateral vault (token account).
    pub vault: Pubkey,
    /// The order book account for this market.
    pub order_book: Pubkey,
    /// Count of Yes/No pairs ever minted (monotonic). With `winning_redeemed`,
    /// drives the on-chain collateralization invariant
    /// (`vault_balance == PAYOFF_UNIT * pairs_minted - winning_redeemed`).
    pub pairs_minted: u64,
    /// Total winning-token base units paid out of the vault via `redeem`.
    /// Equals the USDC base units that have left the vault as payouts.
    pub winning_redeemed: u64,
    /// Lifecycle state.
    pub state: MarketState,
    /// Settlement outcome (immutable once written).
    pub outcome: Outcome,
    /// The closing price written at settlement (USDC base units, 6 dp).
    pub settlement_price: Option<u64>,
    /// Timestamp settlement occurred.
    pub settled_at: Option<i64>,
    /// PDA bump for the market account.
    pub bump: u8,
    /// PDA bump for the vault.
    pub vault_bump: u8,
    /// PDA bump for the mint authority.
    pub mint_authority_bump: u8,
}

// ---------------------------------------------------------------------------
// OrderBook (one per market) — bounded on-chain book
// ---------------------------------------------------------------------------

/// A single resting order on the Yes-vs-USDC book.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, InitSpace, Default)]
pub struct Order {
    /// Owner of the order (and of any escrowed funds/tokens).
    pub owner: Pubkey,
    /// Limit price in USDC-per-Yes, 6 dp, in `[0, PRICE_SCALE]`.
    pub price: u64,
    /// Remaining size in Yes-token base units.
    pub size: u64,
    /// Monotonic sequence number for time priority (lower = earlier).
    pub seq: u64,
    /// Which side this order is on.
    pub side: OrderSide,
    /// Whether this slot is occupied (false = empty slot).
    pub active: bool,
}

/// The bounded, on-chain order book for one market.
/// PDA: `[ORDER_BOOK_SEED, market.key()]`.
///
/// Bids and asks are fixed-capacity arrays (`ORDERBOOK_N` each). Matching logic
/// is implemented in F-03; F-01 only freezes this shape and size. Default-derive
/// is intentionally NOT used (the arrays exceed the std `Default` impl bound of
/// 32); the account is zero-initialized by Anchor `init`, which leaves all
/// orders with `active = false`.
#[account]
#[derive(InitSpace)]
pub struct OrderBook {
    /// Back-reference to the owning market.
    pub market: Pubkey,
    /// Monotonic counter handing out `Order::seq` values.
    pub next_seq: u64,
    /// Buy-Yes orders.
    #[max_len(ORDERBOOK_N)]
    pub bids: Vec<Order>,
    /// Sell-Yes orders.
    #[max_len(ORDERBOOK_N)]
    pub asks: Vec<Order>,
    /// PDA bump for the order book account.
    pub bump: u8,
}

impl Default for OrderSide {
    fn default() -> Self {
        OrderSide::Bid
    }
}
