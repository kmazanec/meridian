//! Tests for `settle_market` (LiteSVM).
//!
//! Exercises the real settlement instruction end to end: timing gate, oracle
//! validation (feed match / staleness / confidence), the outcome decision incl.
//! the at-strike boundary, exponent scaling, and idempotency.

mod common;

use {
    common::*,
    meridian::state::{MarketState, Outcome, Ticker},
    solana_signer::Signer,
};

const STRIKE: u64 = 680_000_000; // $680.00 in 6-dp USDC base units
const ONE: u64 = 1_000_000;
// Market close instant; the clock is warped at/after this for valid settles.
const CLOSE: i64 = 1_747_000_000;
const EXPO: i32 = -8; // typical Pyth equity exponent

/// Create a Meta market closing at `CLOSE`. Returns the market key.
fn open_market(f: &mut Fixture) -> solana_pubkey::Pubkey {
    let admin = f.admin.insecure_clone();
    let ix = ix_create_strike_market(&f.admin.pubkey(), &f.usdc_mint, Ticker::Meta, STRIKE, CLOSE);
    send(&mut f.svm, &f.admin.pubkey(), ix, &[&admin]).expect("create market");
    market_pda(Ticker::Meta, STRIKE, CLOSE).0
}

/// Native-scale price (exponent -8) for a dollar value given in 6-dp base units.
/// e.g. $700.00 = 700_000000 base units → 700_00000000 native at -8.
fn native_at_expo(usdc_base_units: u64) -> i64 {
    // base units are 6dp; native is 8dp → multiply by 10^2.
    (usdc_base_units as i64) * 100
}

#[test]
fn settles_yes_when_price_above_strike() {
    let mut f = setup(5 * ONE);
    let market = open_market(&mut f);
    set_clock(&mut f.svm, CLOSE + 10);

    let pu = seed_price_update(
        &mut f.svm,
        test_feed_id(Ticker::Meta),
        native_at_expo(700_000_000), // $700 > $680
        1_000,                       // tiny conf
        EXPO,
        CLOSE + 5,
    );
    let cranker = f.user.insecure_clone();
    let ix = ix_settle_market(&f.user.pubkey(), &market, &pu);
    send(&mut f.svm, &f.user.pubkey(), ix, &[&cranker]).expect("settle");

    let m = read_market(&f.svm, &market);
    assert_eq!(m.state, MarketState::Settled);
    assert_eq!(m.outcome, Outcome::YesWins);
    assert_eq!(m.settlement_price, Some(700_000_000));
}

#[test]
fn settles_no_when_price_below_strike() {
    let mut f = setup(5 * ONE);
    let market = open_market(&mut f);
    set_clock(&mut f.svm, CLOSE + 10);

    let pu = seed_price_update(
        &mut f.svm,
        test_feed_id(Ticker::Meta),
        native_at_expo(660_000_000), // $660 < $680
        1_000,
        EXPO,
        CLOSE + 5,
    );
    let cranker = f.user.insecure_clone();
    let ix = ix_settle_market(&f.user.pubkey(), &market, &pu);
    send(&mut f.svm, &f.user.pubkey(), ix, &[&cranker]).expect("settle");

    let m = read_market(&f.svm, &market);
    assert_eq!(m.outcome, Outcome::NoWins);
    assert_eq!(m.settlement_price, Some(660_000_000));
}

#[test]
fn at_strike_boundary_yes_wins() {
    // price exactly == strike → Yes wins (ARCHITECTURE §7: at-or-above → Yes).
    let mut f = setup(5 * ONE);
    let market = open_market(&mut f);
    set_clock(&mut f.svm, CLOSE + 10);

    let pu = seed_price_update(
        &mut f.svm,
        test_feed_id(Ticker::Meta),
        native_at_expo(STRIKE), // exactly $680
        1_000,
        EXPO,
        CLOSE + 5,
    );
    let cranker = f.user.insecure_clone();
    let ix = ix_settle_market(&f.user.pubkey(), &market, &pu);
    send(&mut f.svm, &f.user.pubkey(), ix, &[&cranker]).expect("settle at strike");

    let m = read_market(&f.svm, &market);
    assert_eq!(m.outcome, Outcome::YesWins);
    assert_eq!(m.settlement_price, Some(STRIKE));
}

#[test]
fn rejects_before_close() {
    let mut f = setup(5 * ONE);
    let market = open_market(&mut f);
    set_clock(&mut f.svm, CLOSE - 1); // one second before close

    let pu = seed_price_update(
        &mut f.svm,
        test_feed_id(Ticker::Meta),
        native_at_expo(700_000_000),
        1_000,
        EXPO,
        CLOSE - 1,
    );
    let cranker = f.user.insecure_clone();
    let ix = ix_settle_market(&f.user.pubkey(), &market, &pu);
    assert!(
        send(&mut f.svm, &f.user.pubkey(), ix, &[&cranker]).is_err(),
        "settling before close must be rejected"
    );
    assert_eq!(read_market(&f.svm, &market).state, MarketState::Open);
}

#[test]
fn rejects_stale_price() {
    let mut f = setup(5 * ONE);
    let market = open_market(&mut f);
    set_clock(&mut f.svm, CLOSE + 10_000); // far past close

    // publish_time well older than DEFAULT_MAX_STALENESS (120s).
    let pu = seed_price_update(
        &mut f.svm,
        test_feed_id(Ticker::Meta),
        native_at_expo(700_000_000),
        1_000,
        EXPO,
        CLOSE, // ~10_000s old relative to clock
    );
    let cranker = f.user.insecure_clone();
    let ix = ix_settle_market(&f.user.pubkey(), &market, &pu);
    assert!(
        send(&mut f.svm, &f.user.pubkey(), ix, &[&cranker]).is_err(),
        "stale price must be rejected"
    );
    assert_eq!(read_market(&f.svm, &market).state, MarketState::Open);
}

#[test]
fn rejects_wide_confidence() {
    let mut f = setup(5 * ONE);
    let market = open_market(&mut f);
    set_clock(&mut f.svm, CLOSE + 10);

    // conf = 5% of price → 500 bps > MAX_CONFIDENCE_BPS (100).
    let price = native_at_expo(700_000_000);
    let pu = seed_price_update(
        &mut f.svm,
        test_feed_id(Ticker::Meta),
        price,
        (price as u64) / 20, // 5%
        EXPO,
        CLOSE + 5,
    );
    let cranker = f.user.insecure_clone();
    let ix = ix_settle_market(&f.user.pubkey(), &market, &pu);
    assert!(
        send(&mut f.svm, &f.user.pubkey(), ix, &[&cranker]).is_err(),
        "wide confidence must be rejected"
    );
    assert_eq!(read_market(&f.svm, &market).state, MarketState::Open);
}

#[test]
fn rejects_wrong_feed() {
    let mut f = setup(5 * ONE);
    let market = open_market(&mut f);
    set_clock(&mut f.svm, CLOSE + 10);

    // A valid-looking update but for a *different* ticker's feed id.
    let pu = seed_price_update(
        &mut f.svm,
        test_feed_id(Ticker::Aapl), // wrong feed (market is Meta)
        native_at_expo(700_000_000),
        1_000,
        EXPO,
        CLOSE + 5,
    );
    let cranker = f.user.insecure_clone();
    let ix = ix_settle_market(&f.user.pubkey(), &market, &pu);
    assert!(
        send(&mut f.svm, &f.user.pubkey(), ix, &[&cranker]).is_err(),
        "mismatched feed id must be rejected"
    );
    assert_eq!(read_market(&f.svm, &market).state, MarketState::Open);
}

#[test]
fn rejects_non_receiver_owned_account() {
    let mut f = setup(5 * ONE);
    let market = open_market(&mut f);
    set_clock(&mut f.svm, CLOSE + 10);

    // Seed an account with the right bytes but the WRONG owner (not the receiver).
    // Reuse the USDC-mint key as a stand-in non-receiver account.
    let bogus = f.usdc_mint;
    let cranker = f.user.insecure_clone();
    let ix = ix_settle_market(&f.user.pubkey(), &market, &bogus);
    assert!(
        send(&mut f.svm, &f.user.pubkey(), ix, &[&cranker]).is_err(),
        "price-update account not owned by the receiver must be rejected"
    );
}

#[test]
fn rejects_partial_verification() {
    // A Partial{num_signatures:1} update is a real receiver-owned account but
    // clears a far lower guardian-collusion bar; settlement must reject it.
    let mut f = setup(5 * ONE);
    let market = open_market(&mut f);
    set_clock(&mut f.svm, CLOSE + 10);

    let pu = seed_price_update_verified(
        &mut f.svm,
        test_feed_id(Ticker::Meta),
        native_at_expo(700_000_000),
        1_000,
        EXPO,
        CLOSE + 5,
        false, // Partial verification
    );
    let cranker = f.user.insecure_clone();
    let ix = ix_settle_market(&f.user.pubkey(), &market, &pu);
    assert!(
        send(&mut f.svm, &f.user.pubkey(), ix, &[&cranker]).is_err(),
        "partially-verified price update must be rejected"
    );
    assert_eq!(read_market(&f.svm, &market).state, MarketState::Open);
}

#[test]
fn rejects_wrong_discriminator() {
    // An account owned by the receiver but whose first 8 bytes are not the
    // PriceUpdateV2 discriminator (e.g. some other receiver account type).
    let mut f = setup(5 * ONE);
    let market = open_market(&mut f);
    set_clock(&mut f.svm, CLOSE + 10);

    let pu = seed_price_update(
        &mut f.svm,
        test_feed_id(Ticker::Meta),
        native_at_expo(700_000_000),
        1_000,
        EXPO,
        CLOSE + 5,
    );
    // Corrupt the discriminator in-place.
    let mut acct = f.svm.get_account(&pu).unwrap();
    acct.data[0] ^= 0xFF;
    f.svm.set_account(pu, acct).unwrap();

    let cranker = f.user.insecure_clone();
    let ix = ix_settle_market(&f.user.pubkey(), &market, &pu);
    assert!(
        send(&mut f.svm, &f.user.pubkey(), ix, &[&cranker]).is_err(),
        "non-PriceUpdateV2 account must be rejected"
    );
    assert_eq!(read_market(&f.svm, &market).state, MarketState::Open);
}

#[test]
fn idempotent_resettle_is_noop() {
    let mut f = setup(5 * ONE);
    let market = open_market(&mut f);
    set_clock(&mut f.svm, CLOSE + 10);

    // First settle: Yes wins at $700.
    let pu1 = seed_price_update(
        &mut f.svm,
        test_feed_id(Ticker::Meta),
        native_at_expo(700_000_000),
        1_000,
        EXPO,
        CLOSE + 5,
    );
    let cranker = f.user.insecure_clone();
    let ix1 = ix_settle_market(&f.user.pubkey(), &market, &pu1);
    send(&mut f.svm, &f.user.pubkey(), ix1, &[&cranker]).expect("first settle");
    let first = read_market(&f.svm, &market);
    assert_eq!(first.outcome, Outcome::YesWins);

    // Second settle with a price that WOULD flip the outcome ($600 < strike).
    // Must be a no-op: outcome and settlement_price are immutable.
    let pu2 = seed_price_update(
        &mut f.svm,
        test_feed_id(Ticker::Meta),
        native_at_expo(600_000_000),
        1_000,
        EXPO,
        CLOSE + 6,
    );
    let ix2 = ix_settle_market(&f.user.pubkey(), &market, &pu2);
    send(&mut f.svm, &f.user.pubkey(), ix2, &[&cranker]).expect("second settle is a safe no-op");

    let second = read_market(&f.svm, &market);
    assert_eq!(second.outcome, Outcome::YesWins, "outcome unchanged");
    assert_eq!(
        second.settlement_price, first.settlement_price,
        "settlement_price immutable"
    );
    assert_eq!(second.settled_at, first.settled_at, "settled_at immutable");
}

#[test]
fn exponent_scaling_minus_5() {
    // Prove a non -8 exponent scales correctly: exponent -5, $700.00 = 70_000_000
    // native (700 * 10^5)... settlement_price must still be 700_000_000 (6dp).
    let mut f = setup(5 * ONE);
    let market = open_market(&mut f);
    set_clock(&mut f.svm, CLOSE + 10);

    let pu = seed_price_update(
        &mut f.svm,
        test_feed_id(Ticker::Meta),
        70_000_000, // $700.00 at exponent -5
        1,
        -5,
        CLOSE + 5,
    );
    let cranker = f.user.insecure_clone();
    let ix = ix_settle_market(&f.user.pubkey(), &market, &pu);
    send(&mut f.svm, &f.user.pubkey(), ix, &[&cranker]).expect("settle expo -5");

    let m = read_market(&f.svm, &market);
    assert_eq!(m.settlement_price, Some(700_000_000));
    assert_eq!(m.outcome, Outcome::YesWins);
}
