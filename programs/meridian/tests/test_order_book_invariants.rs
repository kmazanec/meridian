//! F-03 invariant + four-path sweep (LiteSVM).
//!
//! Proves the order book never perturbs the collateralization invariant (#1), that escrow
//! balances reconcile to the resting book, and that all four trade paths from the brief
//! (Buy/Sell Yes, Buy/Sell No) execute correctly against the single Yes-vs-USDC book.

mod common;

use {
    common::*,
    meridian::state::{OrderSide, Ticker},
    solana_signer::Signer,
};

const DAY: i64 = 1_747_000_000;
const STRIKE: u64 = 680_000_000;
const ONE: u64 = 1_000_000;

fn ceil_cost(price: u64, size: u64) -> u64 {
    ((price as u128) * (size as u128)).div_ceil(ONE as u128) as u64
}

fn ensure_yes_ata(f: &mut Fixture, user: solana_pubkey::Pubkey, market: &solana_pubkey::Pubkey) {
    let (yes_mint, _) = yes_mint_pda(market);
    let yes_ata = ata(&user, &yes_mint);
    if read_token_account(&f.svm, &yes_ata).is_none() {
        seed_token_account(&mut f.svm, &yes_ata, &yes_mint, &user, 0);
    }
}

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

/// The collateralization invariant: vault == PAYOFF_UNIT * pairs_minted - winning_redeemed.
fn assert_collateralization(f: &Fixture, market: &solana_pubkey::Pubkey) {
    let m = read_market(&f.svm, market);
    let (vault, _) = vault_pda(market);
    let expected = ONE * m.pairs_minted - m.winning_redeemed;
    assert_eq!(
        token_balance(&f.svm, &vault),
        expected,
        "invariant #1: vault == 1e6*pairs_minted - winning_redeemed"
    );
}

/// Escrow reconciliation: usdc_escrow == Σ ceil(price*size) over bids;
/// yes_escrow == Σ size over asks.
fn assert_escrow_reconciles(f: &Fixture, market: &solana_pubkey::Pubkey) {
    let (ob_pda, _) = order_book_pda(market);
    let ob = read_order_book(&f.svm, &ob_pda);
    let want_usdc: u64 = ob.bids.iter().map(|o| ceil_cost(o.price, o.size)).sum();
    let want_yes: u64 = ob.asks.iter().map(|o| o.size).sum();
    let (usdc_escrow, _) = usdc_escrow_pda(market);
    let (yes_escrow, _) = yes_escrow_pda(market);
    assert_eq!(
        token_balance(&f.svm, &usdc_escrow),
        want_usdc,
        "usdc escrow == Σ ceil(bid)"
    );
    assert_eq!(
        token_balance(&f.svm, &yes_escrow),
        want_yes,
        "yes escrow == Σ ask size"
    );
}

#[test]
fn trading_never_touches_collateral_vault() {
    let mut f = setup(50 * ONE);
    let market = create_market_and_book(&mut f, Ticker::Meta, STRIKE, DAY);

    // user mints 4 pairs (vault → $4); user2 mints 3 (vault → $7).
    let user = f.user.insecure_clone();
    let user2 = f.user2.insecure_clone();
    mint_pairs_for(&mut f, &user, &market, 4);
    mint_pairs_for(&mut f, &user2, &market, 3);
    assert_collateralization(&f, &market);
    let (vault, _) = vault_pda(&market);
    let vault_after_mint = token_balance(&f.svm, &vault);
    assert_eq!(vault_after_mint, 7 * ONE);

    // A flurry of trading activity: rest, cross, partial, cancel.
    let _up = f.user.pubkey();
    ensure_yes_ata(&mut f, _up, &market); // user can receive Yes
                                          // user2 rests an ask 2.0 @ $0.50 (escrows Yes).
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
    send(&mut f.svm, &f.user2.pubkey(), ix, &[&user2]).expect("ask");
    assert_collateralization(&f, &market); // unchanged by resting

    // user crosses 1.5 of it (market buy). Maker (user2) gets USDC.
    let maker_usdc = ata(&f.user2.pubkey(), &f.usdc_mint);
    let ix = ix_place_order(
        &f.user.pubkey(),
        &f.usdc_mint,
        &market,
        OrderSide::Bid,
        0,
        3 * ONE / 2,
        true,
        &[maker_usdc],
    );
    send(&mut f.svm, &f.user.pubkey(), ix, &[&user]).expect("cross");
    assert_collateralization(&f, &market); // unchanged by matching

    // user rests a bid 2.0 @ $0.40 (escrows USDC), then cancels it.
    let ix = ix_place_order(
        &f.user.pubkey(),
        &f.usdc_mint,
        &market,
        OrderSide::Bid,
        400_000,
        2 * ONE,
        false,
        &[],
    );
    send(&mut f.svm, &f.user.pubkey(), ix, &[&user]).expect("bid");
    assert_collateralization(&f, &market);
    let refund_to = ata(&f.user.pubkey(), &f.usdc_mint);
    // The bid's seq: find it.
    let (ob_pda, _) = order_book_pda(&market);
    let seq = read_order_book(&f.svm, &ob_pda)
        .bids
        .iter()
        .find(|o| o.owner == f.user.pubkey())
        .unwrap()
        .seq;
    let ix = ix_cancel_order(&f.user.pubkey(), &market, OrderSide::Bid, seq, &refund_to);
    send(&mut f.svm, &f.user.pubkey(), ix, &[&user]).expect("cancel");

    // Through all of it, the vault is exactly what minting set — trading never touched it.
    assert_collateralization(&f, &market);
    assert_eq!(
        token_balance(&f.svm, &vault),
        vault_after_mint,
        "vault untouched by trading"
    );
}

#[test]
fn escrow_reconciles_with_resting_book() {
    let mut f = setup(100 * ONE);
    let market = create_market_and_book(&mut f, Ticker::Meta, STRIKE, DAY);
    let user = f.user.insecure_clone();
    let user2 = f.user2.insecure_clone();
    let _up = f.user.pubkey();
    ensure_yes_ata(&mut f, _up, &market);

    // user rests three bids at odd prices (exercise ceil rounding).
    for (p, s) in [(333_333u64, ONE), (650_000, 2 * ONE), (1, 3)] {
        let ix = ix_place_order(
            &f.user.pubkey(),
            &f.usdc_mint,
            &market,
            OrderSide::Bid,
            p,
            s,
            false,
            &[],
        );
        send(&mut f.svm, &f.user.pubkey(), ix, &[&user]).expect("bid");
    }
    // user2 mints and rests two asks.
    mint_pairs_for(&mut f, &user2, &market, 5);
    for (p, s) in [(700_000u64, 2 * ONE), (900_000, ONE)] {
        let ix = ix_place_order(
            &f.user2.pubkey(),
            &f.usdc_mint,
            &market,
            OrderSide::Ask,
            p,
            s,
            false,
            &[],
        );
        send(&mut f.svm, &f.user2.pubkey(), ix, &[&user2]).expect("ask");
    }
    assert_escrow_reconciles(&f, &market);
}

#[test]
fn four_trade_paths_on_one_book() {
    // One book (Yes vs USDC). Verify each of the four user actions resolves correctly.
    let mut f = setup(100 * ONE);
    let market = create_market_and_book(&mut f, Ticker::Meta, STRIKE, DAY);
    let (yes_mint, _) = yes_mint_pda(&market);
    let (no_mint, _) = no_mint_pda(&market);
    let lp = f.user2.insecure_clone(); // liquidity provider posts the resting side
    let trader = f.user.insecure_clone();
    let _up = f.user.pubkey();
    ensure_yes_ata(&mut f, _up, &market);
    let _up2 = f.user2.pubkey();
    ensure_yes_ata(&mut f, _up2, &market);

    // --- BUY YES: trader buys Yes from a resting ask. ---
    mint_pairs_for(&mut f, &lp, &market, 4); // lp has 4 Yes to sell
    let ix = ix_place_order(
        &f.user2.pubkey(),
        &f.usdc_mint,
        &market,
        OrderSide::Ask,
        600_000,
        ONE,
        false,
        &[],
    );
    send(&mut f.svm, &f.user2.pubkey(), ix, &[&lp]).expect("lp ask");
    let lp_usdc = ata(&f.user2.pubkey(), &f.usdc_mint);
    let ix = ix_place_order(
        &f.user.pubkey(),
        &f.usdc_mint,
        &market,
        OrderSide::Bid,
        0,
        ONE,
        true,
        &[lp_usdc],
    );
    send(&mut f.svm, &f.user.pubkey(), ix, &[&trader]).expect("buy yes");
    assert_eq!(
        token_balance(&f.svm, &ata(&f.user.pubkey(), &yes_mint)),
        ONE,
        "Buy Yes → holds 1 Yes"
    );

    // --- SELL YES: trader sells the Yes back into a resting bid. ---
    let ix = ix_place_order(
        &f.user2.pubkey(),
        &f.usdc_mint,
        &market,
        OrderSide::Bid,
        550_000,
        ONE,
        false,
        &[],
    );
    send(&mut f.svm, &f.user2.pubkey(), ix, &[&lp]).expect("lp bid");
    let lp_yes = ata(&f.user2.pubkey(), &yes_mint);
    let usdc_before = token_balance(&f.svm, &ata(&f.user.pubkey(), &f.usdc_mint));
    let ix = ix_place_order(
        &f.user.pubkey(),
        &f.usdc_mint,
        &market,
        OrderSide::Ask,
        0,
        ONE,
        true,
        &[lp_yes],
    );
    send(&mut f.svm, &f.user.pubkey(), ix, &[&trader]).expect("sell yes");
    assert_eq!(
        token_balance(&f.svm, &ata(&f.user.pubkey(), &yes_mint)),
        0,
        "Sell Yes → no Yes left"
    );
    assert_eq!(
        token_balance(&f.svm, &ata(&f.user.pubkey(), &f.usdc_mint)),
        usdc_before + 550_000,
        "Sell Yes → received $0.55"
    );

    // --- BUY NO: mint a pair, sell the Yes, keep the No (effective No cost = $1 − Yes proceeds). ---
    // lp posts a bid to buy the Yes leg.
    let ix = ix_place_order(
        &f.user2.pubkey(),
        &f.usdc_mint,
        &market,
        OrderSide::Bid,
        700_000,
        ONE,
        false,
        &[],
    );
    send(&mut f.svm, &f.user2.pubkey(), ix, &[&lp]).expect("lp bid for no");
    // Capture balances BEFORE the whole Buy-No path (mint pair, then sell the Yes leg).
    let no_before = token_balance(&f.svm, &ata(&f.user.pubkey(), &no_mint));
    let usdc_before_buy_no = token_balance(&f.svm, &ata(&f.user.pubkey(), &f.usdc_mint));
    mint_pairs_for(&mut f, &trader, &market, 1); // mint costs $1.00, gives 1 Yes + 1 No
    let lp_yes = ata(&f.user2.pubkey(), &yes_mint);
    let ix = ix_place_order(
        &f.user.pubkey(),
        &f.usdc_mint,
        &market,
        OrderSide::Ask,
        0,
        ONE,
        true,
        &[lp_yes],
    );
    send(&mut f.svm, &f.user.pubkey(), ix, &[&trader]).expect("sell yes leg of buy-no");
    // Net Buy-No: +1 No; net USDC = −$1.00 (mint) + $0.70 (Yes sale) = −$0.30 effective No cost.
    assert_eq!(
        token_balance(&f.svm, &ata(&f.user.pubkey(), &no_mint)),
        no_before + ONE,
        "Buy No → +1 No"
    );
    assert_eq!(
        token_balance(&f.svm, &ata(&f.user.pubkey(), &f.usdc_mint)),
        usdc_before_buy_no - ONE + 700_000,
        "Buy No → effective No cost $0.30 ($1 mint − $0.70 Yes sale)"
    );

    // --- SELL NO: buy a Yes from a resting ask → now hold Yes+No (redeemable $1), closing No. ---
    let ix = ix_place_order(
        &f.user2.pubkey(),
        &f.usdc_mint,
        &market,
        OrderSide::Ask,
        650_000,
        ONE,
        false,
        &[],
    );
    send(&mut f.svm, &f.user2.pubkey(), ix, &[&lp]).expect("lp ask for sell-no");
    let yes_before = token_balance(&f.svm, &ata(&f.user.pubkey(), &yes_mint));
    let lp_usdc = ata(&f.user2.pubkey(), &f.usdc_mint);
    let ix = ix_place_order(
        &f.user.pubkey(),
        &f.usdc_mint,
        &market,
        OrderSide::Bid,
        0,
        ONE,
        true,
        &[lp_usdc],
    );
    send(&mut f.svm, &f.user.pubkey(), ix, &[&trader]).expect("buy yes leg of sell-no");
    assert_eq!(
        token_balance(&f.svm, &ata(&f.user.pubkey(), &yes_mint)),
        yes_before + ONE,
        "Sell No → bought a Yes (now holds Yes+No, redeemable $1)"
    );

    // Throughout, the collateral vault stayed exactly at pairs_minted (trading is escrow-only).
    assert_collateralization(&f, &market);
}
