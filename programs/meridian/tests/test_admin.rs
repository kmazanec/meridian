//! Admin controls: pause / unpause and add_strike (LiteSVM).

mod common;

use {
    common::*,
    meridian::state::{MarketState, OrderSide, Ticker},
    solana_keypair::Keypair,
    solana_signer::Signer,
};

const DAY: i64 = 1_747_000_000;
const STRIKE: u64 = 680_000_000;
const ONE: u64 = 1_000_000;

// ----------------------------------------------------------------------------
// pause / unpause
// ----------------------------------------------------------------------------

#[test]
fn pause_blocks_mint_then_unpause_restores() {
    let mut f = setup(10 * ONE);
    let admin = f.admin.insecure_clone();
    let user = f.user.insecure_clone();

    let ix = ix_create_strike_market(&f.admin.pubkey(), &f.usdc_mint, Ticker::Meta, STRIKE, DAY);
    send(&mut f.svm, &f.admin.pubkey(), ix, &[&admin]).expect("create");
    let market = market_pda(Ticker::Meta, STRIKE, DAY).0;

    // Pause → mint rejected.
    send(&mut f.svm, &f.admin.pubkey(), ix_pause(&f.admin.pubkey()), &[&admin]).expect("pause");
    let ix = ix_mint_pair(&f.user.pubkey(), &f.usdc_mint, &market);
    assert!(
        send(&mut f.svm, &f.user.pubkey(), ix, &[&user]).is_err(),
        "mint must be blocked while paused"
    );

    // Unpause → mint works again.
    send(&mut f.svm, &f.admin.pubkey(), ix_unpause(&f.admin.pubkey()), &[&admin]).expect("unpause");
    let ix = ix_mint_pair(&f.user.pubkey(), &f.usdc_mint, &market);
    send(&mut f.svm, &f.user.pubkey(), ix, &[&user]).expect("mint after unpause");
    assert_eq!(read_market(&f.svm, &market).pairs_minted, 1);
}

#[test]
fn pause_blocks_trading() {
    // Drives the real place_order path through the real pause/unpause INSTRUCTIONS
    // (not the test shim) to prove the trade guard end to end.
    let mut f = setup(10 * ONE);
    let admin = f.admin.insecure_clone();
    let user = f.user.insecure_clone();
    let market = create_market_and_book(&mut f, Ticker::Meta, STRIKE, DAY);

    // A Bid may receive Yes, so the user needs a (possibly empty) Yes ATA first.
    let (yes_mint, _) = yes_mint_pda(&market);
    seed_token_account(&mut f.svm, &ata(&f.user.pubkey(), &yes_mint), &yes_mint, &f.user.pubkey(), 0);

    // Sanity: a bid rests fine while open.
    let ix = ix_place_order(&f.user.pubkey(), &f.usdc_mint, &market, OrderSide::Bid, 600_000, ONE, false, &[]);
    send(&mut f.svm, &f.user.pubkey(), ix, &[&user]).expect("place while open");

    // Pause → place_order rejected.
    send(&mut f.svm, &f.admin.pubkey(), ix_pause(&f.admin.pubkey()), &[&admin]).expect("pause");
    let ix = ix_place_order(&f.user.pubkey(), &f.usdc_mint, &market, OrderSide::Bid, 600_000, ONE, false, &[]);
    assert!(
        send(&mut f.svm, &f.user.pubkey(), ix, &[&user]).is_err(),
        "trading must be blocked while paused"
    );

    // Unpause → place_order works again.
    send(&mut f.svm, &f.admin.pubkey(), ix_unpause(&f.admin.pubkey()), &[&admin]).expect("unpause");
    let ix = ix_place_order(&f.user.pubkey(), &f.usdc_mint, &market, OrderSide::Bid, 600_000, ONE, false, &[]);
    send(&mut f.svm, &f.user.pubkey(), ix, &[&user]).expect("place after unpause");
}

#[test]
fn non_admin_cannot_pause_or_unpause() {
    let mut f = setup(5 * ONE);
    let attacker = Keypair::new();
    f.svm.airdrop(&attacker.pubkey(), 100_000_000_000).unwrap();

    assert!(
        send(&mut f.svm, &attacker.pubkey(), ix_pause(&attacker.pubkey()), &[&attacker]).is_err(),
        "non-admin pause must be rejected"
    );
    // The rejection must not have mutated the flag (defense against an auth bypass
    // that writes before failing).
    assert!(!read_config(&f.svm).paused, "paused must remain false after rejected pause");

    assert!(
        send(&mut f.svm, &attacker.pubkey(), ix_unpause(&attacker.pubkey()), &[&attacker]).is_err(),
        "non-admin unpause must be rejected"
    );
}

#[test]
fn pause_is_idempotent() {
    let mut f = setup(5 * ONE);
    let admin = f.admin.insecure_clone();
    // Pausing twice is a harmless no-op (no error).
    send(&mut f.svm, &f.admin.pubkey(), ix_pause(&f.admin.pubkey()), &[&admin]).expect("pause 1");
    send(&mut f.svm, &f.admin.pubkey(), ix_pause(&f.admin.pubkey()), &[&admin]).expect("pause 2 (no-op)");
    // Unpausing twice likewise.
    send(&mut f.svm, &f.admin.pubkey(), ix_unpause(&f.admin.pubkey()), &[&admin]).expect("unpause 1");
    send(&mut f.svm, &f.admin.pubkey(), ix_unpause(&f.admin.pubkey()), &[&admin]).expect("unpause 2 (no-op)");
}

// ----------------------------------------------------------------------------
// add_strike
// ----------------------------------------------------------------------------

const STRIKE_2: u64 = 700_000_000; // a second strike on the same ticker/day

#[test]
fn add_strike_provisions_open_market() {
    let mut f = setup(10 * ONE);
    let admin = f.admin.insecure_clone();

    // The day's first market exists via create; add a second strike.
    let ix = ix_create_strike_market(&f.admin.pubkey(), &f.usdc_mint, Ticker::Meta, STRIKE, DAY);
    send(&mut f.svm, &f.admin.pubkey(), ix, &[&admin]).expect("create first");

    let ix = ix_add_strike(&f.admin.pubkey(), &f.usdc_mint, Ticker::Meta, STRIKE_2, DAY);
    send(&mut f.svm, &f.admin.pubkey(), ix, &[&admin]).expect("add strike");

    let market2 = market_pda(Ticker::Meta, STRIKE_2, DAY).0;
    let m = read_market(&f.svm, &market2);
    assert_eq!(m.state, MarketState::Open);
    assert_eq!(m.strike, STRIKE_2);
    assert_eq!(m.ticker, Ticker::Meta);

    // Mints + vault are PDA-owned with the per-market mint-authority PDA, no
    // external authority (verified by minting a pair against the added market).
    let user = f.user.insecure_clone();
    let ix = ix_mint_pair(&f.user.pubkey(), &f.usdc_mint, &market2);
    send(&mut f.svm, &f.user.pubkey(), ix, &[&user]).expect("mint against added strike");
    assert_eq!(read_market(&f.svm, &market2).pairs_minted, 1);
}

#[test]
fn add_strike_duplicate_rejected() {
    let mut f = setup(5 * ONE);
    let admin = f.admin.insecure_clone();
    let ix = ix_add_strike(&f.admin.pubkey(), &f.usdc_mint, Ticker::Meta, STRIKE, DAY);
    send(&mut f.svm, &f.admin.pubkey(), ix, &[&admin]).expect("add once");
    // Same ticker/strike/day again → rejected (account already in use).
    let ix = ix_add_strike(&f.admin.pubkey(), &f.usdc_mint, Ticker::Meta, STRIKE, DAY);
    assert!(
        send(&mut f.svm, &f.admin.pubkey(), ix, &[&admin]).is_err(),
        "duplicate add_strike must be rejected"
    );
}

#[test]
fn add_strike_rejects_non_admin() {
    let mut f = setup(5 * ONE);
    let attacker = Keypair::new();
    f.svm.airdrop(&attacker.pubkey(), 100_000_000_000).unwrap();
    let ix = ix_add_strike(&attacker.pubkey(), &f.usdc_mint, Ticker::Meta, STRIKE, DAY);
    assert!(
        send(&mut f.svm, &attacker.pubkey(), ix, &[&attacker]).is_err(),
        "non-admin add_strike must be rejected"
    );
}

#[test]
fn add_strike_rejects_zero_strike() {
    let mut f = setup(5 * ONE);
    let admin = f.admin.insecure_clone();
    let ix = ix_add_strike(&f.admin.pubkey(), &f.usdc_mint, Ticker::Meta, 0, DAY);
    assert!(
        send(&mut f.svm, &f.admin.pubkey(), ix, &[&admin]).is_err(),
        "zero strike must be rejected"
    );
}

#[test]
fn add_strike_rejects_zero_trading_day() {
    // trading_day = 0 would make the market settleable the instant it's created.
    let mut f = setup(5 * ONE);
    let admin = f.admin.insecure_clone();
    let ix = ix_add_strike(&f.admin.pubkey(), &f.usdc_mint, Ticker::Meta, STRIKE, 0);
    assert!(
        send(&mut f.svm, &f.admin.pubkey(), ix, &[&admin]).is_err(),
        "zero trading_day must be rejected"
    );
}
