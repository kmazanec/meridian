//! Tests for the order book: init, place_order, cancel_order, match_orders
//! (LiteSVM). Mirrors the adversarial style of the mint/redeem suites.

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
    assert_eq!(
        read_market(&f.svm, &market).order_book,
        ob_pda,
        "market wired after grow"
    );

    // OrderBook account is well-formed, empty, and at full on-chain size.
    let ob = read_order_book(&f.svm, &ob_pda);
    assert_eq!(ob.market, market, "book back-references market");
    assert_eq!(ob.next_seq, 0, "seq starts at 0");
    assert!(
        ob.bids.is_empty() && ob.asks.is_empty(),
        "book starts empty"
    );
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
    assert_eq!(
        ue.owner, mint_auth,
        "usdc escrow authority is mint_auth PDA"
    );
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
    assert!(
        res.is_err(),
        "re-initializing the order book must be rejected"
    );
}

#[test]
fn grow_order_book_rejected_twice() {
    let mut f = setup(5 * ONE);
    let market = create_market_and_book(&mut f, Ticker::Meta, STRIKE, DAY);

    // Second grow must fail (market already wired).
    let payer = f.user.insecure_clone();
    let ix = ix_grow_order_book(&f.user.pubkey(), &market);
    let res = send(&mut f.svm, &f.user.pubkey(), ix, &[&payer]);
    assert!(
        res.is_err(),
        "re-growing a wired order book must be rejected"
    );
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
        &f.user.pubkey(),
        &f.usdc_mint,
        &market,
        OrderSide::Bid,
        price,
        size,
        false,
        &[],
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
    assert_eq!(
        token_balance(&f.svm, &usdc_escrow),
        1_200_000,
        "escrowed $1.20"
    );
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
        &f.user.pubkey(),
        &f.usdc_mint,
        &market,
        OrderSide::Ask,
        700_000,
        2 * ONE,
        false,
        &[],
    );
    send(&mut f.svm, &f.user.pubkey(), ix, &[&user]).expect("place ask");

    let (ob_pda, _) = order_book_pda(&market);
    let ob = read_order_book(&f.svm, &ob_pda);
    assert_eq!(ob.asks.len(), 1, "one resting ask");
    assert_eq!(ob.asks[0].size, 2 * ONE);

    let (yes_escrow, _) = yes_escrow_pda(&market);
    assert_eq!(
        token_balance(&f.svm, &yes_escrow),
        2 * ONE,
        "escrowed 2 Yes"
    );
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
            &f.user.pubkey(),
            &f.usdc_mint,
            &market,
            OrderSide::Bid,
            p,
            ONE,
            false,
            &[],
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
        &f.user.pubkey(),
        &f.usdc_mint,
        &market,
        OrderSide::Bid,
        500_000,
        0,
        false,
        &[],
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
        &f.user.pubkey(),
        &f.usdc_mint,
        &market,
        OrderSide::Bid,
        1_000_001,
        ONE,
        false,
        &[],
    );
    let res = send(&mut f.svm, &f.user.pubkey(), ix, &[&user]);
    assert!(res.is_err(), "price above PRICE_SCALE must be rejected");
}

#[test]
fn place_order_rejects_zero_price_limit() {
    // A 0-price limit order escrows nothing and could acquire Yes
    // for free / squat slots. Limit price must be in [1, PRICE_SCALE].
    let mut f = setup(5 * ONE);
    let market = create_market_and_book(&mut f, Ticker::Meta, STRIKE, DAY);
    let _u = f.user.pubkey();
    ensure_yes_ata(&mut f, _u, &market);
    let user = f.user.insecure_clone();
    let ix = ix_place_order(
        &f.user.pubkey(),
        &f.usdc_mint,
        &market,
        OrderSide::Bid,
        0,
        ONE,
        false,
        &[],
    );
    let res = send(&mut f.svm, &f.user.pubkey(), ix, &[&user]);
    assert!(res.is_err(), "zero-price limit order must be rejected");
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
        &f.user.pubkey(),
        &f.usdc_mint,
        &market,
        OrderSide::Bid,
        500_000,
        ONE,
        false,
        &[],
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
        &f.user.pubkey(),
        &f.usdc_mint,
        &market,
        OrderSide::Bid,
        500_000,
        ONE,
        false,
        &[],
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
            &f.user.pubkey(),
            &f.usdc_mint,
            &market,
            OrderSide::Bid,
            price,
            1,
            false,
            &[],
        );
        send(&mut f.svm, &f.user.pubkey(), ix, &[&user]).expect("fill book");
    }
    let (ob_pda, _) = order_book_pda(&market);
    assert_eq!(
        read_order_book(&f.svm, &ob_pda).bids.len(),
        n as usize,
        "book full"
    );

    // One more must be rejected with BookFull.
    let ix = ix_place_order(
        &f.user.pubkey(),
        &f.usdc_mint,
        &market,
        OrderSide::Bid,
        999_999,
        1,
        false,
        &[],
    );
    let res = send(&mut f.svm, &f.user.pubkey(), ix, &[&user]);
    assert!(
        res.is_err(),
        "resting beyond capacity must be rejected (BookFull)"
    );
}

// ---------------------------------------------------------------------------
// Chunk 3 — place_order crossing + market orders + partial fills
// ---------------------------------------------------------------------------

/// A maker's USDC ATA (what an ASK maker receives when a taker buys Yes).
fn usdc_ata(f: &Fixture, owner: &solana_pubkey::Pubkey) -> solana_pubkey::Pubkey {
    ata(owner, &f.usdc_mint)
}
/// A maker's Yes ATA (what a BID maker receives when a taker sells Yes).
fn yes_ata(market: &solana_pubkey::Pubkey, owner: &solana_pubkey::Pubkey) -> solana_pubkey::Pubkey {
    let (yes_mint, _) = yes_mint_pda(market);
    ata(owner, &yes_mint)
}

#[test]
fn taker_buy_crosses_resting_ask_full_fill() {
    let mut f = setup(10 * ONE);
    let market = create_market_and_book(&mut f, Ticker::Meta, STRIKE, DAY);
    let (yes_mint, _) = yes_mint_pda(&market);

    // user2 = maker: mint 2 Yes, post an ask to sell 2.0 Yes @ $0.50.
    let maker = f.user2.insecure_clone();
    mint_pairs_for(&mut f, &maker, &market, 2);
    let ix = ix_place_order(
        &f.user2.pubkey(),
        &f.usdc_mint,
        &market,
        OrderSide::Ask,
        500_000,
        2 * ONE,
        false,
        &[],
    );
    send(&mut f.svm, &f.user2.pubkey(), ix, &[&maker]).expect("maker ask");

    // user = taker: buy 2.0 Yes (market). Maker (seller) receives USDC.
    let _u = f.user.pubkey();
    ensure_yes_ata(&mut f, _u, &market);
    let taker = f.user.insecure_clone();
    let maker_usdc = usdc_ata(&f, &f.user2.pubkey());
    let taker_usdc_before = token_balance(&f.svm, &usdc_ata(&f, &f.user.pubkey()));
    let maker_usdc_before = token_balance(&f.svm, &maker_usdc);

    let ix = ix_place_order(
        &f.user.pubkey(),
        &f.usdc_mint,
        &market,
        OrderSide::Bid,
        0,
        2 * ONE,
        true,
        &[maker_usdc],
    );
    send(&mut f.svm, &f.user.pubkey(), ix, &[&taker]).expect("taker market buy");

    // Book empty (ask fully consumed; market remainder not rested).
    let (ob_pda, _) = order_book_pda(&market);
    let ob = read_order_book(&f.svm, &ob_pda);
    assert!(ob.asks.is_empty() && ob.bids.is_empty(), "book cleared");

    // Taker holds 2.0 Yes; paid $1.00 (2.0 @ $0.50). Maker received $1.00.
    assert_eq!(
        token_balance(&f.svm, &ata(&f.user.pubkey(), &yes_mint)),
        2 * ONE,
        "taker got 2 Yes"
    );
    assert_eq!(
        token_balance(&f.svm, &usdc_ata(&f, &f.user.pubkey())),
        taker_usdc_before - 1_000_000,
        "taker paid $1.00"
    );
    assert_eq!(
        token_balance(&f.svm, &maker_usdc),
        maker_usdc_before + 1_000_000,
        "maker got $1.00"
    );
    // Yes escrow drained.
    let (yes_escrow, _) = yes_escrow_pda(&market);
    assert_eq!(token_balance(&f.svm, &yes_escrow), 0, "yes escrow emptied");
}

#[test]
fn taker_sell_crosses_resting_bid_full_fill() {
    let mut f = setup(10 * ONE);
    let market = create_market_and_book(&mut f, Ticker::Meta, STRIKE, DAY);
    let (yes_mint, _) = yes_mint_pda(&market);

    // user2 = maker: post a bid to buy 2.0 Yes @ $0.60 (escrows $1.20).
    let maker = f.user2.insecure_clone();
    let _u2 = f.user2.pubkey();
    ensure_yes_ata(&mut f, _u2, &market); // maker will receive Yes
    let ix = ix_place_order(
        &f.user2.pubkey(),
        &f.usdc_mint,
        &market,
        OrderSide::Bid,
        600_000,
        2 * ONE,
        false,
        &[],
    );
    send(&mut f.svm, &f.user2.pubkey(), ix, &[&maker]).expect("maker bid");

    // user = taker: sell 2.0 Yes (market). Maker (buyer) receives Yes; taker gets USDC.
    let taker = f.user.insecure_clone();
    mint_pairs_for(&mut f, &taker, &market, 2); // taker has 2.0 Yes
    let maker_yes = yes_ata(&market, &f.user2.pubkey());
    let taker_usdc_before = token_balance(&f.svm, &usdc_ata(&f, &f.user.pubkey()));

    let ix = ix_place_order(
        &f.user.pubkey(),
        &f.usdc_mint,
        &market,
        OrderSide::Ask,
        0,
        2 * ONE,
        true,
        &[maker_yes],
    );
    send(&mut f.svm, &f.user.pubkey(), ix, &[&taker]).expect("taker market sell");

    let (ob_pda, _) = order_book_pda(&market);
    let ob = read_order_book(&f.svm, &ob_pda);
    assert!(ob.asks.is_empty() && ob.bids.is_empty(), "book cleared");

    // Maker holds 2.0 Yes; taker received $1.20; USDC escrow drained.
    assert_eq!(
        token_balance(&f.svm, &maker_yes),
        2 * ONE,
        "maker got 2 Yes"
    );
    assert_eq!(
        token_balance(&f.svm, &usdc_ata(&f, &f.user.pubkey())),
        taker_usdc_before + 1_200_000,
        "taker received $1.20"
    );
    let (usdc_escrow, _) = usdc_escrow_pda(&market);
    assert_eq!(
        token_balance(&f.svm, &usdc_escrow),
        0,
        "usdc escrow emptied"
    );
    let _ = yes_mint;
}

#[test]
fn partial_fill_across_two_price_levels() {
    let mut f = setup(20 * ONE);
    let market = create_market_and_book(&mut f, Ticker::Meta, STRIKE, DAY);
    let (yes_mint, _) = yes_mint_pda(&market);

    // Maker posts two asks: 1.0 @ $0.40 (seq0) and 1.0 @ $0.50 (seq1).
    let maker = f.user2.insecure_clone();
    mint_pairs_for(&mut f, &maker, &market, 2);
    for p in [400_000u64, 500_000] {
        let ix = ix_place_order(
            &f.user2.pubkey(),
            &f.usdc_mint,
            &market,
            OrderSide::Ask,
            p,
            ONE,
            false,
            &[],
        );
        send(&mut f.svm, &f.user2.pubkey(), ix, &[&maker]).expect("ask");
    }

    // Taker market-buys 1.5 Yes → fills 1.0 @ $0.40 then 0.5 @ $0.50 = $0.65 total.
    let _u = f.user.pubkey();
    ensure_yes_ata(&mut f, _u, &market);
    let taker = f.user.insecure_clone();
    let maker_usdc = usdc_ata(&f, &f.user2.pubkey());
    let taker_usdc_before = token_balance(&f.svm, &usdc_ata(&f, &f.user.pubkey()));

    // Best-price-first order: the $0.40 ask is consumed first, then the $0.50.
    let ix = ix_place_order(
        &f.user.pubkey(),
        &f.usdc_mint,
        &market,
        OrderSide::Bid,
        0,
        3 * ONE / 2,
        true,
        &[maker_usdc, maker_usdc],
    );
    send(&mut f.svm, &f.user.pubkey(), ix, &[&taker]).expect("taker partial");

    // Taker holds 1.5 Yes; paid $0.40 + $0.25 = $0.65.
    assert_eq!(
        token_balance(&f.svm, &ata(&f.user.pubkey(), &yes_mint)),
        3 * ONE / 2,
        "1.5 Yes"
    );
    assert_eq!(
        token_balance(&f.svm, &usdc_ata(&f, &f.user.pubkey())),
        taker_usdc_before - 650_000,
        "paid $0.65"
    );

    // One ask remains: 0.5 Yes @ $0.50.
    let (ob_pda, _) = order_book_pda(&market);
    let ob = read_order_book(&f.svm, &ob_pda);
    assert_eq!(ob.asks.len(), 1, "one ask left");
    assert_eq!(ob.asks[0].price, 500_000);
    assert_eq!(ob.asks[0].size, ONE / 2, "0.5 Yes remaining");
}

#[test]
fn crossing_limit_fills_then_rests_remainder() {
    let mut f = setup(20 * ONE);
    let market = create_market_and_book(&mut f, Ticker::Meta, STRIKE, DAY);

    // Maker: ask 1.0 Yes @ $0.50.
    let maker = f.user2.insecure_clone();
    mint_pairs_for(&mut f, &maker, &market, 1);
    let ix = ix_place_order(
        &f.user2.pubkey(),
        &f.usdc_mint,
        &market,
        OrderSide::Ask,
        500_000,
        ONE,
        false,
        &[],
    );
    send(&mut f.svm, &f.user2.pubkey(), ix, &[&maker]).expect("ask");

    // Taker: LIMIT buy 3.0 Yes @ $0.50 → fills 1.0 @ $0.50, remainder 2.0 rests as a bid.
    let _u = f.user.pubkey();
    ensure_yes_ata(&mut f, _u, &market);
    let taker = f.user.insecure_clone();
    let maker_usdc = usdc_ata(&f, &f.user2.pubkey());
    let ix = ix_place_order(
        &f.user.pubkey(),
        &f.usdc_mint,
        &market,
        OrderSide::Bid,
        500_000,
        3 * ONE,
        false,
        &[maker_usdc],
    );
    send(&mut f.svm, &f.user.pubkey(), ix, &[&taker]).expect("crossing limit");

    let (yes_mint, _) = yes_mint_pda(&market);
    assert_eq!(
        token_balance(&f.svm, &ata(&f.user.pubkey(), &yes_mint)),
        ONE,
        "got 1.0 Yes"
    );

    // Remainder 2.0 @ $0.50 rests as a bid; escrow holds $1.00 for it.
    let (ob_pda, _) = order_book_pda(&market);
    let ob = read_order_book(&f.svm, &ob_pda);
    assert!(ob.asks.is_empty(), "ask consumed");
    assert_eq!(ob.bids.len(), 1, "remainder rests");
    assert_eq!(ob.bids[0].size, 2 * ONE);
    let (usdc_escrow, _) = usdc_escrow_pda(&market);
    assert_eq!(
        token_balance(&f.svm, &usdc_escrow),
        1_000_000,
        "escrow for resting remainder"
    );
}

#[test]
fn market_order_remainder_is_cancelled_not_rested() {
    let mut f = setup(20 * ONE);
    let market = create_market_and_book(&mut f, Ticker::Meta, STRIKE, DAY);

    // Maker: ask only 1.0 Yes @ $0.50.
    let maker = f.user2.insecure_clone();
    mint_pairs_for(&mut f, &maker, &market, 1);
    let ix = ix_place_order(
        &f.user2.pubkey(),
        &f.usdc_mint,
        &market,
        OrderSide::Ask,
        500_000,
        ONE,
        false,
        &[],
    );
    send(&mut f.svm, &f.user2.pubkey(), ix, &[&maker]).expect("ask");

    // Taker: MARKET buy 3.0 Yes → only 1.0 available; remainder dropped (no rest).
    let _u = f.user.pubkey();
    ensure_yes_ata(&mut f, _u, &market);
    let taker = f.user.insecure_clone();
    let maker_usdc = usdc_ata(&f, &f.user2.pubkey());
    let usdc_before = token_balance(&f.svm, &usdc_ata(&f, &f.user.pubkey()));
    let ix = ix_place_order(
        &f.user.pubkey(),
        &f.usdc_mint,
        &market,
        OrderSide::Bid,
        0,
        3 * ONE,
        true,
        &[maker_usdc],
    );
    send(&mut f.svm, &f.user.pubkey(), ix, &[&taker]).expect("market buy");

    let (yes_mint, _) = yes_mint_pda(&market);
    assert_eq!(
        token_balance(&f.svm, &ata(&f.user.pubkey(), &yes_mint)),
        ONE,
        "got only 1.0 Yes"
    );
    // Only $0.50 spent (for the 1.0 filled); nothing escrowed for the dropped remainder.
    assert_eq!(
        token_balance(&f.svm, &usdc_ata(&f, &f.user.pubkey())),
        usdc_before - 500_000,
        "paid only for filled portion"
    );
    let (ob_pda, _) = order_book_pda(&market);
    let ob = read_order_book(&f.svm, &ob_pda);
    assert!(ob.bids.is_empty(), "market remainder not rested");
    assert!(ob.asks.is_empty(), "ask consumed");
}

#[test]
fn non_crossing_limit_does_not_fill() {
    let mut f = setup(20 * ONE);
    let market = create_market_and_book(&mut f, Ticker::Meta, STRIKE, DAY);

    // Maker: ask 1.0 Yes @ $0.70.
    let maker = f.user2.insecure_clone();
    mint_pairs_for(&mut f, &maker, &market, 1);
    let ix = ix_place_order(
        &f.user2.pubkey(),
        &f.usdc_mint,
        &market,
        OrderSide::Ask,
        700_000,
        ONE,
        false,
        &[],
    );
    send(&mut f.svm, &f.user2.pubkey(), ix, &[&maker]).expect("ask");

    // Taker: limit bid @ $0.60 (< $0.70) → does NOT cross; rests as a bid.
    let _u = f.user.pubkey();
    ensure_yes_ata(&mut f, _u, &market);
    let taker = f.user.insecure_clone();
    let ix = ix_place_order(
        &f.user.pubkey(),
        &f.usdc_mint,
        &market,
        OrderSide::Bid,
        600_000,
        ONE,
        false,
        &[],
    );
    send(&mut f.svm, &f.user.pubkey(), ix, &[&taker]).expect("non-crossing bid");

    let (ob_pda, _) = order_book_pda(&market);
    let ob = read_order_book(&f.svm, &ob_pda);
    assert_eq!(ob.asks.len(), 1, "ask still resting");
    assert_eq!(ob.bids.len(), 1, "bid rests, no fill");
    let (yes_mint, _) = yes_mint_pda(&market);
    assert_eq!(
        token_balance(&f.svm, &ata(&f.user.pubkey(), &yes_mint)),
        0,
        "taker got no Yes"
    );
}

// ---------------------------------------------------------------------------
// Chunk 4 — cancel_order
// ---------------------------------------------------------------------------

#[test]
fn cancel_bid_returns_usdc_escrow() {
    let mut f = setup(5 * ONE);
    let market = create_market_and_book(&mut f, Ticker::Meta, STRIKE, DAY);
    let _u = f.user.pubkey();
    ensure_yes_ata(&mut f, _u, &market);
    let user = f.user.insecure_clone();

    // Bid 2.0 Yes @ $0.60 → escrow $1.20.
    let usdc_before = token_balance(&f.svm, &usdc_ata(&f, &f.user.pubkey()));
    let ix = ix_place_order(
        &f.user.pubkey(),
        &f.usdc_mint,
        &market,
        OrderSide::Bid,
        600_000,
        2 * ONE,
        false,
        &[],
    );
    send(&mut f.svm, &f.user.pubkey(), ix, &[&user]).expect("bid");
    assert_eq!(
        token_balance(&f.svm, &usdc_ata(&f, &f.user.pubkey())),
        usdc_before - 1_200_000
    );

    // Cancel seq 0 → full $1.20 returned, book empty, escrow drained.
    let refund_to = usdc_ata(&f, &f.user.pubkey());
    let ix = ix_cancel_order(&f.user.pubkey(), &market, OrderSide::Bid, 0, &refund_to);
    send(&mut f.svm, &f.user.pubkey(), ix, &[&user]).expect("cancel");

    assert_eq!(
        token_balance(&f.svm, &usdc_ata(&f, &f.user.pubkey())),
        usdc_before,
        "fully refunded"
    );
    let (usdc_escrow, _) = usdc_escrow_pda(&market);
    assert_eq!(token_balance(&f.svm, &usdc_escrow), 0, "escrow drained");
    let (ob_pda, _) = order_book_pda(&market);
    assert!(
        read_order_book(&f.svm, &ob_pda).bids.is_empty(),
        "bid removed"
    );
}

#[test]
fn cancel_ask_returns_yes_escrow() {
    let mut f = setup(5 * ONE);
    let market = create_market_and_book(&mut f, Ticker::Meta, STRIKE, DAY);
    let user = f.user.insecure_clone();
    mint_pairs_for(&mut f, &user, &market, 2);
    let (yes_mint, _) = yes_mint_pda(&market);

    let ix = ix_place_order(
        &f.user.pubkey(),
        &f.usdc_mint,
        &market,
        OrderSide::Ask,
        700_000,
        2 * ONE,
        false,
        &[],
    );
    send(&mut f.svm, &f.user.pubkey(), ix, &[&user]).expect("ask");
    assert_eq!(
        token_balance(&f.svm, &ata(&f.user.pubkey(), &yes_mint)),
        0,
        "Yes escrowed"
    );

    let refund_to = ata(&f.user.pubkey(), &yes_mint);
    let ix = ix_cancel_order(&f.user.pubkey(), &market, OrderSide::Ask, 0, &refund_to);
    send(&mut f.svm, &f.user.pubkey(), ix, &[&user]).expect("cancel ask");

    assert_eq!(
        token_balance(&f.svm, &ata(&f.user.pubkey(), &yes_mint)),
        2 * ONE,
        "Yes returned"
    );
    let (yes_escrow, _) = yes_escrow_pda(&market);
    assert_eq!(token_balance(&f.svm, &yes_escrow), 0, "yes escrow drained");
}

#[test]
fn cancel_partially_filled_bid_refunds_remaining() {
    // Bid 3.0 @ $0.50 (escrow $1.50), taker buys... wait, taker hits the bid by selling.
    let mut f = setup(10 * ONE);
    let market = create_market_and_book(&mut f, Ticker::Meta, STRIKE, DAY);
    let _u2 = f.user2.pubkey();
    ensure_yes_ata(&mut f, _u2, &market);
    let maker = f.user2.insecure_clone();

    // Maker bid 3.0 Yes @ $0.50 → escrow ceil(0.5*3.0) = $1.50.
    let ix = ix_place_order(
        &f.user2.pubkey(),
        &f.usdc_mint,
        &market,
        OrderSide::Bid,
        500_000,
        3 * ONE,
        false,
        &[],
    );
    send(&mut f.svm, &f.user2.pubkey(), ix, &[&maker]).expect("bid");
    let (usdc_escrow, _) = usdc_escrow_pda(&market);
    assert_eq!(token_balance(&f.svm, &usdc_escrow), 1_500_000);

    // Taker sells 1.0 Yes into the bid → fills 1.0 @ $0.50 = $0.50 leaves escrow.
    let taker = f.user.insecure_clone();
    mint_pairs_for(&mut f, &taker, &market, 1);
    let maker_yes = yes_ata(&market, &f.user2.pubkey());
    let ix = ix_place_order(
        &f.user.pubkey(),
        &f.usdc_mint,
        &market,
        OrderSide::Ask,
        0,
        ONE,
        true,
        &[maker_yes],
    );
    send(&mut f.svm, &f.user.pubkey(), ix, &[&taker]).expect("partial hit");
    assert_eq!(
        token_balance(&f.svm, &usdc_escrow),
        1_000_000,
        "escrow now $1.00 for 2.0 remaining"
    );

    // Maker cancels remaining 2.0 @ $0.50 → refund exactly $1.00.
    let maker_usdc = usdc_ata(&f, &f.user2.pubkey());
    let maker_usdc_before = token_balance(&f.svm, &maker_usdc);
    let ix = ix_cancel_order(&f.user2.pubkey(), &market, OrderSide::Bid, 0, &maker_usdc);
    send(&mut f.svm, &f.user2.pubkey(), ix, &[&maker]).expect("cancel remainder");
    assert_eq!(
        token_balance(&f.svm, &maker_usdc),
        maker_usdc_before + 1_000_000,
        "refund $1.00"
    );
    assert_eq!(
        token_balance(&f.svm, &usdc_escrow),
        0,
        "escrow fully drained"
    );
}

#[test]
fn cancel_rejects_non_owner() {
    let mut f = setup(5 * ONE);
    let market = create_market_and_book(&mut f, Ticker::Meta, STRIKE, DAY);
    let _u = f.user.pubkey();
    ensure_yes_ata(&mut f, _u, &market);
    let user = f.user.insecure_clone();
    let ix = ix_place_order(
        &f.user.pubkey(),
        &f.usdc_mint,
        &market,
        OrderSide::Bid,
        600_000,
        ONE,
        false,
        &[],
    );
    send(&mut f.svm, &f.user.pubkey(), ix, &[&user]).expect("bid");

    // user2 tries to cancel user's order, refunding to user2 — must fail.
    let attacker = f.user2.insecure_clone();
    let attacker_usdc = usdc_ata(&f, &f.user2.pubkey());
    let ix = ix_cancel_order(
        &f.user2.pubkey(),
        &market,
        OrderSide::Bid,
        0,
        &attacker_usdc,
    );
    let res = send(&mut f.svm, &f.user2.pubkey(), ix, &[&attacker]);
    assert!(res.is_err(), "non-owner cancel must be rejected");
    // Order still resting.
    let (ob_pda, _) = order_book_pda(&market);
    assert_eq!(
        read_order_book(&f.svm, &ob_pda).bids.len(),
        1,
        "order untouched"
    );
}

#[test]
fn cancel_rejects_missing_order() {
    let mut f = setup(5 * ONE);
    let market = create_market_and_book(&mut f, Ticker::Meta, STRIKE, DAY);
    let user = f.user.insecure_clone();
    // No order placed; seq 7 doesn't exist.
    let refund_to = usdc_ata(&f, &f.user.pubkey());
    let ix = ix_cancel_order(&f.user.pubkey(), &market, OrderSide::Bid, 7, &refund_to);
    let res = send(&mut f.svm, &f.user.pubkey(), ix, &[&user]);
    assert!(
        res.is_err(),
        "cancelling a nonexistent order must be rejected"
    );
}

// ---------------------------------------------------------------------------
// Chunk 5 — match_orders crank + trustlessness
// ---------------------------------------------------------------------------

/// Set up a crossed book between user (bid) and user2 (ask), with their receiving ATAs
/// created. Returns (bid_owner_yes_ata, ask_owner_usdc_ata).
fn setup_crossed(
    f: &mut Fixture,
    market: &solana_pubkey::Pubkey,
    bid_price: u64,
    bid_size: u64,
    ask_price: u64,
    ask_size: u64,
) -> (solana_pubkey::Pubkey, solana_pubkey::Pubkey) {
    let bid_owner = f.user.pubkey();
    let ask_owner = f.user2.pubkey();
    // Receiving accounts: bid owner gets Yes; ask owner gets USDC (already has a USDC ATA).
    ensure_yes_ata(f, bid_owner, market);
    seed_crossed_book(
        &mut f.svm, market, &bid_owner, bid_price, bid_size, &ask_owner, ask_price, ask_size,
    );
    let (yes_mint, _) = yes_mint_pda(market);
    (ata(&bid_owner, &yes_mint), ata(&ask_owner, &f.usdc_mint))
}

#[test]
fn crank_settles_crossed_pair() {
    let mut f = setup(10 * ONE);
    let market = create_market_and_book(&mut f, Ticker::Meta, STRIKE, DAY);
    // Bid 2.0 @ $0.60 crosses ask 2.0 @ $0.50. Trade at bid price $0.60 → $1.20.
    let (bid_yes, ask_usdc) = setup_crossed(&mut f, &market, 600_000, 2 * ONE, 500_000, 2 * ONE);
    let ask_usdc_before = token_balance(&f.svm, &ask_usdc);

    let cranker = f.admin.insecure_clone(); // a third party cranks
    let ix = ix_match_orders(&f.admin.pubkey(), &market, 4, &[bid_yes, ask_usdc]);
    send(&mut f.svm, &f.admin.pubkey(), ix, &[&cranker]).expect("crank");

    // Bid owner received 2.0 Yes; ask owner received $1.20; book + escrows cleared.
    assert_eq!(
        token_balance(&f.svm, &bid_yes),
        2 * ONE,
        "bid owner got 2 Yes"
    );
    assert_eq!(
        token_balance(&f.svm, &ask_usdc),
        ask_usdc_before + 1_200_000,
        "ask owner got $1.20"
    );
    let (ob_pda, _) = order_book_pda(&market);
    let ob = read_order_book(&f.svm, &ob_pda);
    assert!(
        ob.bids.is_empty() && ob.asks.is_empty(),
        "crossed pair fully settled"
    );
    let (usdc_escrow, _) = usdc_escrow_pda(&market);
    let (yes_escrow, _) = yes_escrow_pda(&market);
    assert_eq!(
        token_balance(&f.svm, &usdc_escrow),
        0,
        "usdc escrow drained"
    );
    assert_eq!(token_balance(&f.svm, &yes_escrow), 0, "yes escrow drained");
}

#[test]
fn crank_is_noop_on_uncrossed_book() {
    let mut f = setup(10 * ONE);
    let market = create_market_and_book(&mut f, Ticker::Meta, STRIKE, DAY);
    // Place a non-crossing bid and ask through the real API (bid $0.40 < ask $0.70).
    let _u = f.user.pubkey();
    ensure_yes_ata(&mut f, _u, &market);
    let user = f.user.insecure_clone();
    let ix = ix_place_order(
        &f.user.pubkey(),
        &f.usdc_mint,
        &market,
        OrderSide::Bid,
        400_000,
        ONE,
        false,
        &[],
    );
    send(&mut f.svm, &f.user.pubkey(), ix, &[&user]).expect("bid");
    let maker = f.user2.insecure_clone();
    mint_pairs_for(&mut f, &maker, &market, 1);
    let ix = ix_place_order(
        &f.user2.pubkey(),
        &f.usdc_mint,
        &market,
        OrderSide::Ask,
        700_000,
        ONE,
        false,
        &[],
    );
    send(&mut f.svm, &f.user2.pubkey(), ix, &[&maker]).expect("ask");

    // Crank with no remaining accounts → no-op (nothing crosses), succeeds.
    let cranker = f.admin.insecure_clone();
    let ix = ix_match_orders(&f.admin.pubkey(), &market, 4, &[]);
    send(&mut f.svm, &f.admin.pubkey(), ix, &[&cranker]).expect("crank no-op");
    let (ob_pda, _) = order_book_pda(&market);
    let ob = read_order_book(&f.svm, &ob_pda);
    assert_eq!(ob.bids.len(), 1, "bid still resting");
    assert_eq!(ob.asks.len(), 1, "ask still resting");
}

#[test]
fn crank_cannot_misdirect_funds_to_wrong_account() {
    // Trustlessness: the cranker supplies maker accounts, but the handler verifies each
    // belongs to the recorded order owner. Passing the cranker's own account is rejected.
    let mut f = setup(10 * ONE);
    let market = create_market_and_book(&mut f, Ticker::Meta, STRIKE, DAY);
    let (_bid_yes, _ask_usdc) = setup_crossed(&mut f, &market, 600_000, ONE, 500_000, ONE);

    // Attacker (admin) substitutes their OWN usdc account for the ask-owner payout.
    let attacker_usdc = usdc_ata(&f, &f.admin.pubkey());
    let (yes_mint, _) = yes_mint_pda(&market);
    let bid_yes = ata(&f.user.pubkey(), &yes_mint);
    let cranker = f.admin.insecure_clone();
    let ix = ix_match_orders(&f.admin.pubkey(), &market, 4, &[bid_yes, attacker_usdc]);
    let res = send(&mut f.svm, &f.admin.pubkey(), ix, &[&cranker]);
    assert!(
        res.is_err(),
        "crank must reject a maker account not owned by the order owner"
    );
    // Book untouched.
    let (ob_pda, _) = order_book_pda(&market);
    assert_eq!(
        read_order_book(&f.svm, &ob_pda).bids.len(),
        1,
        "no settlement happened"
    );
}

#[test]
fn crank_rejects_non_spl_maker_account() {
    // The maker payout account must be SPL-Token-owned. Passing a
    // program-owned account (e.g. the order_book PDA) whose bytes might parse must be
    // rejected before any transfer, so a maker can't brick matching with a corrupt acct.
    let mut f = setup(10 * ONE);
    let market = create_market_and_book(&mut f, Ticker::Meta, STRIKE, DAY);
    let (_bid_yes, _ask_usdc) = setup_crossed(&mut f, &market, 600_000, ONE, 500_000, ONE);
    let (yes_mint, _) = yes_mint_pda(&market);
    let bid_yes = ata(&f.user.pubkey(), &yes_mint);
    // Substitute the order_book PDA (owned by the program, not the token program) for the
    // ask owner's USDC payout account.
    let (order_book, _) = order_book_pda(&market);
    let cranker = f.admin.insecure_clone();
    let ix = ix_match_orders(&f.admin.pubkey(), &market, 4, &[bid_yes, order_book]);
    let res = send(&mut f.svm, &f.admin.pubkey(), ix, &[&cranker]);
    assert!(
        res.is_err(),
        "a non-SPL-owned maker account must be rejected"
    );
}

#[test]
fn crank_uses_onchain_price_not_caller_supplied() {
    // The crank takes no price/size from the caller — settlement amounts derive purely
    // from the on-chain orders. Verify the settled USDC equals the on-chain bid price ×
    // size (here 1.0 @ $0.60 = $0.60), regardless of who cranks.
    let mut f = setup(10 * ONE);
    let market = create_market_and_book(&mut f, Ticker::Meta, STRIKE, DAY);
    let (bid_yes, ask_usdc) = setup_crossed(&mut f, &market, 600_000, ONE, 500_000, ONE);
    let ask_usdc_before = token_balance(&f.svm, &ask_usdc);

    let cranker = f.user2.insecure_clone(); // ask owner themselves crank — still fine
    let ix = ix_match_orders(&f.user2.pubkey(), &market, 4, &[bid_yes, ask_usdc]);
    send(&mut f.svm, &f.user2.pubkey(), ix, &[&cranker]).expect("crank");
    assert_eq!(token_balance(&f.svm, &bid_yes), ONE, "1.0 Yes delivered");
    assert_eq!(
        token_balance(&f.svm, &ask_usdc),
        ask_usdc_before + 600_000,
        "settled at on-chain $0.60"
    );
}

#[test]
fn crank_rejected_when_paused() {
    let mut f = setup(10 * ONE);
    let market = create_market_and_book(&mut f, Ticker::Meta, STRIKE, DAY);
    let (bid_yes, ask_usdc) = setup_crossed(&mut f, &market, 600_000, ONE, 500_000, ONE);
    set_paused(&mut f.svm, true);
    let cranker = f.admin.insecure_clone();
    let ix = ix_match_orders(&f.admin.pubkey(), &market, 4, &[bid_yes, ask_usdc]);
    let res = send(&mut f.svm, &f.admin.pubkey(), ix, &[&cranker]);
    assert!(res.is_err(), "crank must be rejected when paused");
}

#[test]
fn crank_rejected_when_settled() {
    let mut f = setup(10 * ONE);
    let market = create_market_and_book(&mut f, Ticker::Meta, STRIKE, DAY);
    let (bid_yes, ask_usdc) = setup_crossed(&mut f, &market, 600_000, ONE, 500_000, ONE);
    force_settle(&mut f.svm, &market, meridian::state::Outcome::YesWins);
    let cranker = f.admin.insecure_clone();
    let ix = ix_match_orders(&f.admin.pubkey(), &market, 4, &[bid_yes, ask_usdc]);
    let res = send(&mut f.svm, &f.admin.pubkey(), ix, &[&cranker]);
    assert!(res.is_err(), "crank must be rejected on a settled market");
}
