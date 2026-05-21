//! F-04 tests for `admin_settle` — the time-delayed admin fallback (LiteSVM).

mod common;

use {
    common::*,
    meridian::state::{MarketState, Outcome, Ticker},
    solana_keypair::Keypair,
    solana_signer::Signer,
};

const STRIKE: u64 = 680_000_000;
const ONE: u64 = 1_000_000;
const CLOSE: i64 = 1_747_000_000;
const ONE_HOUR: i64 = 60 * 60; // == ADMIN_OVERRIDE_DELAY

fn open_market(f: &mut Fixture) -> solana_pubkey::Pubkey {
    let admin = f.admin.insecure_clone();
    let ix = ix_create_strike_market(&f.admin.pubkey(), &f.usdc_mint, Ticker::Meta, STRIKE, CLOSE);
    send(&mut f.svm, &f.admin.pubkey(), ix, &[&admin]).expect("create market");
    market_pda(Ticker::Meta, STRIKE, CLOSE).0
}

#[test]
fn admin_settle_after_delay_writes_outcome() {
    let mut f = setup(5 * ONE);
    let market = open_market(&mut f);
    set_clock(&mut f.svm, CLOSE + ONE_HOUR); // exactly at the delay boundary

    let admin = f.admin.insecure_clone();
    let ix = ix_admin_settle(&f.admin.pubkey(), &market, 700_000_000); // $700 > strike
    send(&mut f.svm, &f.admin.pubkey(), ix, &[&admin]).expect("admin settle after delay");

    let m = read_market(&f.svm, &market);
    assert_eq!(m.state, MarketState::Settled);
    assert_eq!(m.outcome, Outcome::YesWins);
    assert_eq!(m.settlement_price, Some(700_000_000));
}

#[test]
fn admin_settle_rejected_before_delay() {
    let mut f = setup(5 * ONE);
    let market = open_market(&mut f);
    set_clock(&mut f.svm, CLOSE + ONE_HOUR - 1); // one second short of the delay

    let admin = f.admin.insecure_clone();
    let ix = ix_admin_settle(&f.admin.pubkey(), &market, 700_000_000);
    assert!(
        send(&mut f.svm, &f.admin.pubkey(), ix, &[&admin]).is_err(),
        "admin_settle before the override delay must be rejected"
    );
    assert_eq!(read_market(&f.svm, &market).state, MarketState::Open);
}

#[test]
fn admin_settle_rejects_non_admin() {
    let mut f = setup(5 * ONE);
    let market = open_market(&mut f);
    set_clock(&mut f.svm, CLOSE + ONE_HOUR + 10);

    // A funded non-admin attacker tries to settle.
    let attacker = Keypair::new();
    f.svm.airdrop(&attacker.pubkey(), 100_000_000_000).unwrap();
    let ix = ix_admin_settle(&attacker.pubkey(), &market, 700_000_000);
    assert!(
        send(&mut f.svm, &attacker.pubkey(), ix, &[&attacker]).is_err(),
        "non-admin admin_settle must be rejected"
    );
    assert_eq!(read_market(&f.svm, &market).state, MarketState::Open);
}

#[test]
fn admin_settle_outcome_matches_settle_market_at_boundary() {
    // Parity check: admin_settle at-strike must decide Yes, same as settle_market.
    let mut f = setup(5 * ONE);
    let market = open_market(&mut f);
    set_clock(&mut f.svm, CLOSE + ONE_HOUR + 10);

    let admin = f.admin.insecure_clone();
    let ix = ix_admin_settle(&f.admin.pubkey(), &market, STRIKE); // exactly at strike
    send(&mut f.svm, &f.admin.pubkey(), ix, &[&admin]).expect("admin settle at strike");

    let m = read_market(&f.svm, &market);
    assert_eq!(m.outcome, Outcome::YesWins, "at-strike → Yes (parity)");
}

#[test]
fn admin_settle_rejects_zero_price() {
    // A stock close is never $0; reject it (guards a fat-finger / compromised-key
    // all-NoWins settlement).
    let mut f = setup(5 * ONE);
    let market = open_market(&mut f);
    set_clock(&mut f.svm, CLOSE + ONE_HOUR + 10);

    let admin = f.admin.insecure_clone();
    let ix = ix_admin_settle(&f.admin.pubkey(), &market, 0);
    assert!(
        send(&mut f.svm, &f.admin.pubkey(), ix, &[&admin]).is_err(),
        "zero settlement price must be rejected"
    );
    assert_eq!(read_market(&f.svm, &market).state, MarketState::Open);
}

#[test]
fn admin_settle_idempotent_after_oracle_settle() {
    // Oracle path settles first; a later admin_settle with a flipping price is a no-op.
    let mut f = setup(5 * ONE);
    let market = open_market(&mut f);
    set_clock(&mut f.svm, CLOSE + 10);

    let pu = seed_price_update(
        &mut f.svm,
        test_feed_id(Ticker::Meta),
        700_00000000, // $700 at -8
        1_000,
        -8,
        CLOSE + 5,
    );
    let cranker = f.user.insecure_clone();
    let ix = ix_settle_market(&f.user.pubkey(), &market, &pu);
    send(&mut f.svm, &f.user.pubkey(), ix, &[&cranker]).expect("oracle settle");
    let after_oracle = read_market(&f.svm, &market);
    assert_eq!(after_oracle.outcome, Outcome::YesWins);

    // Now warp past the override delay and try admin_settle with $600 (would flip).
    set_clock(&mut f.svm, CLOSE + ONE_HOUR + 10);
    let admin = f.admin.insecure_clone();
    let ix2 = ix_admin_settle(&f.admin.pubkey(), &market, 600_000_000);
    send(&mut f.svm, &f.admin.pubkey(), ix2, &[&admin]).expect("admin settle is a safe no-op");

    let m = read_market(&f.svm, &market);
    assert_eq!(m.outcome, Outcome::YesWins, "oracle outcome not overwritten");
    assert_eq!(m.settlement_price, after_oracle.settlement_price, "price immutable");
}
