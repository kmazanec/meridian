//! F-02 tests for `create_strike_market` (LiteSVM).

mod common;

use {
    common::*,
    meridian::state::{MarketState, Outcome, Ticker},
    solana_program_option::COption,
    solana_program_pack::Pack,
    solana_signer::Signer,
    spl_token_interface::state::Mint as SplMint,
};

const DAY: i64 = 1_747_000_000;

#[test]
fn create_happy_path() {
    let mut f = setup(0);
    let strike = 680_000_000; // $680.00

    let ix = ix_create_strike_market(&f.admin.pubkey(), &f.usdc_mint, Ticker::Meta, strike, DAY);
    let admin = f.admin.insecure_clone();
    send(&mut f.svm, &f.admin.pubkey(), ix, &[&admin]).expect("create should succeed");

    let (market_key, _) = market_pda(Ticker::Meta, strike, DAY);
    let m = read_market(&f.svm, &market_key);
    assert_eq!(m.ticker, Ticker::Meta);
    assert_eq!(m.strike, strike);
    assert_eq!(m.trading_day, DAY);
    assert_eq!(m.state, MarketState::Open);
    assert_eq!(m.outcome, Outcome::Unsettled);
    assert_eq!(m.pairs_minted, 0);

    // Mints exist with 6 decimals and the PDA mint authority.
    let (mint_auth, _) = mint_authority_pda(&market_key);
    let (yes_mint, _) = yes_mint_pda(&market_key);
    let yes_acct = f.svm.get_account(&yes_mint).expect("yes mint created");
    let yes = SplMint::unpack(&yes_acct.data[..SplMint::LEN]).unwrap();
    assert_eq!(yes.decimals, 6, "yes mint 6 decimals");
    assert_eq!(
        yes.mint_authority,
        COption::Some(mint_auth),
        "yes mint authority is the market PDA"
    );
    assert!(
        yes.freeze_authority.is_some(),
        "yes mint has a freeze authority (the PDA)"
    );
}

#[test]
fn create_rejects_non_admin() {
    let mut f = setup(0);
    let imposter = f.user.insecure_clone(); // user is not the admin
    let ix = ix_create_strike_market(&imposter.pubkey(), &f.usdc_mint, Ticker::Meta, 680_000_000, DAY);
    let res = send(&mut f.svm, &imposter.pubkey(), ix, &[&imposter]);
    assert!(res.is_err(), "non-admin must be rejected");
}

#[test]
fn create_rejects_zero_strike() {
    let mut f = setup(0);
    let admin = f.admin.insecure_clone();
    let ix = ix_create_strike_market(&f.admin.pubkey(), &f.usdc_mint, Ticker::Meta, 0, DAY);
    let res = send(&mut f.svm, &f.admin.pubkey(), ix, &[&admin]);
    assert!(res.is_err(), "zero strike must be rejected");
}

#[test]
fn create_rejects_duplicate() {
    let mut f = setup(0);
    let admin = f.admin.insecure_clone();
    let strike = 700_000_000;
    let ix1 = ix_create_strike_market(&f.admin.pubkey(), &f.usdc_mint, Ticker::Meta, strike, DAY);
    send(&mut f.svm, &f.admin.pubkey(), ix1, &[&admin]).expect("first create ok");
    let ix2 = ix_create_strike_market(&f.admin.pubkey(), &f.usdc_mint, Ticker::Meta, strike, DAY);
    let res = send(&mut f.svm, &f.admin.pubkey(), ix2, &[&admin]);
    assert!(res.is_err(), "duplicate market must be rejected");
}

#[test]
fn create_rejects_wrong_usdc_mint() {
    let mut f = setup(0);
    let admin = f.admin.insecure_clone();
    // A different mint, not Config.usdc_mint.
    let wrong_mint = solana_pubkey::Pubkey::new_unique();
    seed_mint(&mut f.svm, &wrong_mint, 6, None);
    let ix = ix_create_strike_market(&f.admin.pubkey(), &wrong_mint, Ticker::Meta, 680_000_000, DAY);
    let res = send(&mut f.svm, &f.admin.pubkey(), ix, &[&admin]);
    assert!(res.is_err(), "wrong USDC mint must be rejected");
}
