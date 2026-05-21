//! F-01 acceptance tests for `initialize_config`, run in-process with LiteSVM.
//!
//! Covers: happy path (Config fields written correctly), re-initialization
//! rejected (idempotency via PDA `init` — asserted strongly), the optional
//! `fee_account` variant, and the upgrade-authority authorization gate
//! (only the program's upgrade authority may initialize config).

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
    solana_account::Account,
    solana_keypair::Keypair,
    solana_loader_v3_interface::state::UpgradeableLoaderState,
    solana_message::{Message, VersionedMessage},
    solana_program_option::COption,
    solana_program_pack::Pack,
    solana_pubkey::Pubkey,
    solana_sdk_ids::bpf_loader_upgradeable,
    solana_signer::Signer,
    solana_transaction::versioned::VersionedTransaction,
    spl_token_interface::state::Mint as SplMint,
};

/// A test fixture holding the SVM and the keypairs/keys the tests reference.
struct Fixture {
    svm: LiteSVM,
    /// The program's upgrade authority (and thus the only valid config admin).
    upgrade_authority: Keypair,
    usdc_mint: Pubkey,
}

fn program_data_address() -> Pubkey {
    Pubkey::find_program_address(&[meridian::id().as_ref()], &bpf_loader_upgradeable::id()).0
}

fn config_pda() -> (Pubkey, u8) {
    Pubkey::find_program_address(&[CONFIG_SEED], &meridian::id())
}

/// Build a fixture: program added under the upgradeable loader with a ProgramData
/// account whose upgrade authority is a known keypair, plus a valid USDC mint.
fn setup() -> Fixture {
    let mut svm = LiteSVM::new();
    let program_bytes = include_bytes!("../../../target/deploy/meridian.so");

    // Add the program under the upgradeable loader (LiteSVM creates a ProgramData
    // account, but with upgrade_authority = None).
    svm.add_program_with_loader(meridian::id(), program_bytes, bpf_loader_upgradeable::id())
        .unwrap();

    // Overwrite ProgramData so its upgrade authority is our known keypair.
    let upgrade_authority = Keypair::new();
    let pd_addr = program_data_address();
    let existing = svm.get_account(&pd_addr).expect("program data exists");
    let meta_len = UpgradeableLoaderState::size_of_programdata_metadata();
    let mut data = existing.data.clone();
    let header = bincode::serialize(&UpgradeableLoaderState::ProgramData {
        slot: 0,
        upgrade_authority_address: Some(upgrade_authority.pubkey()),
    })
    .unwrap();
    // The serialized header fits within the reserved metadata region.
    data[..header.len()].copy_from_slice(&header);
    // Zero any metadata bytes between the header and the program bytes.
    for b in data.iter_mut().take(meta_len).skip(header.len()) {
        *b = 0;
    }
    svm.set_account(
        pd_addr,
        Account {
            lamports: existing.lamports,
            data,
            owner: existing.owner,
            executable: existing.executable,
            rent_epoch: existing.rent_epoch,
        },
    )
    .unwrap();

    // Seed a valid USDC mint account (6 decimals).
    let usdc_mint = Pubkey::new_unique();
    let mint = SplMint {
        mint_authority: COption::None,
        supply: 0,
        decimals: 6,
        is_initialized: true,
        freeze_authority: COption::None,
    };
    let mut mint_bytes = [0u8; SplMint::LEN];
    mint.pack_into_slice(&mut mint_bytes);
    svm.set_account(
        usdc_mint,
        Account {
            lamports: svm.minimum_balance_for_rent_exemption(SplMint::LEN),
            data: mint_bytes.to_vec(),
            owner: spl_token_interface::ID,
            executable: false,
            rent_epoch: 0,
        },
    )
    .unwrap();

    svm.airdrop(&upgrade_authority.pubkey(), 10_000_000_000).unwrap();

    Fixture {
        svm,
        upgrade_authority,
        usdc_mint,
    }
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
        feed_id: [i as u8; 32],
    })
}

fn build_init_ix(admin: &Pubkey, usdc_mint: &Pubkey, fee_account: Option<Pubkey>) -> Instruction {
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
            program: meridian::id(),
            program_data: program_data_address(),
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
    Config::try_deserialize(&mut acct.data.as_slice()).expect("deserialize Config")
}

#[test]
fn initialize_config_happy_path() {
    let mut f = setup();
    let admin = f.upgrade_authority.insecure_clone();

    let ix = build_init_ix(&admin.pubkey(), &f.usdc_mint, None);
    send(&mut f.svm, &admin, ix).expect("initialize_config should succeed");

    let cfg = read_config(&f.svm);
    assert_eq!(cfg.admin, admin.pubkey(), "admin recorded");
    assert_eq!(cfg.usdc_mint, f.usdc_mint, "usdc mint recorded");
    assert!(!cfg.paused, "starts unpaused");
    assert_eq!(cfg.fee_account, None, "no fee account");
    let (_, expected_bump) = config_pda();
    assert_eq!(cfg.bump, expected_bump, "bump recorded");

    let expected = sample_tickers();
    for i in 0..NUM_TICKERS {
        assert_eq!(cfg.tickers[i].ticker, expected[i].ticker, "ticker {i}");
        assert_eq!(cfg.tickers[i].feed_id, expected[i].feed_id, "feed id {i}");
    }
}

#[test]
fn initialize_config_with_fee_account() {
    let mut f = setup();
    let admin = f.upgrade_authority.insecure_clone();
    let fee = Pubkey::new_unique();

    let ix = build_init_ix(&admin.pubkey(), &f.usdc_mint, Some(fee));
    send(&mut f.svm, &admin, ix).expect("initialize_config with fee should succeed");

    let cfg = read_config(&f.svm);
    assert_eq!(cfg.fee_account, Some(fee), "fee account recorded");
}

#[test]
fn initialize_config_rejects_reinitialization() {
    let mut f = setup();
    let admin = f.upgrade_authority.insecure_clone();

    let ix1 = build_init_ix(&admin.pubkey(), &f.usdc_mint, None);
    send(&mut f.svm, &admin, ix1).expect("first init succeeds");
    let cfg_before = read_config(&f.svm);

    // Second call with a DISTINCT payload (different fee_account) so the failure
    // can't be runtime transaction-dedup — it must be the program's `init` guard.
    let other_fee = Pubkey::new_unique();
    let ix2 = build_init_ix(&admin.pubkey(), &f.usdc_mint, Some(other_fee));
    let res = send(&mut f.svm, &admin, ix2);
    assert!(res.is_err(), "re-initialization must be rejected");

    // And the config must be UNCHANGED — proves the second init did not mutate it.
    let cfg_after = read_config(&f.svm);
    assert_eq!(cfg_after.admin, cfg_before.admin, "admin unchanged");
    assert_eq!(cfg_after.fee_account, cfg_before.fee_account, "fee unchanged");
    assert_eq!(cfg_after.fee_account, None, "still the first value, not other_fee");
}

#[test]
fn initialize_config_rejects_non_upgrade_authority() {
    let mut f = setup();
    // A signer that is NOT the program's upgrade authority.
    let imposter = Keypair::new();
    f.svm.airdrop(&imposter.pubkey(), 10_000_000_000).unwrap();

    let ix = build_init_ix(&imposter.pubkey(), &f.usdc_mint, None);
    let res = send(&mut f.svm, &imposter, ix);
    assert!(
        res.is_err(),
        "only the program upgrade authority may initialize config"
    );
}
