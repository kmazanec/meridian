//! F-02 tests for `mint_pair` (LiteSVM).

mod common;

use {common::*, meridian::state::Ticker, solana_signer::Signer};

const DAY: i64 = 1_747_000_000;
const STRIKE: u64 = 680_000_000;
const ONE: u64 = 1_000_000; // PAYOFF_UNIT

fn create_market(f: &mut Fixture) -> solana_pubkey::Pubkey {
    let admin = f.admin.insecure_clone();
    let ix = ix_create_strike_market(&f.admin.pubkey(), &f.usdc_mint, Ticker::Meta, STRIKE, DAY);
    send(&mut f.svm, &f.admin.pubkey(), ix, &[&admin]).expect("create");
    market_pda(Ticker::Meta, STRIKE, DAY).0
}

#[test]
fn mint_happy_path() {
    let mut f = setup(5 * ONE); // user has $5 USDC
    let market = create_market(&mut f);
    let user = f.user.insecure_clone();

    let ix = ix_mint_pair(&f.user.pubkey(), &f.usdc_mint, &market);
    send(&mut f.svm, &f.user.pubkey(), ix, &[&user]).expect("mint_pair should succeed");

    let (yes_mint, _) = yes_mint_pda(&market);
    let (no_mint, _) = no_mint_pda(&market);
    let (vault, _) = vault_pda(&market);

    // User received 1.0 Yes + 1.0 No.
    assert_eq!(token_balance(&f.svm, &ata(&f.user.pubkey(), &yes_mint)), ONE, "1 Yes");
    assert_eq!(token_balance(&f.svm, &ata(&f.user.pubkey(), &no_mint)), ONE, "1 No");
    // Vault holds $1; user paid $1 (5 - 1 = 4 left).
    assert_eq!(token_balance(&f.svm, &vault), ONE, "vault has $1");
    assert_eq!(token_balance(&f.svm, &ata(&f.user.pubkey(), &f.usdc_mint)), 4 * ONE, "user paid $1");
    // pairs_minted incremented.
    assert_eq!(read_market(&f.svm, &market).pairs_minted, 1);
}

#[test]
fn mint_multiple_keeps_invariant() {
    let mut f = setup(5 * ONE);
    let market = create_market(&mut f);
    let user = f.user.insecure_clone();
    let (vault, _) = vault_pda(&market);

    for n in 1..=3u64 {
        let ix = ix_mint_pair(&f.user.pubkey(), &f.usdc_mint, &market);
        send(&mut f.svm, &f.user.pubkey(), ix, &[&user]).expect("mint");
        // Collateralization invariant: vault == PAYOFF_UNIT * pairs_minted.
        let m = read_market(&f.svm, &market);
        assert_eq!(m.pairs_minted, n);
        assert_eq!(token_balance(&f.svm, &vault), n * ONE, "vault == 1e6 * pairs_minted");
    }
}

#[test]
fn mint_rejected_when_paused() {
    let mut f = setup(5 * ONE);
    let market = create_market(&mut f);
    set_paused(&mut f.svm, true);
    let user = f.user.insecure_clone();

    let ix = ix_mint_pair(&f.user.pubkey(), &f.usdc_mint, &market);
    let res = send(&mut f.svm, &f.user.pubkey(), ix, &[&user]);
    assert!(res.is_err(), "mint must be rejected when paused");
}

#[test]
fn mint_rejected_when_settled() {
    let mut f = setup(5 * ONE);
    let market = create_market(&mut f);
    force_settle(&mut f.svm, &market, meridian::state::Outcome::YesWins);
    let user = f.user.insecure_clone();

    let ix = ix_mint_pair(&f.user.pubkey(), &f.usdc_mint, &market);
    let res = send(&mut f.svm, &f.user.pubkey(), ix, &[&user]);
    assert!(res.is_err(), "mint must be rejected on a settled market");
}

#[test]
fn mint_rejected_insufficient_usdc() {
    let mut f = setup(ONE / 2); // only $0.50
    let market = create_market(&mut f);
    let user = f.user.insecure_clone();

    let ix = ix_mint_pair(&f.user.pubkey(), &f.usdc_mint, &market);
    let res = send(&mut f.svm, &f.user.pubkey(), ix, &[&user]);
    assert!(res.is_err(), "mint must fail without enough USDC");
}
