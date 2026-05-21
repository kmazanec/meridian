//! F-01 acceptance tests for `initialize_config`, run in-process with LiteSVM.
//!
//! Covers: happy path (Config fields written correctly), re-initialization
//! rejected (idempotency via PDA `init`), and the optional `fee_account` variant.

use {
    anchor_lang::{
        solana_program::instruction::Instruction, AccountDeserialize, InstructionData,
        ToAccountMetas,
    },
    litesvm::LiteSVM,
    meridian::{
        constants::{CONFIG_SEED, NUM_TICKERS},
        instructions::InitializeConfigArgs,
        state::{Config, Ticker, TickerConfig},
    },
    solana_keypair::Keypair,
    solana_message::{Message, VersionedMessage},
    solana_pubkey::Pubkey,
    solana_signer::Signer,
    solana_transaction::versioned::VersionedTransaction,
};

fn load_svm() -> LiteSVM {
    let mut svm = LiteSVM::new();
    let bytes = include_bytes!("../../../target/deploy/meridian.so");
    svm.add_program(meridian::id(), bytes).unwrap();
    svm
}

fn sample_tickers() -> [TickerConfig; NUM_TICKERS] {
    let all = [
        Ticker::Aapl,
        Ticker::Msft,
        Ticker::Googl,
        Ticker::Amzn,
        Ticker::Nvda,
        Ticker::Meta,
        Ticker::Tsla,
    ];
    core::array::from_fn(|i| TickerConfig {
        ticker: all[i],
        // Distinct, deterministic dummy feed ids so we can assert round-trip.
        feed_id: [i as u8; 32],
    })
}

fn config_pda() -> (Pubkey, u8) {
    Pubkey::find_program_address(&[CONFIG_SEED], &meridian::id())
}

fn build_init_ix(
    admin: &Pubkey,
    usdc_mint: &Pubkey,
    fee_account: Option<Pubkey>,
) -> Instruction {
    let (config, _) = config_pda();
    Instruction::new_with_bytes(
        meridian::id(),
        &meridian::instruction::InitializeConfig {
            args: InitializeConfigArgs {
                tickers: sample_tickers(),
                fee_account,
            },
        }
        .data(),
        meridian::accounts::InitializeConfig {
            admin: *admin,
            usdc_mint: *usdc_mint,
            config,
            system_program: anchor_lang::system_program::ID,
        }
        .to_account_metas(None),
    )
}

fn send(
    svm: &mut LiteSVM,
    payer: &Keypair,
    ix: Instruction,
) -> Result<(), litesvm::types::FailedTransactionMetadata> {
    let blockhash = svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&payer.pubkey()), &blockhash);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[payer]).unwrap();
    svm.send_transaction(tx).map(|_| ())
}

fn read_config(svm: &LiteSVM) -> Config {
    let (config_key, _) = config_pda();
    let acct = svm.get_account(&config_key).expect("config account exists");
    // Skip the 8-byte Anchor discriminator.
    Config::try_deserialize(&mut acct.data.as_slice()).expect("deserialize Config")
}

#[test]
fn initialize_config_happy_path() {
    let mut svm = load_svm();
    let admin = Keypair::new();
    svm.airdrop(&admin.pubkey(), 10_000_000_000).unwrap();
    let usdc_mint = Pubkey::new_unique();

    let ix = build_init_ix(&admin.pubkey(), &usdc_mint, None);
    send(&mut svm, &admin, ix).expect("initialize_config should succeed");

    let cfg = read_config(&svm);
    assert_eq!(cfg.admin, admin.pubkey(), "admin recorded");
    assert_eq!(cfg.usdc_mint, usdc_mint, "usdc mint recorded");
    assert!(!cfg.paused, "starts unpaused");
    assert_eq!(cfg.fee_account, None, "no fee account");
    let (_, expected_bump) = config_pda();
    assert_eq!(cfg.bump, expected_bump, "bump recorded");

    // Ticker config round-trips.
    let expected = sample_tickers();
    for i in 0..NUM_TICKERS {
        assert_eq!(cfg.tickers[i].ticker, expected[i].ticker, "ticker {i}");
        assert_eq!(cfg.tickers[i].feed_id, expected[i].feed_id, "feed id {i}");
    }
}

#[test]
fn initialize_config_with_fee_account() {
    let mut svm = load_svm();
    let admin = Keypair::new();
    svm.airdrop(&admin.pubkey(), 10_000_000_000).unwrap();
    let usdc_mint = Pubkey::new_unique();
    let fee = Pubkey::new_unique();

    let ix = build_init_ix(&admin.pubkey(), &usdc_mint, Some(fee));
    send(&mut svm, &admin, ix).expect("initialize_config with fee should succeed");

    let cfg = read_config(&svm);
    assert_eq!(cfg.fee_account, Some(fee), "fee account recorded");
}

#[test]
fn initialize_config_rejects_reinitialization() {
    let mut svm = load_svm();
    let admin = Keypair::new();
    svm.airdrop(&admin.pubkey(), 10_000_000_000).unwrap();
    let usdc_mint = Pubkey::new_unique();

    let ix1 = build_init_ix(&admin.pubkey(), &usdc_mint, None);
    send(&mut svm, &admin, ix1).expect("first init succeeds");

    // Second call must fail: the Config PDA already exists (Anchor `init`).
    let ix2 = build_init_ix(&admin.pubkey(), &usdc_mint, None);
    let res = send(&mut svm, &admin, ix2);
    assert!(res.is_err(), "re-initialization must be rejected");
}
