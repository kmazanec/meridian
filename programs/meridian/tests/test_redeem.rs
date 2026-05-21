//! F-02 tests for `redeem` (LiteSVM).
//!
//! Settlement is F-04, so these tests use the `force_settle` shim to set the
//! market's outcome before redeeming.

mod common;

use {
    common::*,
    meridian::{
        instructions::RedeemSide,
        state::{Outcome, Ticker},
    },
    solana_signer::Signer,
};

const DAY: i64 = 1_747_000_000;
const STRIKE: u64 = 680_000_000;
const ONE: u64 = 1_000_000;

/// Create a market and have the user mint `pairs` pairs. Returns the market key.
fn market_with_mints(f: &mut Fixture, pairs: u64) -> solana_pubkey::Pubkey {
    let admin = f.admin.insecure_clone();
    let user = f.user.insecure_clone();
    let ix = ix_create_strike_market(&f.admin.pubkey(), &f.usdc_mint, Ticker::Meta, STRIKE, DAY);
    send(&mut f.svm, &f.admin.pubkey(), ix, &[&admin]).expect("create");
    let market = market_pda(Ticker::Meta, STRIKE, DAY).0;
    for _ in 0..pairs {
        let ix = ix_mint_pair(&f.user.pubkey(), &f.usdc_mint, &market);
        send(&mut f.svm, &f.user.pubkey(), ix, &[&user]).expect("mint");
    }
    market
}

#[test]
fn redeem_winning_yes_pays_one_per_token() {
    let mut f = setup(5 * ONE);
    let market = market_with_mints(&mut f, 2); // 2.0 Yes + 2.0 No, vault $2
    force_settle(&mut f.svm, &market, Outcome::YesWins);

    let user = f.user.insecure_clone();
    let (yes_mint, _) = yes_mint_pda(&market);
    let user_yes = ata(&f.user.pubkey(), &yes_mint);
    let user_usdc = ata(&f.user.pubkey(), &f.usdc_mint);

    let usdc_before = token_balance(&f.svm, &user_usdc);
    let ix = ix_redeem(
        &f.user.pubkey(),
        &market,
        RedeemSide::Yes,
        2 * ONE,
        &user_yes,
        &user_usdc,
    );
    send(&mut f.svm, &f.user.pubkey(), ix, &[&user]).expect("redeem winning Yes");

    assert_eq!(token_balance(&f.svm, &user_yes), 0, "Yes tokens burned");
    assert_eq!(
        token_balance(&f.svm, &user_usdc),
        usdc_before + 2 * ONE,
        "paid $2"
    );
}

#[test]
fn redeem_losing_no_pays_zero() {
    let mut f = setup(5 * ONE);
    let market = market_with_mints(&mut f, 2);
    force_settle(&mut f.svm, &market, Outcome::YesWins); // No loses

    let user = f.user.insecure_clone();
    let (no_mint, _) = no_mint_pda(&market);
    let user_no = ata(&f.user.pubkey(), &no_mint);
    let user_usdc = ata(&f.user.pubkey(), &f.usdc_mint);

    let usdc_before = token_balance(&f.svm, &user_usdc);
    let ix = ix_redeem(
        &f.user.pubkey(),
        &market,
        RedeemSide::No,
        2 * ONE,
        &user_no,
        &user_usdc,
    );
    send(&mut f.svm, &f.user.pubkey(), ix, &[&user]).expect("redeem losing No (burns for $0)");

    assert_eq!(token_balance(&f.svm, &user_no), 0, "No tokens burned");
    assert_eq!(
        token_balance(&f.svm, &user_usdc),
        usdc_before,
        "no payout for losing side"
    );
}

#[test]
fn redeem_no_wins_case() {
    let mut f = setup(5 * ONE);
    let market = market_with_mints(&mut f, 1);
    force_settle(&mut f.svm, &market, Outcome::NoWins);

    let user = f.user.insecure_clone();
    let (no_mint, _) = no_mint_pda(&market);
    let user_no = ata(&f.user.pubkey(), &no_mint);
    let user_usdc = ata(&f.user.pubkey(), &f.usdc_mint);

    let usdc_before = token_balance(&f.svm, &user_usdc);
    let ix = ix_redeem(
        &f.user.pubkey(),
        &market,
        RedeemSide::No,
        ONE,
        &user_no,
        &user_usdc,
    );
    send(&mut f.svm, &f.user.pubkey(), ix, &[&user]).expect("redeem winning No");
    assert_eq!(
        token_balance(&f.svm, &user_usdc),
        usdc_before + ONE,
        "No wins pays $1"
    );
}

#[test]
fn redeem_partial_then_rest() {
    let mut f = setup(5 * ONE);
    let market = market_with_mints(&mut f, 3); // 3.0 Yes, vault $3
    force_settle(&mut f.svm, &market, Outcome::YesWins);

    let user = f.user.insecure_clone();
    let (yes_mint, _) = yes_mint_pda(&market);
    let user_yes = ata(&f.user.pubkey(), &yes_mint);
    let user_usdc = ata(&f.user.pubkey(), &f.usdc_mint);

    // Redeem 1.0 first.
    let ix = ix_redeem(
        &f.user.pubkey(),
        &market,
        RedeemSide::Yes,
        ONE,
        &user_yes,
        &user_usdc,
    );
    send(&mut f.svm, &f.user.pubkey(), ix, &[&user]).expect("partial redeem");
    assert_eq!(token_balance(&f.svm, &user_yes), 2 * ONE, "2 Yes left");

    // Redeem the remaining 2.0.
    let ix = ix_redeem(
        &f.user.pubkey(),
        &market,
        RedeemSide::Yes,
        2 * ONE,
        &user_yes,
        &user_usdc,
    );
    send(&mut f.svm, &f.user.pubkey(), ix, &[&user]).expect("redeem rest");
    assert_eq!(token_balance(&f.svm, &user_yes), 0, "all redeemed");
}

#[test]
fn redeem_rejected_before_settlement() {
    let mut f = setup(5 * ONE);
    let market = market_with_mints(&mut f, 1); // NOT settled

    let user = f.user.insecure_clone();
    let (yes_mint, _) = yes_mint_pda(&market);
    let user_yes = ata(&f.user.pubkey(), &yes_mint);
    let user_usdc = ata(&f.user.pubkey(), &f.usdc_mint);

    let ix = ix_redeem(
        &f.user.pubkey(),
        &market,
        RedeemSide::Yes,
        ONE,
        &user_yes,
        &user_usdc,
    );
    let res = send(&mut f.svm, &f.user.pubkey(), ix, &[&user]);
    assert!(res.is_err(), "redeem must be rejected before settlement");
}
