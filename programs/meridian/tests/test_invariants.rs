//! F-02 invariant sweep (LiteSVM) — ARCHITECTURE.md §7.
//!
//! Proves the collateralization invariant holds across interleaved mint/redeem,
//! the full mint → settle → redeem cycle conserves value, and the payout side
//! is correct. Settlement is shimmed (`force_settle`) since settle is F-04.

mod common;

use {
    common::*,
    meridian::{instructions::RedeemSide, state::{Outcome, Ticker}},
    solana_signer::Signer,
};

const DAY: i64 = 1_747_000_000;
const STRIKE: u64 = 680_000_000;
const ONE: u64 = 1_000_000;

#[test]
fn vault_tracks_collateral_through_full_cycle() {
    let mut f = setup(10 * ONE);
    let admin = f.admin.insecure_clone();
    let user = f.user.insecure_clone();

    let ix = ix_create_strike_market(&f.admin.pubkey(), &f.usdc_mint, Ticker::Meta, STRIKE, DAY);
    send(&mut f.svm, &f.admin.pubkey(), ix, &[&admin]).expect("create");
    let market = market_pda(Ticker::Meta, STRIKE, DAY).0;
    let (vault, _) = vault_pda(&market);
    let (yes_mint, _) = yes_mint_pda(&market);
    let user_yes = ata(&f.user.pubkey(), &yes_mint);
    let user_usdc = ata(&f.user.pubkey(), &f.usdc_mint);

    // Mint 4 pairs: vault should equal 1e6 * pairs_minted at each step.
    for n in 1..=4u64 {
        let ix = ix_mint_pair(&f.user.pubkey(), &f.usdc_mint, &market);
        send(&mut f.svm, &f.user.pubkey(), ix, &[&user]).expect("mint");
        assert_eq!(token_balance(&f.svm, &vault), n * ONE, "vault == 1e6 * pairs_minted");
    }
    assert_eq!(read_market(&f.svm, &market).pairs_minted, 4);
    assert_eq!(token_balance(&f.svm, &vault), 4 * ONE);

    // Settle Yes-wins, then redeem all 4 Yes -> vault drains to 0, user made whole.
    force_settle(&mut f.svm, &market, Outcome::YesWins);
    let usdc_before = token_balance(&f.svm, &user_usdc);

    let ix = ix_redeem(&f.user.pubkey(), &market, RedeemSide::Yes, 4 * ONE, &user_yes, &user_usdc);
    send(&mut f.svm, &f.user.pubkey(), ix, &[&user]).expect("redeem all");

    assert_eq!(token_balance(&f.svm, &vault), 0, "vault drained after winners redeem");
    assert_eq!(token_balance(&f.svm, &user_usdc), usdc_before + 4 * ONE, "user paid out $4");
}

#[test]
fn dollar_conservation_user_breaks_even_when_right() {
    // A user who mints and holds the winning side ends with exactly what they put in.
    let mut f = setup(3 * ONE);
    let admin = f.admin.insecure_clone();
    let user = f.user.insecure_clone();
    let start_usdc = token_balance(&f.svm, &ata(&f.user.pubkey(), &f.usdc_mint));

    let ix = ix_create_strike_market(&f.admin.pubkey(), &f.usdc_mint, Ticker::Meta, STRIKE, DAY);
    send(&mut f.svm, &f.admin.pubkey(), ix, &[&admin]).expect("create");
    let market = market_pda(Ticker::Meta, STRIKE, DAY).0;
    let (yes_mint, _) = yes_mint_pda(&market);
    let (no_mint, _) = no_mint_pda(&market);
    let user_usdc = ata(&f.user.pubkey(), &f.usdc_mint);

    // Mint 1 pair (spend $1), settle Yes-wins, redeem the Yes (get $1), burn the No ($0).
    let ix = ix_mint_pair(&f.user.pubkey(), &f.usdc_mint, &market);
    send(&mut f.svm, &f.user.pubkey(), ix, &[&user]).expect("mint");
    force_settle(&mut f.svm, &market, Outcome::YesWins);

    let ix = ix_redeem(&f.user.pubkey(), &market, RedeemSide::Yes, ONE, &ata(&f.user.pubkey(), &yes_mint), &user_usdc);
    send(&mut f.svm, &f.user.pubkey(), ix, &[&user]).expect("redeem yes");
    let ix = ix_redeem(&f.user.pubkey(), &market, RedeemSide::No, ONE, &ata(&f.user.pubkey(), &no_mint), &user_usdc);
    send(&mut f.svm, &f.user.pubkey(), ix, &[&user]).expect("burn no");

    // Holding both sides == $1 redeemable; user is exactly back to start.
    assert_eq!(token_balance(&f.svm, &user_usdc), start_usdc, "Yes+No redeem == $1, break even");
}

#[test]
fn redeem_wrong_side_account_rejected() {
    // Passing a No-token account while claiming RedeemSide::Yes must fail
    // (the handler checks the token account's mint matches the chosen side).
    let mut f = setup(3 * ONE);
    let admin = f.admin.insecure_clone();
    let user = f.user.insecure_clone();
    let ix = ix_create_strike_market(&f.admin.pubkey(), &f.usdc_mint, Ticker::Meta, STRIKE, DAY);
    send(&mut f.svm, &f.admin.pubkey(), ix, &[&admin]).expect("create");
    let market = market_pda(Ticker::Meta, STRIKE, DAY).0;
    let ix = ix_mint_pair(&f.user.pubkey(), &f.usdc_mint, &market);
    send(&mut f.svm, &f.user.pubkey(), ix, &[&user]).expect("mint");
    force_settle(&mut f.svm, &market, Outcome::YesWins);

    let (no_mint, _) = no_mint_pda(&market);
    let user_no = ata(&f.user.pubkey(), &no_mint);
    let user_usdc = ata(&f.user.pubkey(), &f.usdc_mint);
    // Claim Yes side but pass the No account.
    let ix = ix_redeem(&f.user.pubkey(), &market, RedeemSide::Yes, ONE, &user_no, &user_usdc);
    let res = send(&mut f.svm, &f.user.pubkey(), ix, &[&user]);
    assert!(res.is_err(), "mismatched side/account must be rejected");
}
