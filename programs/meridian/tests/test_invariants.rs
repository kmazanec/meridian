//! Invariant sweep (LiteSVM) — ARCHITECTURE.md §7.
//!
//! Proves the collateralization invariant holds across interleaved mint/redeem,
//! the full mint → settle → redeem cycle conserves value, and the payout side
//! is correct. The original F-02 cases shim settlement (`force_settle`); the
//! payout-completeness sweep (F-04, invariant 2) settles via the *real*
//! `settle_market` instruction so the invariant is proven end-to-end.

mod common;

use {
    common::*,
    meridian::{instructions::RedeemSide, state::{Outcome, Ticker}},
    solana_signer::Signer,
};

const DAY: i64 = 1_747_000_000;
const STRIKE: u64 = 680_000_000;
const ONE: u64 = 1_000_000;

/// $1.00 in base units — a winning token pays exactly this; loser pays $0; so
/// `Yes_payout + No_payout` per pair must equal `PAYOFF_UNIT` (invariant 2).
const PAYOFF_UNIT: u64 = 1_000_000;

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
fn double_redeem_rejected() {
    // Redeem all winning tokens, then attempt to redeem again — the second call
    // must fail (no tokens left to burn). Proves burn-before-pay defeats double-spend.
    let mut f = setup(5 * ONE);
    let admin = f.admin.insecure_clone();
    let user = f.user.insecure_clone();
    let ix = ix_create_strike_market(&f.admin.pubkey(), &f.usdc_mint, Ticker::Meta, STRIKE, DAY);
    send(&mut f.svm, &f.admin.pubkey(), ix, &[&admin]).expect("create");
    let market = market_pda(Ticker::Meta, STRIKE, DAY).0;
    let ix = ix_mint_pair(&f.user.pubkey(), &f.usdc_mint, &market);
    send(&mut f.svm, &f.user.pubkey(), ix, &[&user]).expect("mint");
    force_settle(&mut f.svm, &market, Outcome::YesWins);

    let (yes_mint, _) = yes_mint_pda(&market);
    let user_yes = ata(&f.user.pubkey(), &yes_mint);
    let user_usdc = ata(&f.user.pubkey(), &f.usdc_mint);
    let (vault, _) = vault_pda(&market);

    let ix = ix_redeem(&f.user.pubkey(), &market, RedeemSide::Yes, ONE, &user_yes, &user_usdc);
    send(&mut f.svm, &f.user.pubkey(), ix, &[&user]).expect("first redeem ok");
    assert_eq!(token_balance(&f.svm, &vault), 0, "vault drained exactly once");

    // Second redeem of the same (now-zero) position must fail.
    let ix = ix_redeem(&f.user.pubkey(), &market, RedeemSide::Yes, ONE, &user_yes, &user_usdc);
    let res = send(&mut f.svm, &f.user.pubkey(), ix, &[&user]);
    assert!(res.is_err(), "double-redeem must be rejected");
}

#[test]
fn cross_market_vault_substitution_rejected() {
    // Mint+settle in market A; try to redeem A's winning tokens but pass market B's
    // vault. The `has_one = vault` binding on market A must reject the foreign vault.
    let mut f = setup(10 * ONE);
    let admin = f.admin.insecure_clone();
    let user = f.user.insecure_clone();

    // Market A (META @ $680) and Market B (META @ $700) share the USDC mint.
    let ixa = ix_create_strike_market(&f.admin.pubkey(), &f.usdc_mint, Ticker::Meta, STRIKE, DAY);
    send(&mut f.svm, &f.admin.pubkey(), ixa, &[&admin]).expect("create A");
    let ixb = ix_create_strike_market(&f.admin.pubkey(), &f.usdc_mint, Ticker::Meta, 700_000_000, DAY);
    send(&mut f.svm, &f.admin.pubkey(), ixb, &[&admin]).expect("create B");
    let market_a = market_pda(Ticker::Meta, STRIKE, DAY).0;
    let market_b = market_pda(Ticker::Meta, 700_000_000, DAY).0;

    // Fund vault B by minting there too (so it has collateral to steal).
    let ix = ix_mint_pair(&f.user.pubkey(), &f.usdc_mint, &market_b);
    send(&mut f.svm, &f.user.pubkey(), ix, &[&user]).expect("mint B");
    // Mint + settle A (Yes wins).
    let ix = ix_mint_pair(&f.user.pubkey(), &f.usdc_mint, &market_a);
    send(&mut f.svm, &f.user.pubkey(), ix, &[&user]).expect("mint A");
    force_settle(&mut f.svm, &market_a, Outcome::YesWins);

    // Hand-build a redeem against market A but with market B's vault substituted.
    use anchor_lang::{solana_program::instruction::Instruction, InstructionData, ToAccountMetas};
    let (yes_mint_a, _) = yes_mint_pda(&market_a);
    let (no_mint_a, _) = no_mint_pda(&market_a);
    let (mint_auth_a, _) = mint_authority_pda(&market_a);
    let (vault_b, _) = vault_pda(&market_b); // FOREIGN vault
    let user_yes_a = ata(&f.user.pubkey(), &yes_mint_a);
    let user_usdc = ata(&f.user.pubkey(), &f.usdc_mint);

    let ix = Instruction::new_with_bytes(
        meridian::id(),
        &meridian::instruction::Redeem { side: RedeemSide::Yes, amount: ONE }.data(),
        meridian::accounts::Redeem {
            user: f.user.pubkey(),
            market: market_a,
            mint_authority: mint_auth_a,
            yes_mint: yes_mint_a,
            no_mint: no_mint_a,
            vault: vault_b, // substituted!
            user_tokens: user_yes_a,
            user_usdc,
            token_program: token_program_id(),
        }
        .to_account_metas(None),
    );
    let res = send(&mut f.svm, &f.user.pubkey(), ix, &[&user]);
    assert!(res.is_err(), "redeeming against a foreign vault must be rejected");
}

/// Payout-completeness invariant (ARCHITECTURE §7.2, owned by F-04): for a
/// settled market, `Yes_payout + No_payout == $1.00` per pair, for every price —
/// including the at-strike boundary. Settles via the **real** `settle_market`
/// (exponent -8 Pyth fixture), then redeems both sides and checks the sum.
fn payout_completeness_at(price_usdc_6dp: u64, expect: Outcome) {
    const CLOSE: i64 = 1_747_000_000;
    let mut f = setup(5 * ONE);
    let admin = f.admin.insecure_clone();
    let user = f.user.insecure_clone();

    let ix = ix_create_strike_market(&f.admin.pubkey(), &f.usdc_mint, Ticker::Meta, STRIKE, CLOSE);
    send(&mut f.svm, &f.admin.pubkey(), ix, &[&admin]).expect("create");
    let market = market_pda(Ticker::Meta, STRIKE, CLOSE).0;

    // Mint 1 pair: user holds 1.0 Yes + 1.0 No, vault holds $1.
    let ix = ix_mint_pair(&f.user.pubkey(), &f.usdc_mint, &market);
    send(&mut f.svm, &f.user.pubkey(), ix, &[&user]).expect("mint");

    // Settle for real at the given price (native = base-units × 100 at expo -8).
    set_clock(&mut f.svm, CLOSE + 10);
    let pu = seed_price_update(
        &mut f.svm,
        test_feed_id(Ticker::Meta),
        (price_usdc_6dp as i64) * 100,
        1_000,
        -8,
        CLOSE + 5,
    );
    let cranker = f.user.insecure_clone();
    let ix = ix_settle_market(&f.user.pubkey(), &market, &pu);
    send(&mut f.svm, &f.user.pubkey(), ix, &[&cranker]).expect("settle");
    assert_eq!(read_market(&f.svm, &market).outcome, expect, "outcome at price");

    // Redeem both sides; measure USDC paid for each.
    let (yes_mint, _) = yes_mint_pda(&market);
    let (no_mint, _) = no_mint_pda(&market);
    let user_usdc = ata(&f.user.pubkey(), &f.usdc_mint);

    let before = token_balance(&f.svm, &user_usdc);
    let ix = ix_redeem(&f.user.pubkey(), &market, RedeemSide::Yes, ONE, &ata(&f.user.pubkey(), &yes_mint), &user_usdc);
    send(&mut f.svm, &f.user.pubkey(), ix, &[&user]).expect("redeem yes");
    let yes_payout = token_balance(&f.svm, &user_usdc) - before;

    let before = token_balance(&f.svm, &user_usdc);
    let ix = ix_redeem(&f.user.pubkey(), &market, RedeemSide::No, ONE, &ata(&f.user.pubkey(), &no_mint), &user_usdc);
    send(&mut f.svm, &f.user.pubkey(), ix, &[&user]).expect("redeem no");
    let no_payout = token_balance(&f.svm, &user_usdc) - before;

    assert_eq!(
        yes_payout + no_payout,
        PAYOFF_UNIT,
        "Yes_payout({yes_payout}) + No_payout({no_payout}) must equal $1.00 at price {price_usdc_6dp}"
    );
    // The winner takes the whole dollar; the loser gets nothing.
    match expect {
        Outcome::YesWins => assert_eq!((yes_payout, no_payout), (PAYOFF_UNIT, 0)),
        Outcome::NoWins => assert_eq!((yes_payout, no_payout), (0, PAYOFF_UNIT)),
        Outcome::Unsettled => unreachable!(),
    }
}

#[test]
fn payout_completeness_above_strike() {
    payout_completeness_at(700_000_000, Outcome::YesWins);
}

#[test]
fn payout_completeness_below_strike() {
    payout_completeness_at(660_000_000, Outcome::NoWins);
}

#[test]
fn payout_completeness_at_strike_boundary() {
    // The genuinely tricky case: price exactly == strike. At-or-above → Yes.
    payout_completeness_at(STRIKE, Outcome::YesWins);
}

#[test]
fn payout_completeness_one_unit_each_side_of_strike() {
    payout_completeness_at(STRIKE + 1, Outcome::YesWins);
    payout_completeness_at(STRIKE - 1, Outcome::NoWins);
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
