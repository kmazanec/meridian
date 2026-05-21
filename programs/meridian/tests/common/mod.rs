//! Shared test scaffolding for F-02 (mint/redeem) LiteSVM tests.
//!
//! Provides a fixture that loads the program, seeds a USDC mint + a funded user,
//! and writes the singleton `Config` directly (a test shim — `initialize_config`
//! is proven separately in F-01; here we just need a Config to exist). Also
//! exposes PDA derivations and instruction builders.

#![allow(dead_code)]

use {
    anchor_lang::{
        solana_program::instruction::Instruction, AccountDeserialize, AccountSerialize,
        InstructionData, ToAccountMetas,
    },
    litesvm::LiteSVM,
    meridian::{
        constants::{
            CONFIG_SEED, MARKET_SEED, MINT_AUTH_SEED, NO_MINT_SEED, NUM_TICKERS, ORDER_BOOK_SEED,
            USDC_ESCROW_SEED, VAULT_SEED, YES_ESCROW_SEED, YES_MINT_SEED,
        },
        state::{Config, Market, OrderBook, OrderSide, Outcome, Ticker, TickerConfig},
    },
    solana_account::Account,
    solana_keypair::Keypair,
    solana_message::{Message, VersionedMessage},
    solana_program_option::COption,
    solana_program_pack::Pack,
    solana_pubkey::Pubkey,
    solana_signer::Signer,
    solana_transaction::versioned::VersionedTransaction,
    spl_token_interface::state::{Account as SplAccount, AccountState, Mint as SplMint},
};

pub const USDC_DECIMALS: u8 = 6;

/// The Rent sysvar id (SysvarRent111111111111111111111111111111111).
pub const RENT_SYSVAR_ID: Pubkey =
    Pubkey::from_str_const("SysvarRent111111111111111111111111111111111");

pub struct Fixture {
    pub svm: LiteSVM,
    pub admin: Keypair,
    pub user: Keypair,
    /// A second funded user (USDC ATA seeded), for two-sided order-book tests.
    pub user2: Keypair,
    pub usdc_mint: Pubkey,
}

pub fn token_program_id() -> Pubkey {
    spl_token_interface::ID
}

pub fn ata(owner: &Pubkey, mint: &Pubkey) -> Pubkey {
    // Associated token account derivation (SPL ATA program).
    Pubkey::find_program_address(
        &[owner.as_ref(), spl_token_interface::ID.as_ref(), mint.as_ref()],
        &spl_associated_token_account_id(),
    )
    .0
}

fn spl_associated_token_account_id() -> Pubkey {
    // ATA program id.
    Pubkey::from_str_const("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL")
}

pub fn config_pda() -> (Pubkey, u8) {
    Pubkey::find_program_address(&[CONFIG_SEED], &meridian::id())
}

pub fn market_pda(ticker: Ticker, strike: u64, trading_day: i64) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[
            MARKET_SEED,
            &[ticker as u8],
            &strike.to_le_bytes(),
            &trading_day.to_le_bytes(),
        ],
        &meridian::id(),
    )
}

pub fn mint_authority_pda(market: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(&[MINT_AUTH_SEED, market.as_ref()], &meridian::id())
}
pub fn yes_mint_pda(market: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(&[YES_MINT_SEED, market.as_ref()], &meridian::id())
}
pub fn no_mint_pda(market: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(&[NO_MINT_SEED, market.as_ref()], &meridian::id())
}
pub fn vault_pda(market: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(&[VAULT_SEED, market.as_ref()], &meridian::id())
}
pub fn order_book_pda(market: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(&[ORDER_BOOK_SEED, market.as_ref()], &meridian::id())
}
pub fn usdc_escrow_pda(market: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(&[USDC_ESCROW_SEED, market.as_ref()], &meridian::id())
}
pub fn yes_escrow_pda(market: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(&[YES_ESCROW_SEED, market.as_ref()], &meridian::id())
}

/// Read an OrderBook account.
pub fn read_order_book(svm: &LiteSVM, order_book: &Pubkey) -> OrderBook {
    let acct = svm.get_account(order_book).expect("order book exists");
    OrderBook::try_deserialize(&mut acct.data.as_slice()).expect("deserialize OrderBook")
}

/// Build a fixture with the program loaded, a USDC mint, a funded user (with a
/// USDC ATA holding `user_usdc` base units), and a seeded Config singleton.
pub fn setup(user_usdc: u64) -> Fixture {
    let mut svm = LiteSVM::new();
    let program_bytes = include_bytes!("../../../../target/deploy/meridian.so");
    svm.add_program(meridian::id(), program_bytes).unwrap();

    let admin = Keypair::new();
    let user = Keypair::new();
    let user2 = Keypair::new();
    svm.airdrop(&admin.pubkey(), 100_000_000_000).unwrap();
    svm.airdrop(&user.pubkey(), 100_000_000_000).unwrap();
    svm.airdrop(&user2.pubkey(), 100_000_000_000).unwrap();

    // USDC mint (no mint authority needed in tests; we seed balances directly).
    let usdc_mint = Pubkey::new_unique();
    seed_mint(&mut svm, &usdc_mint, USDC_DECIMALS, None);

    // User USDC ATA with a starting balance.
    let user_usdc_ata = ata(&user.pubkey(), &usdc_mint);
    seed_token_account(&mut svm, &user_usdc_ata, &usdc_mint, &user.pubkey(), user_usdc);
    // Second user funded with the same starting balance.
    let user2_usdc_ata = ata(&user2.pubkey(), &usdc_mint);
    seed_token_account(&mut svm, &user2_usdc_ata, &usdc_mint, &user2.pubkey(), user_usdc);

    // Seed the Config singleton directly (test shim).
    seed_config(&mut svm, &admin.pubkey(), &usdc_mint);

    Fixture {
        svm,
        admin,
        user,
        user2,
        usdc_mint,
    }
}

/// Pack and inject an SPL mint account.
pub fn seed_mint(svm: &mut LiteSVM, mint: &Pubkey, decimals: u8, authority: Option<Pubkey>) {
    let m = SplMint {
        mint_authority: authority.map(COption::Some).unwrap_or(COption::None),
        supply: 0,
        decimals,
        is_initialized: true,
        freeze_authority: COption::None,
    };
    let mut data = vec![0u8; SplMint::LEN];
    m.pack_into_slice(&mut data);
    svm.set_account(
        *mint,
        Account {
            lamports: svm.minimum_balance_for_rent_exemption(SplMint::LEN),
            data,
            owner: spl_token_interface::ID,
            executable: false,
            rent_epoch: 0,
        },
    )
    .unwrap();
}

/// Pack and inject an SPL token account with a balance.
pub fn seed_token_account(
    svm: &mut LiteSVM,
    addr: &Pubkey,
    mint: &Pubkey,
    owner: &Pubkey,
    amount: u64,
) {
    let a = SplAccount {
        mint: *mint,
        owner: *owner,
        amount,
        delegate: COption::None,
        state: AccountState::Initialized,
        is_native: COption::None,
        delegated_amount: 0,
        close_authority: COption::None,
    };
    let mut data = vec![0u8; SplAccount::LEN];
    a.pack_into_slice(&mut data);
    svm.set_account(
        *addr,
        Account {
            lamports: svm.minimum_balance_for_rent_exemption(SplAccount::LEN),
            data,
            owner: spl_token_interface::ID,
            executable: false,
            rent_epoch: 0,
        },
    )
    .unwrap();
}

/// Write the singleton Config account directly (Anchor-serialized).
pub fn seed_config(svm: &mut LiteSVM, admin: &Pubkey, usdc_mint: &Pubkey) {
    let (config_key, bump) = config_pda();
    let tickers: [TickerConfig; NUM_TICKERS] = core::array::from_fn(|i| TickerConfig {
        ticker: ticker_by_index(i),
        feed_id: [i as u8; 32],
    });
    let config = Config {
        admin: *admin,
        usdc_mint: *usdc_mint,
        tickers,
        paused: false,
        fee_account: None,
        bump,
    };
    let mut data = Vec::new();
    config.try_serialize(&mut data).unwrap();
    svm.set_account(
        config_key,
        Account {
            lamports: svm.minimum_balance_for_rent_exemption(data.len()),
            data,
            owner: meridian::id(),
            executable: false,
            rent_epoch: 0,
        },
    )
    .unwrap();
}

pub fn ticker_by_index(i: usize) -> Ticker {
    [
        Ticker::Aapl,
        Ticker::Msft,
        Ticker::Googl,
        Ticker::Amzn,
        Ticker::Nvda,
        Ticker::Meta,
        Ticker::Tsla,
    ][i]
}

/// Read a Market account.
pub fn read_market(svm: &LiteSVM, market: &Pubkey) -> Market {
    let acct = svm.get_account(market).expect("market exists");
    Market::try_deserialize(&mut acct.data.as_slice()).expect("deserialize Market")
}

/// Read an SPL token account amount (0 if missing).
pub fn token_balance(svm: &LiteSVM, addr: &Pubkey) -> u64 {
    match svm.get_account(addr) {
        Some(a) if a.data.len() >= SplAccount::LEN => {
            SplAccount::unpack(&a.data[..SplAccount::LEN]).map(|t| t.amount).unwrap_or(0)
        }
        _ => 0,
    }
}

/// Read a full SPL token account (mint/owner/amount), `None` if missing/invalid.
pub fn read_token_account(svm: &LiteSVM, addr: &Pubkey) -> Option<SplAccount> {
    match svm.get_account(addr) {
        Some(a) if a.data.len() >= SplAccount::LEN => {
            SplAccount::unpack(&a.data[..SplAccount::LEN]).ok()
        }
        _ => None,
    }
}

/// Set a market to settled with a given outcome (test shim for redeem — settle
/// is F-04). Rewrites the on-chain Market account.
pub fn force_settle(svm: &mut LiteSVM, market: &Pubkey, outcome: Outcome) {
    let mut m = read_market(svm, market);
    m.state = meridian::state::MarketState::Settled;
    m.outcome = outcome;
    m.settlement_price = Some(0);
    m.settled_at = Some(1);
    let mut data = Vec::new();
    m.try_serialize(&mut data).unwrap();
    let existing = svm.get_account(market).unwrap();
    svm.set_account(
        *market,
        Account {
            lamports: existing.lamports,
            data,
            owner: meridian::id(),
            executable: existing.executable,
            rent_epoch: existing.rent_epoch,
        },
    )
    .unwrap();
}

/// Set the Config paused flag.
pub fn set_paused(svm: &mut LiteSVM, paused: bool) {
    let (config_key, _) = config_pda();
    let acct = svm.get_account(&config_key).unwrap();
    let mut cfg = Config::try_deserialize(&mut acct.data.as_slice()).unwrap();
    cfg.paused = paused;
    let mut data = Vec::new();
    cfg.try_serialize(&mut data).unwrap();
    svm.set_account(
        config_key,
        Account {
            lamports: acct.lamports,
            data,
            owner: meridian::id(),
            executable: acct.executable,
            rent_epoch: acct.rent_epoch,
        },
    )
    .unwrap();
}

/// Send a single-instruction transaction signed by `signers`.
///
/// Expires the blockhash first so repeated identical transactions in a test
/// aren't rejected by the runtime's dedup as `AlreadyProcessed` — each send
/// stands on its own and any rejection is the program's, not the harness's.
pub fn send(
    svm: &mut LiteSVM,
    payer: &Pubkey,
    ix: Instruction,
    signers: &[&Keypair],
) -> Result<(), litesvm::types::FailedTransactionMetadata> {
    svm.expire_blockhash();
    let blockhash = svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(payer), &blockhash);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), signers).unwrap();
    svm.send_transaction(tx).map(|_| ())
}

// -------- instruction builders --------

pub fn ix_create_strike_market(
    admin: &Pubkey,
    usdc_mint: &Pubkey,
    ticker: Ticker,
    strike: u64,
    trading_day: i64,
) -> Instruction {
    let (config, _) = config_pda();
    let (market, _) = market_pda(ticker, strike, trading_day);
    let (mint_authority, _) = mint_authority_pda(&market);
    let (yes_mint, _) = yes_mint_pda(&market);
    let (no_mint, _) = no_mint_pda(&market);
    let (vault, _) = vault_pda(&market);
    Instruction::new_with_bytes(
        meridian::id(),
        &meridian::instruction::CreateStrikeMarket {
            args: meridian::instructions::CreateStrikeMarketArgs {
                ticker,
                strike,
                trading_day,
            },
        }
        .data(),
        meridian::accounts::CreateStrikeMarket {
            admin: *admin,
            config,
            usdc_mint: *usdc_mint,
            market,
            mint_authority,
            yes_mint,
            no_mint,
            vault,
            token_program: token_program_id(),
            system_program: anchor_lang::system_program::ID,
            rent: RENT_SYSVAR_ID,
        }
        .to_account_metas(None),
    )
}

pub fn ix_mint_pair(
    user: &Pubkey,
    usdc_mint: &Pubkey,
    market: &Pubkey,
) -> Instruction {
    let (config, _) = config_pda();
    let (mint_authority, _) = mint_authority_pda(market);
    let (yes_mint, _) = yes_mint_pda(market);
    let (no_mint, _) = no_mint_pda(market);
    let (vault, _) = vault_pda(market);
    Instruction::new_with_bytes(
        meridian::id(),
        &meridian::instruction::MintPair {}.data(),
        meridian::accounts::MintPair {
            user: *user,
            config,
            market: *market,
            mint_authority,
            yes_mint,
            no_mint,
            vault,
            usdc_mint: *usdc_mint,
            user_usdc: ata(user, usdc_mint),
            user_yes: ata(user, &yes_mint),
            user_no: ata(user, &no_mint),
            token_program: token_program_id(),
            associated_token_program: spl_associated_token_account_id(),
            system_program: anchor_lang::system_program::ID,
        }
        .to_account_metas(None),
    )
}

pub fn ix_redeem(
    user: &Pubkey,
    market: &Pubkey,
    side: meridian::instructions::RedeemSide,
    amount: u64,
    user_tokens: &Pubkey,
    user_usdc: &Pubkey,
) -> Instruction {
    let (mint_authority, _) = mint_authority_pda(market);
    let (yes_mint, _) = yes_mint_pda(market);
    let (no_mint, _) = no_mint_pda(market);
    let (vault, _) = vault_pda(market);
    Instruction::new_with_bytes(
        meridian::id(),
        &meridian::instruction::Redeem { side, amount }.data(),
        meridian::accounts::Redeem {
            user: *user,
            market: *market,
            mint_authority,
            yes_mint,
            no_mint,
            vault,
            user_tokens: *user_tokens,
            user_usdc: *user_usdc,
            token_program: token_program_id(),
        }
        .to_account_metas(None),
    )
}

pub fn ix_init_order_book(payer: &Pubkey, usdc_mint: &Pubkey, market: &Pubkey) -> Instruction {
    let (order_book, _) = order_book_pda(market);
    let (mint_authority, _) = mint_authority_pda(market);
    let (yes_mint, _) = yes_mint_pda(market);
    let (vault, _) = vault_pda(market);
    let (usdc_escrow, _) = usdc_escrow_pda(market);
    let (yes_escrow, _) = yes_escrow_pda(market);
    Instruction::new_with_bytes(
        meridian::id(),
        &meridian::instruction::InitOrderBook {}.data(),
        meridian::accounts::InitOrderBook {
            payer: *payer,
            market: *market,
            order_book,
            mint_authority,
            yes_mint,
            usdc_mint: *usdc_mint,
            vault,
            usdc_escrow,
            yes_escrow,
            token_program: token_program_id(),
            system_program: anchor_lang::system_program::ID,
            rent: RENT_SYSVAR_ID,
        }
        .to_account_metas(None),
    )
}

pub fn ix_grow_order_book(payer: &Pubkey, market: &Pubkey) -> Instruction {
    let (order_book, _) = order_book_pda(market);
    Instruction::new_with_bytes(
        meridian::id(),
        &meridian::instruction::GrowOrderBook {}.data(),
        meridian::accounts::GrowOrderBook {
            payer: *payer,
            market: *market,
            order_book,
            system_program: anchor_lang::system_program::ID,
        }
        .to_account_metas(None),
    )
}

/// Build a `place_order` instruction. `maker_accounts` are appended as
/// `remaining_accounts` (the maker counterparty token accounts touched by any fills);
/// pass an empty slice for a purely-resting (non-crossing) order.
#[allow(clippy::too_many_arguments)]
pub fn ix_place_order(
    user: &Pubkey,
    usdc_mint: &Pubkey,
    market: &Pubkey,
    side: OrderSide,
    price: u64,
    size: u64,
    is_market: bool,
    maker_accounts: &[Pubkey],
) -> Instruction {
    let (config, _) = config_pda();
    let (order_book, _) = order_book_pda(market);
    let (mint_authority, _) = mint_authority_pda(market);
    let (yes_mint, _) = yes_mint_pda(market);
    let (usdc_escrow, _) = usdc_escrow_pda(market);
    let (yes_escrow, _) = yes_escrow_pda(market);

    let mut metas = meridian::accounts::PlaceOrder {
        user: *user,
        config,
        market: *market,
        order_book,
        mint_authority,
        yes_mint,
        usdc_escrow,
        yes_escrow,
        user_usdc: ata(user, usdc_mint),
        user_yes: ata(user, &yes_mint),
        token_program: token_program_id(),
    }
    .to_account_metas(None);
    for acct in maker_accounts {
        metas.push(anchor_lang::solana_program::instruction::AccountMeta::new(*acct, false));
    }
    Instruction::new_with_bytes(
        meridian::id(),
        &meridian::instruction::PlaceOrder {
            args: meridian::instructions::PlaceOrderArgs {
                side,
                price,
                size,
                is_market,
            },
        }
        .data(),
        metas,
    )
}

#[allow(clippy::too_many_arguments)]
pub fn ix_cancel_order(
    user: &Pubkey,
    market: &Pubkey,
    side: OrderSide,
    seq: u64,
    refund_to: &Pubkey,
) -> Instruction {
    let (order_book, _) = order_book_pda(market);
    let (mint_authority, _) = mint_authority_pda(market);
    let (usdc_escrow, _) = usdc_escrow_pda(market);
    let (yes_escrow, _) = yes_escrow_pda(market);
    Instruction::new_with_bytes(
        meridian::id(),
        &meridian::instruction::CancelOrder {
            args: meridian::instructions::CancelOrderArgs { side, seq },
        }
        .data(),
        meridian::accounts::CancelOrder {
            user: *user,
            market: *market,
            order_book,
            mint_authority,
            usdc_escrow,
            yes_escrow,
            refund_to: *refund_to,
            token_program: token_program_id(),
        }
        .to_account_metas(None),
    )
}

/// Create a market AND a fully-grown, wired order book. The common path for the
/// place/cancel/match tests. Returns the market pubkey.
pub fn create_market_and_book(
    f: &mut Fixture,
    ticker: Ticker,
    strike: u64,
    trading_day: i64,
) -> Pubkey {
    let admin = f.admin.insecure_clone();
    let ix = ix_create_strike_market(&f.admin.pubkey(), &f.usdc_mint, ticker, strike, trading_day);
    send(&mut f.svm, &f.admin.pubkey(), ix, &[&admin]).expect("create market");
    let market = market_pda(ticker, strike, trading_day).0;

    let payer = f.admin.insecure_clone();
    let ix = ix_init_order_book(&f.admin.pubkey(), &f.usdc_mint, &market);
    send(&mut f.svm, &f.admin.pubkey(), ix, &[&payer]).expect("init order book");
    let ix = ix_grow_order_book(&f.admin.pubkey(), &market);
    send(&mut f.svm, &f.admin.pubkey(), ix, &[&payer]).expect("grow order book");
    market
}
