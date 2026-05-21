//! F-03 tests for the order book: init, place_order, cancel_order, match_orders
//! (LiteSVM). Mirrors the adversarial style of the F-02 suites.

mod common;

use {
    anchor_lang::Space, common::*, meridian::state::Ticker, solana_signer::Signer,
};

const DAY: i64 = 1_747_000_000;
const STRIKE: u64 = 680_000_000;
const ONE: u64 = 1_000_000; // PAYOFF_UNIT / PRICE_SCALE

// ---------------------------------------------------------------------------
// Chunk 1 — init_order_book + grow_order_book
// ---------------------------------------------------------------------------

#[test]
fn init_then_grow_wires_market_and_escrows() {
    let mut f = setup(5 * ONE);
    let admin = f.admin.insecure_clone();
    let ix = ix_create_strike_market(&f.admin.pubkey(), &f.usdc_mint, Ticker::Meta, STRIKE, DAY);
    send(&mut f.svm, &f.admin.pubkey(), ix, &[&admin]).expect("create");
    let market = market_pda(Ticker::Meta, STRIKE, DAY).0;

    // Before init: Market.order_book is the default pubkey.
    assert_eq!(
        read_market(&f.svm, &market).order_book,
        solana_pubkey::Pubkey::default(),
        "order_book unset before init"
    );

    // init: book + escrows created, but market NOT yet wired (book not full size).
    let payer = f.admin.insecure_clone();
    let ix = ix_init_order_book(&f.admin.pubkey(), &f.usdc_mint, &market);
    send(&mut f.svm, &f.admin.pubkey(), ix, &[&payer]).expect("init order book");
    assert_eq!(
        read_market(&f.svm, &market).order_book,
        solana_pubkey::Pubkey::default(),
        "market not wired until grown"
    );

    // grow: realloc to full size and wire the market.
    let ix = ix_grow_order_book(&f.admin.pubkey(), &market);
    send(&mut f.svm, &f.admin.pubkey(), ix, &[&payer]).expect("grow order book");

    let (ob_pda, _) = order_book_pda(&market);
    assert_eq!(read_market(&f.svm, &market).order_book, ob_pda, "market wired after grow");

    // OrderBook account is well-formed, empty, and at full on-chain size.
    let ob = read_order_book(&f.svm, &ob_pda);
    assert_eq!(ob.market, market, "book back-references market");
    assert_eq!(ob.next_seq, 0, "seq starts at 0");
    assert!(ob.bids.is_empty() && ob.asks.is_empty(), "book starts empty");
    let ob_acct = f.svm.get_account(&ob_pda).expect("ob account");
    assert_eq!(
        ob_acct.data.len(),
        8 + meridian::state::OrderBook::INIT_SPACE,
        "book grown to full INIT_SPACE"
    );

    // Escrow token accounts exist with the right mint and PDA authority.
    let (usdc_escrow, _) = usdc_escrow_pda(&market);
    let (yes_escrow, _) = yes_escrow_pda(&market);
    let (mint_auth, _) = mint_authority_pda(&market);
    let (yes_mint, _) = yes_mint_pda(&market);

    let ue = read_token_account(&f.svm, &usdc_escrow).expect("usdc escrow exists");
    assert_eq!(ue.mint, f.usdc_mint, "usdc escrow mint");
    assert_eq!(ue.owner, mint_auth, "usdc escrow authority is mint_auth PDA");
    assert_eq!(ue.amount, 0, "usdc escrow starts empty");

    let ye = read_token_account(&f.svm, &yes_escrow).expect("yes escrow exists");
    assert_eq!(ye.mint, yes_mint, "yes escrow mint");
    assert_eq!(ye.owner, mint_auth, "yes escrow authority is mint_auth PDA");
    assert_eq!(ye.amount, 0, "yes escrow starts empty");
}

#[test]
fn init_order_book_rejected_twice() {
    let mut f = setup(5 * ONE);
    let market = create_market_and_book(&mut f, Ticker::Meta, STRIKE, DAY);

    // Second init must fail (book PDA already exists).
    let payer = f.user.insecure_clone();
    let ix = ix_init_order_book(&f.user.pubkey(), &f.usdc_mint, &market);
    let res = send(&mut f.svm, &f.user.pubkey(), ix, &[&payer]);
    assert!(res.is_err(), "re-initializing the order book must be rejected");
}

#[test]
fn grow_order_book_rejected_twice() {
    let mut f = setup(5 * ONE);
    let market = create_market_and_book(&mut f, Ticker::Meta, STRIKE, DAY);

    // Second grow must fail (market already wired).
    let payer = f.user.insecure_clone();
    let ix = ix_grow_order_book(&f.user.pubkey(), &market);
    let res = send(&mut f.svm, &f.user.pubkey(), ix, &[&payer]);
    assert!(res.is_err(), "re-growing a wired order book must be rejected");
}

#[test]
fn init_order_book_rejected_for_unknown_market() {
    // No market created → the Market PDA doesn't exist → init must fail.
    let mut f = setup(5 * ONE);
    let market = market_pda(Ticker::Aapl, 210_000_000, DAY).0;
    let payer = f.user.insecure_clone();
    let ix = ix_init_order_book(&f.user.pubkey(), &f.usdc_mint, &market);
    let res = send(&mut f.svm, &f.user.pubkey(), ix, &[&payer]);
    assert!(res.is_err(), "init against a nonexistent market must fail");
}
