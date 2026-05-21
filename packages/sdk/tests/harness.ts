/**
 * LiteSVM test harness.
 *
 * Runs the *real* compiled program (`target/deploy/meridian.so`) in-process — the
 * same engine the program's Rust tests use — so SDK builders and PDA derivations are
 * checked against actual on-chain behavior, hermetically and without a validator
 * daemon. Anchor (web3.js v1) builds the instructions; litesvm 0.8.x speaks v1 types,
 * so transactions and account reads flow through with no v1↔v2 bridging.
 */

import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import BN from "bn.js";
import {
  AccountInfoBytes,
  Clock,
  FailedTransactionMetadata,
  LiteSVM,
  TransactionMetadata,
} from "litesvm";
import {
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import {
  ACCOUNT_SIZE,
  AccountLayout,
  MINT_SIZE,
  MintLayout,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { getProgram, type MeridianProgram } from "../src/program";
import { PROGRAM_ID } from "../src/program";
import { ata, configPda } from "../src/pdas";
import { NUM_TICKERS } from "../src/constants";
import { Ticker, tickerToArg } from "../src/types";
import {
  createStrikeMarket,
  initOrderBook,
  growOrderBook,
} from "../src/instructions";

/**
 * Locate the built program shared object. `target/` is gitignored; CI runs
 * `anchor build` before the SDK tests. If it is missing locally, the harness throws
 * a clear, actionable message rather than a cryptic litesvm failure.
 */
export function programSoPath(): string {
  // tests/ -> packages/sdk -> packages -> repo root
  const repoRoot = resolve(__dirname, "..", "..", "..");
  const soPath = resolve(repoRoot, "target", "deploy", "meridian.so");
  if (!existsSync(soPath)) {
    throw new Error(
      `Program binary not found at ${soPath}.\n` +
        `Build it first:  anchor build   (from the repo root)\n` +
        `The SDK's on-chain tests load this .so into LiteSVM.`
    );
  }
  return soPath;
}

/** A connection stub good enough for Anchor to *build* (not send) instructions. */
function builderProvider(): MeridianProgram {
  return getProgram({
    connection: { rpcEndpoint: "http://localhost:8899" },
  } as never);
}

const ONE_SOL = BigInt(1_000_000_000);

export class Harness {
  readonly svm: LiteSVM;
  readonly program: MeridianProgram;
  /** The program admin / default fee payer. */
  readonly admin: Keypair;
  /** A mock USDC mint the harness controls (authority = admin). */
  usdcMint!: PublicKey;

  private constructor() {
    this.svm = new LiteSVM();
    this.svm.addProgramFromFile(PROGRAM_ID, programSoPath());
    this.program = builderProvider();
    this.admin = Keypair.generate();
    this.svm.airdrop(this.admin.publicKey, ONE_SOL * BigInt(100));
  }

  /** Boot a harness with the program loaded and a funded admin. */
  static create(): Harness {
    return new Harness();
  }

  /** Create and fund a fresh keypair (default 100 SOL). */
  user(lamports: bigint = ONE_SOL * BigInt(100)): Keypair {
    const kp = Keypair.generate();
    this.svm.airdrop(kp.publicKey, lamports);
    return kp;
  }

  /** Current on-chain unix time (seconds), from the LiteSVM clock. */
  now(): number {
    return Number(this.svm.getClock().unixTimestamp);
  }

  /** Set the LiteSVM clock's unix timestamp (for settlement-timing tests). */
  setUnixTimestamp(ts: number | bigint): void {
    const clock = this.svm.getClock();
    clock.unixTimestamp = BigInt(ts);
    this.svm.setClock(clock);
  }

  /**
   * Build, sign, and submit a transaction. After each send the blockhash is expired so
   * two *structurally identical* transactions (e.g. re-posting the same order) get
   * distinct signatures — otherwise LiteSVM dedupes them and the second silently fails
   * with empty logs. This mirrors how a real validator advances blockhashes.
   */
  private submit(
    instructions: TransactionInstruction[],
    signers: Keypair[]
  ): TransactionMetadata | FailedTransactionMetadata {
    if (signers.length === 0) {
      throw new Error("send() requires at least one signer (the payer)");
    }
    const tx = new Transaction();
    tx.recentBlockhash = this.svm.latestBlockhash();
    tx.feePayer = signers[0].publicKey;
    for (const ix of instructions) tx.add(ix);
    tx.sign(...signers);
    const res = this.svm.sendTransaction(tx);
    this.svm.expireBlockhash();
    return res;
  }

  /** Send a set of instructions as one transaction signed by `signers[0]` (payer). */
  send(
    instructions: TransactionInstruction[],
    signers: Keypair[]
  ): TransactionMetadata {
    const res = this.submit(instructions, signers);
    if (res instanceof FailedTransactionMetadata) {
      throw new TxError(res);
    }
    return res;
  }

  /** Like {@link send} but returns the failure instead of throwing (for negative tests). */
  trySend(
    instructions: TransactionInstruction[],
    signers: Keypair[]
  ): TransactionMetadata | FailedTransactionMetadata {
    return this.submit(instructions, signers);
  }

  /** Raw account bytes (or null), as the program sees them. */
  account(address: PublicKey): AccountInfoBytes | null {
    return this.svm.getAccount(address);
  }

  /** True if an account exists and is owned by the program (has data). */
  exists(address: PublicKey): boolean {
    const acc = this.svm.getAccount(address);
    return acc !== null && acc.data.length > 0;
  }

  /** Decode an account of a given IDL type using the program coder. */
  decode<T = unknown>(typeName: string, address: PublicKey): T {
    const acc = this.svm.getAccount(address);
    if (!acc) throw new Error(`Account ${address.toBase58()} does not exist`);
    return this.program.coder.accounts.decode<T>(
      typeName,
      Buffer.from(acc.data)
    );
  }

  // --- Domain bootstrap (config + market provisioning) ---

  /**
   * Seed the singleton Config directly (Anchor-encoded), mirroring the program's
   * Rust test shim: per-ticker `feed_id = [i; 32]`, not paused, no fee account.
   * `initialize_config` is exercised by the program's own tests; here we just need a
   * Config to exist so create/mint/settle paths run. Returns the config address.
   */
  async seedConfig(
    usdcMint: PublicKey = this.ensureUsdc()
  ): Promise<PublicKey> {
    const [config, bump] = PublicKey.findProgramAddressSync(
      [Buffer.from("config")],
      PROGRAM_ID
    );
    const tickers = Array.from({ length: NUM_TICKERS }, (_, i) => ({
      ticker: tickerToArg(i as Ticker),
      feedId: Array.from({ length: 32 }, () => i),
    }));
    const buf = await this.program.coder.accounts.encode("config", {
      admin: this.admin.publicKey,
      usdcMint,
      tickers,
      paused: false,
      feeAccount: null,
      bump,
    });
    this.svm.setAccount(config, {
      lamports: Number(
        this.svm.minimumBalanceForRentExemption(BigInt(buf.length))
      ),
      data: buf,
      owner: PROGRAM_ID,
      executable: false,
      rentEpoch: 0,
    });
    return config;
  }

  /** The 32-byte test feed id assigned to a ticker by {@link seedConfig}. */
  static feedId(ticker: Ticker): Uint8Array {
    return new Uint8Array(32).fill(ticker);
  }

  /**
   * Provision a fully tradeable market: `create_strike_market` then the two-step
   * order-book creation (`init_order_book` + `grow_order_book`). Requires a seeded
   * config. Returns the market identity for use with the SDK builders.
   */
  async createMarket(opts: {
    ticker: Ticker;
    strike: BN | number;
    tradingDay: BN | number;
    usdcMint?: PublicKey;
    withBook?: boolean;
  }): Promise<{ ticker: Ticker; strike: BN; tradingDay: BN }> {
    const usdcMint = opts.usdcMint ?? this.ensureUsdc();
    const id = {
      ticker: opts.ticker,
      strike: new BN(opts.strike.toString()),
      tradingDay: new BN(opts.tradingDay.toString()),
    };
    const createIx = await createStrikeMarket(this.program, {
      admin: this.admin.publicKey,
      usdcMint,
      market: id,
    });
    this.send([createIx], [this.admin]);

    if (opts.withBook !== false) {
      const initIx = await initOrderBook(this.program, {
        payer: this.admin.publicKey,
        usdcMint,
        market: id,
      });
      this.send([initIx], [this.admin]);
      const growIx = await growOrderBook(this.program, {
        payer: this.admin.publicKey,
        market: id,
      });
      this.send([growIx], [this.admin]);
    }
    return id;
  }

  // --- SPL helpers (mock USDC + outcome-token balances) ---

  /**
   * Create a mock SPL mint directly via setAccount (no token-program CPI needed for
   * test setup). Returns the mint pubkey. `authority` defaults to the admin.
   */
  createMint(
    decimals: number,
    authority: PublicKey = this.admin.publicKey
  ): PublicKey {
    const mint = Keypair.generate().publicKey;
    const data = Buffer.alloc(MINT_SIZE);
    MintLayout.encode(
      {
        mintAuthorityOption: 1,
        mintAuthority: authority,
        supply: BigInt(0),
        decimals,
        isInitialized: true,
        freezeAuthorityOption: 0,
        freezeAuthority: PublicKey.default,
      },
      data
    );
    this.svm.setAccount(mint, {
      lamports: Number(
        this.svm.minimumBalanceForRentExemption(BigInt(MINT_SIZE))
      ),
      data,
      owner: TOKEN_PROGRAM_ID,
      executable: false,
      rentEpoch: 0,
    });
    return mint;
  }

  /** Ensure the harness's mock USDC mint exists; returns it. */
  ensureUsdc(): PublicKey {
    if (!this.usdcMint) this.usdcMint = this.createMint(6);
    return this.usdcMint;
  }

  /**
   * Create (or overwrite) a token account for `owner`/`mint` at its ATA address with a
   * starting balance. Lets tests fund a user's USDC without a faucet CPI.
   */
  setTokenBalance(
    mint: PublicKey,
    owner: PublicKey,
    amount: BN | number | bigint
  ): PublicKey {
    const addr = ata(mint, owner);
    const data = Buffer.alloc(ACCOUNT_SIZE);
    AccountLayout.encode(
      {
        mint,
        owner,
        amount: BigInt(amount.toString()),
        delegateOption: 0,
        delegate: PublicKey.default,
        state: 1, // initialized
        isNativeOption: 0,
        isNative: BigInt(0),
        delegatedAmount: BigInt(0),
        closeAuthorityOption: 0,
        closeAuthority: PublicKey.default,
      },
      data
    );
    this.svm.setAccount(addr, {
      lamports: Number(
        this.svm.minimumBalanceForRentExemption(BigInt(ACCOUNT_SIZE))
      ),
      data,
      owner: TOKEN_PROGRAM_ID,
      executable: false,
      rentEpoch: 0,
    });
    return addr;
  }

  /** Read an SPL token account's `amount` (base units). Returns 0n if absent. */
  tokenBalance(tokenAccount: PublicKey): bigint {
    const acc = this.svm.getAccount(tokenAccount);
    if (!acc || acc.data.length < ACCOUNT_SIZE) return BigInt(0);
    const decoded = AccountLayout.decode(
      Buffer.from(acc.data.slice(0, ACCOUNT_SIZE))
    );
    return decoded.amount;
  }
}

/** A failed-transaction error that surfaces the program logs for assertions. */
export class TxError extends Error {
  readonly meta: FailedTransactionMetadata;
  constructor(meta: FailedTransactionMetadata) {
    const logs = meta.meta()?.logs?.() ?? [];
    super(`Transaction failed:\n${logs.join("\n")}`);
    this.name = "TxError";
    this.meta = meta;
  }
  logs(): string[] {
    return this.meta.meta()?.logs?.() ?? [];
  }
}

// Touch dirname import so lints don't flag it if a future helper needs the dir.
void dirname;
