//! F-01 frozen-contract tests: constant values, PDA derivation, and account
//! size accounting. Pure Rust (no SVM) — these lock the cross-cutting contracts
//! (ROADMAP concerns #2 and #3) that downstream features depend on.

use {
    anchor_lang::Space,
    meridian::{
        constants::{
            CONFIG_SEED, MARKET_SEED, MINT_AUTH_SEED, NO_MINT_SEED, NUM_TICKERS, ORDERBOOK_N,
            ORDER_BOOK_SEED, PAYOFF_UNIT, PRICE_SCALE, TOKEN_DECIMALS, USDC_DECIMALS, VAULT_SEED,
            YES_MINT_SEED,
        },
        state::{Config, Market, MarketState, Order, OrderBook, OrderSide, Outcome, Ticker},
    },
    solana_pubkey::Pubkey,
};

// Solana's maximum account data size is 10 MiB.
const MAX_ACCOUNT_SIZE: usize = 10 * 1024 * 1024;
// Anchor account discriminator length.
const DISC: usize = 8;

#[test]
fn money_scale_is_frozen() {
    assert_eq!(USDC_DECIMALS, 6, "USDC has 6 decimals");
    assert_eq!(TOKEN_DECIMALS, 6, "Yes/No tokens mirror USDC");
    assert_eq!(PAYOFF_UNIT, 1_000_000, "$1.00 == 1e6 base units");
    assert_eq!(PRICE_SCALE, 1_000_000, "price scale is 6dp");
    // $1.00 worth of a winning token redeems for PAYOFF_UNIT base units.
    assert_eq!(10u64.pow(USDC_DECIMALS as u32), PAYOFF_UNIT);
}

#[test]
fn orderbook_capacity_is_frozen() {
    assert_eq!(ORDERBOOK_N, 128, "N = 128 per side");
    assert_eq!(NUM_TICKERS, 7, "MAG7");
}

#[test]
fn enum_discriminants_are_frozen() {
    // These ordinals ARE the on-chain wire encoding (borsh 1.x). Downstream
    // features and the SDK depend on them. Reordering any variant is a breaking
    // change — this test converts the "do not reorder" comment into a guardrail.
    assert_eq!(Ticker::Aapl as u8, 0);
    assert_eq!(Ticker::Msft as u8, 1);
    assert_eq!(Ticker::Googl as u8, 2);
    assert_eq!(Ticker::Amzn as u8, 3);
    assert_eq!(Ticker::Nvda as u8, 4);
    assert_eq!(Ticker::Meta as u8, 5);
    assert_eq!(Ticker::Tsla as u8, 6);

    assert_eq!(MarketState::Open as u8, 0);
    assert_eq!(MarketState::Settled as u8, 1);

    assert_eq!(Outcome::Unsettled as u8, 0);
    assert_eq!(Outcome::YesWins as u8, 1);
    assert_eq!(Outcome::NoWins as u8, 2);

    assert_eq!(OrderSide::Bid as u8, 0);
    assert_eq!(OrderSide::Ask as u8, 1);
}

#[test]
fn pda_seeds_are_distinct() {
    // Seeds must be unique prefixes so PDAs never collide across account kinds.
    let seeds: [&[u8]; 7] = [
        CONFIG_SEED,
        MARKET_SEED,
        ORDER_BOOK_SEED,
        VAULT_SEED,
        MINT_AUTH_SEED,
        YES_MINT_SEED,
        NO_MINT_SEED,
    ];
    for i in 0..seeds.len() {
        for j in (i + 1)..seeds.len() {
            assert_ne!(seeds[i], seeds[j], "seeds {i} and {j} must differ");
        }
    }
}

#[test]
fn config_pda_derives_deterministically() {
    let (addr1, bump1) = Pubkey::find_program_address(&[CONFIG_SEED], &meridian::id());
    let (addr2, bump2) = Pubkey::find_program_address(&[CONFIG_SEED], &meridian::id());
    assert_eq!(addr1, addr2, "config PDA is deterministic");
    assert_eq!(bump1, bump2);
}

#[test]
fn market_and_child_pdas_derive() {
    // Market PDA from [MARKET_SEED, ticker_index, strike_le, trading_day_le].
    let ticker_index: u8 = 5; // META
    let strike: u64 = 680_000_000; // $680.00
    let trading_day: i64 = 1_747_000_000;
    let (market, _) = Pubkey::find_program_address(
        &[
            MARKET_SEED,
            &[ticker_index],
            &strike.to_le_bytes(),
            &trading_day.to_le_bytes(),
        ],
        &meridian::id(),
    );

    // Child PDAs are derived from the market key.
    let (vault, _) = Pubkey::find_program_address(&[VAULT_SEED, market.as_ref()], &meridian::id());
    let (mint_auth, _) =
        Pubkey::find_program_address(&[MINT_AUTH_SEED, market.as_ref()], &meridian::id());
    let (yes_mint, _) =
        Pubkey::find_program_address(&[YES_MINT_SEED, market.as_ref()], &meridian::id());
    let (no_mint, _) =
        Pubkey::find_program_address(&[NO_MINT_SEED, market.as_ref()], &meridian::id());
    let (book, _) =
        Pubkey::find_program_address(&[ORDER_BOOK_SEED, market.as_ref()], &meridian::id());

    // All distinct.
    let all = [market, vault, mint_auth, yes_mint, no_mint, book];
    for i in 0..all.len() {
        for j in (i + 1)..all.len() {
            assert_ne!(all[i], all[j], "child PDAs must be distinct ({i},{j})");
        }
    }
}

#[test]
fn account_sizes_fit_and_are_documented() {
    let config = DISC + Config::INIT_SPACE;
    let market = DISC + Market::INIT_SPACE;
    let book = DISC + OrderBook::INIT_SPACE;

    // Print sizes for the record (visible with `--nocapture`).
    println!("Config  size = {config} bytes");
    println!("Market  size = {market} bytes");
    println!("Order   size = {} bytes", Order::INIT_SPACE);
    println!("OrderBook size = {book} bytes (N={ORDERBOOK_N} per side)");

    // All must fit a single Solana account.
    assert!(config <= MAX_ACCOUNT_SIZE, "Config fits");
    assert!(market <= MAX_ACCOUNT_SIZE, "Market fits");
    assert!(book <= MAX_ACCOUNT_SIZE, "OrderBook fits");

    // The order book holds room for 2*N orders plus overhead; sanity-check the
    // dominant term so an accidental shrink of capacity is caught.
    let min_expected = 2 * ORDERBOOK_N * Order::INIT_SPACE;
    assert!(
        book >= min_expected,
        "OrderBook ({book}) must reserve room for 2*N orders ({min_expected})"
    );
}
