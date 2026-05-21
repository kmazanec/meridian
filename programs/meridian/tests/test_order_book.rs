//! F-03 tests for the order book: init, place_order, cancel_order, match_orders
//! (LiteSVM). Mirrors the adversarial style of the F-02 suites.

mod common;

use {
    anchor_lang::Space,
    common::*,
    meridian::state::{OrderSide, Ticker},
    solana_signer::Signer,
};

const DAY: i64 = 1_747_000_000;
const STRIKE: u64 = 680_000_000;
const ONE: u64 = 1_000_000; // PAYOFF_UNIT / PRICE_SCALE

/// Ensure `user` has a Yes ATA (empty) so they can place bids that may receive Yes.
fn ensure_yes_ata(f: &mut Fixture, user: solana_pubkey::Pubkey, market: &solana_pubkey::Pubkey) {
    let (yes_mint, _) = yes_mint_pda(market);
    let yes_ata = ata(&user, &yes_mint);
    if read_token_account(&f.svm, &yes_ata).is_none() {
        seed_token_account(&mut f.svm, &yes_ata, &yes_mint, &user, 0);
    }
}

/// Give `user` `pairs` Yes (and No) tokens by minting pairs (creates their ATAs).
fn mint_pairs_for(
    f: &mut Fixture,
    user: &solana_keypair::Keypair,
    market: &solana_pubkey::Pubkey,
    pairs: u64,
) {
    for _ in 0..pairs {
        let kp = user.insecure_clone();
        let ix = ix_mint_pair(&user.pubkey(), &f.usdc_mint, market);
        send(&mut f.svm, &user.pubkey(), ix, &[&kp]).expect("mint pair");
    }
}

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

// ---------------------------------------------------------------------------
// Chunk 2 — place_order resting (limit, no cross)
// ---------------------------------------------------------------------------

#[test]
fn limit_bid_rests_and_escrows_usdc() {
    let mut f = setup(5 * ONE);
    let market = create_market_and_book(&mut f, Ticker::Meta, STRIKE, DAY);
    let _u = f.user.pubkey();
    ensure_yes_ata(&mut f, _u, &market);
    let user = f.user.insecure_clone();

    // Bid: buy 2.0 Yes @ $0.60 → escrow ceil(0.60 * 2.0) = $1.20 USDC.
    let price = 600_000; // $0.60
    let size = 2 * ONE; // 2.0 Yes
    let usdc_before = token_balance(&f.svm, &ata(&f.user.pubkey(), &f.usdc_mint));
    let ix = ix_place_order(
        &f.user.pubkey(), &f.usdc_mint, &market, OrderSide::Bid, price, size, false, &[],
    );
    send(&mut f.svm, &f.user.pubkey(), ix, &[&user]).expect("place bid");

    // Order rests on the bid side.
    let (ob_pda, _) = order_book_pda(&market);
    let ob = read_order_book(&f.svm, &ob_pda);
    assert_eq!(ob.bids.len(), 1, "one resting bid");
    assert_eq!(ob.asks.len(), 0, "no asks");
    let o = ob.bids[0];
    assert_eq!(o.owner, f.user.pubkey());
    assert_eq!(o.price, price);
    assert_eq!(o.size, size);
    assert_eq!(o.seq, 0, "first order gets seq 0");
    assert!(o.active);

    // USDC escrowed = $1.20; user balance dropped by that.
    let (usdc_escrow, _) = usdc_escrow_pda(&market);
    assert_eq!(token_balance(&f.svm, &usdc_escrow), 1_200_000, "escrowed $1.20");
    assert_eq!(
        token_balance(&f.svm, &ata(&f.user.pubkey(), &f.usdc_mint)),
        usdc_before - 1_200_000,
        "user paid escrow"
    );
}

#[test]
fn limit_ask_rests_and_escrows_yes() {
    let mut f = setup(5 * ONE);
    let market = create_market_and_book(&mut f, Ticker::Meta, STRIKE, DAY);
    let user = f.user.insecure_clone();
    // Get Yes tokens to sell: mint 2 pairs → 2.0 Yes.
    mint_pairs_for(&mut f, &user, &market, 2);
    let (yes_mint, _) = yes_mint_pda(&market);
    let yes_before = token_balance(&f.svm, &ata(&f.user.pubkey(), &yes_mint));
    assert_eq!(yes_before, 2 * ONE, "has 2 Yes");

    // Ask: sell 2.0 Yes @ $0.70 → escrow 2.0 Yes tokens.
    let ix = ix_place_order(
        &f.user.pubkey(), &f.usdc_mint, &market, OrderSide::Ask, 700_000, 2 * ONE, false, &[],
    );
    send(&mut f.svm, &f.user.pubkey(), ix, &[&user]).expect("place ask");

    let (ob_pda, _) = order_book_pda(&market);
    let ob = read_order_book(&f.svm, &ob_pda);
    assert_eq!(ob.asks.len(), 1, "one resting ask");
    assert_eq!(ob.asks[0].size, 2 * ONE);

    let (yes_escrow, _) = yes_escrow_pda(&market);
    assert_eq!(token_balance(&f.svm, &yes_escrow), 2 * ONE, "escrowed 2 Yes");
    assert_eq!(
        token_balance(&f.svm, &ata(&f.user.pubkey(), &yes_mint)),
        0,
        "user's Yes moved to escrow"
    );
}

#[test]
fn price_time_priority_ordering_on_each_side() {
    let mut f = setup(20 * ONE);
    let market = create_market_and_book(&mut f, Ticker::Meta, STRIKE, DAY);
    let _u = f.user.pubkey();
    ensure_yes_ata(&mut f, _u, &market);
    let user = f.user.insecure_clone();

    // Place bids @ 0.50, 0.60, 0.60 (the two 0.60s test the seq tiebreak).
    for p in [500_000u64, 600_000, 600_000] {
        let ix = ix_place_order(
            &f.user.pubkey(), &f.usdc_mint, &market, OrderSide::Bid, p, ONE, false, &[],
        );
        send(&mut f.svm, &f.user.pubkey(), ix, &[&user]).expect("bid");
    }
    let (ob_pda, _) = order_book_pda(&market);
    let ob = read_order_book(&f.svm, &ob_pda);
    // Best bid first: 0.60 (seq1) then 0.60 (seq2) then 0.50 (seq0).
    assert_eq!(ob.bids[0].price, 600_000);
    assert_eq!(ob.bids[0].seq, 1, "earlier 0.60 ranks ahead");
    assert_eq!(ob.bids[1].price, 600_000);
    assert_eq!(ob.bids[1].seq, 2);
    assert_eq!(ob.bids[2].price, 500_000);
}

#[test]
fn place_order_rejects_zero_size() {
    let mut f = setup(5 * ONE);
    let market = create_market_and_book(&mut f, Ticker::Meta, STRIKE, DAY);
    let _u = f.user.pubkey();
    ensure_yes_ata(&mut f, _u, &market);
    let user = f.user.insecure_clone();
    let ix = ix_place_order(
        &f.user.pubkey(), &f.usdc_mint, &market, OrderSide::Bid, 500_000, 0, false, &[],
    );
    let res = send(&mut f.svm, &f.user.pubkey(), ix, &[&user]);
    assert!(res.is_err(), "zero size must be rejected");
}

#[test]
fn place_order_rejects_price_out_of_range() {
    let mut f = setup(5 * ONE);
    let market = create_market_and_book(&mut f, Ticker::Meta, STRIKE, DAY);
    let _u = f.user.pubkey();
    ensure_yes_ata(&mut f, _u, &market);
    let user = f.user.insecure_clone();
    // Price > PRICE_SCALE ($1.00) is invalid.
    let ix = ix_place_order(
        &f.user.pubkey(), &f.usdc_mint, &market, OrderSide::Bid, 1_000_001, ONE, false, &[],
    );
    let res = send(&mut f.svm, &f.user.pubkey(), ix, &[&user]);
    assert!(res.is_err(), "price above PRICE_SCALE must be rejected");
}

#[test]
fn place_order_rejected_when_paused() {
    let mut f = setup(5 * ONE);
    let market = create_market_and_book(&mut f, Ticker::Meta, STRIKE, DAY);
    let _u = f.user.pubkey();
    ensure_yes_ata(&mut f, _u, &market);
    set_paused(&mut f.svm, true);
    let user = f.user.insecure_clone();
    let ix = ix_place_order(
        &f.user.pubkey(), &f.usdc_mint, &market, OrderSide::Bid, 500_000, ONE, false, &[],
    );
    let res = send(&mut f.svm, &f.user.pubkey(), ix, &[&user]);
    assert!(res.is_err(), "trading must be rejected when paused");
}

#[test]
fn place_order_rejected_when_settled() {
    let mut f = setup(5 * ONE);
    let market = create_market_and_book(&mut f, Ticker::Meta, STRIKE, DAY);
    let _u = f.user.pubkey();
    ensure_yes_ata(&mut f, _u, &market);
    force_settle(&mut f.svm, &market, meridian::state::Outcome::YesWins);
    let user = f.user.insecure_clone();
    let ix = ix_place_order(
        &f.user.pubkey(), &f.usdc_mint, &market, OrderSide::Bid, 500_000, ONE, false, &[],
    );
    let res = send(&mut f.svm, &f.user.pubkey(), ix, &[&user]);
    assert!(res.is_err(), "trading must be rejected on a settled market");
}

#[test]
fn book_full_rejects_new_resting_order() {
    // Fill one side to capacity (ORDERBOOK_N), then the next resting order is rejected.
    // Use distinct prices so nothing crosses (all bids; no asks exist).
    let mut f = setup(10_000 * ONE);
    let market = create_market_and_book(&mut f, Ticker::Meta, STRIKE, DAY);
    let _u = f.user.pubkey();
    ensure_yes_ata(&mut f, _u, &market);
    let user = f.user.insecure_clone();

    let n = meridian::constants::ORDERBOOK_N as u64;
    for i in 0..n {
        // Tiny distinct prices; size 1 base unit → cheap escrow.
        let price = 1 + i; // all <= PRICE_SCALE
        let ix = ix_place_order(
            &f.user.pubkey(), &f.usdc_mint, &market, OrderSide::Bid, price, 1, false, &[],
        );
        send(&mut f.svm, &f.user.pubkey(), ix, &[&user]).expect("fill book");
    }
    let (ob_pda, _) = order_book_pda(&market);
    assert_eq!(read_order_book(&f.svm, &ob_pda).bids.len(), n as usize, "book full");

    // One more must be rejected with BookFull.
    let ix = ix_place_order(
        &f.user.pubkey(), &f.usdc_mint, &market, OrderSide::Bid, 999_999, 1, false, &[],
    );
    let res = send(&mut f.svm, &f.user.pubkey(), ix, &[&user]);
    assert!(res.is_err(), "resting beyond capacity must be rejected (BookFull)");
}
