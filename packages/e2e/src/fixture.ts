/**
 * Domain fixture for the convergence suite, layered on a booted {@link LocalValidator}.
 *
 * Wraps `@meridian/sdk` to bootstrap the on-chain world (config + USDC mint), provision
 * markets, fund users, mint pairs, settle, and — most importantly — assert the on-chain
 * invariants (ARCHITECTURE.md §7) via the SDK reads against the *live* validator after
 * each lifecycle phase. The four-button trade translation, PDA derivation, and account
 * decoding all come from the SDK; the fixture never re-implements them.
 *
 * Settlement note: markets meant to be settled are created with a `trading_day` already
 * in the past (the program gates mint/trade on `state == Open`, not the clock, so a
 * past-dated market is still fully tradable). That lets `admin_settle` — whose only
 * timing gate is `now >= trading_day + ADMIN_OVERRIDE_DELAY` — fire immediately on a real
 * validator we cannot fast-forward. The genuine Pyth `settle_market` pull path runs in
 * the opt-in devnet smoke test, where the Receiver program is actually deployed.
 */

import { expect } from "chai";
import BN from "bn.js";
import {
  Connection,
  Keypair,
  PublicKey,
  TransactionInstruction,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import {
  createMint,
  getOrCreateAssociatedTokenAccount,
  getAssociatedTokenAddressSync,
  mintTo,
} from "@solana/spl-token";
import {
  getProgram,
  initializeConfig,
  createStrikeMarket,
  initOrderBook,
  growOrderBook,
  mintPair,
  adminSettle,
  buildTradeIntent,
  fetchMarket,
  fetchOrderBook,
  deriveMarketPdasFromIdentity,
  marketPda,
  ata,
  Ticker,
  TradeAction,
  NUM_TICKERS,
  PAYOFF_UNIT,
  PROGRAM_ID,
  sendAndConfirm,
  confirmSignature,
  type MeridianProgram,
  type MarketAccount,
  type MarketId,
} from "@meridian/sdk";
import { makerAccountsFor, yesSideFor, yesPriceFor } from "./crossing";
import type { LocalValidator } from "./localValidator";

/** The admin-override delay the program enforces (ARCHITECTURE §7.5); mirror of constants.rs. */
export const ADMIN_OVERRIDE_DELAY_SECONDS = 60 * 60;

/** A funded test user with a keypair and its derived USDC ATA. */
export interface TestUser {
  readonly keypair: Keypair;
  readonly publicKey: PublicKey;
  readonly usdc: PublicKey;
}

/** Options for provisioning a market via the fixture. */
export interface CreateMarketOptions {
  ticker: Ticker;
  /** Strike in USDC base units (6 dp). */
  strike: BN | number;
  /**
   * Close instant (unix seconds). Omit for a market closed long enough ago that
   * `admin_settle` is already callable (now − ADMIN_OVERRIDE_DELAY − 60s).
   */
  tradingDay?: number;
}

/**
 * The bootstrapped fixture: a program client bound to the validator, the admin/deployer,
 * the USDC mint, and helpers to drive and assert the lifecycle.
 */
export class Fixture {
  readonly connection: Connection;
  readonly admin: Keypair;
  readonly program: MeridianProgram;
  readonly usdcMint: PublicKey;

  private constructor(
    connection: Connection,
    admin: Keypair,
    program: MeridianProgram,
    usdcMint: PublicKey
  ) {
    this.connection = connection;
    this.admin = admin;
    this.program = program;
    this.usdcMint = usdcMint;
  }

  /**
   * Initialize Config (admin = deployer, MAG7 test feed ids) and create a fresh USDC
   * mint with the deployer as mint authority. Idempotent per validator boot.
   */
  static async bootstrap(validator: LocalValidator): Promise<Fixture> {
    const { connection, deployer, programData } = validator;
    const program = getProgram({
      connection,
      publicKey: deployer.publicKey,
    } as never);

    const usdcMint = await createMint(
      connection,
      deployer,
      deployer.publicKey,
      null,
      6
    );

    // Test feed ids mirror the web/automation harnesses: ticker i → [i+1; 32].
    const tickers = Array.from({ length: NUM_TICKERS }, (_, i) => ({
      ticker: i as Ticker,
      feedId: new Array(32).fill(i + 1),
    }));
    await sendTx(
      connection,
      deployer,
      [
        await initializeConfig(program, {
          admin: deployer.publicKey,
          programData,
          usdcMint,
          tickers,
        }),
      ],
      [deployer]
    );

    return new Fixture(connection, deployer, program, usdcMint);
  }

  /**
   * Attach to an **already-bootstrapped** world: a deployed program with an initialized
   * Config and a known USDC mint. Unlike {@link bootstrap}, this neither creates a mint nor
   * calls `initialize_config` — it just binds the lifecycle/invariant helpers to existing
   * on-chain state. Used by the ops scripts, which deploy + bootstrap as separate idempotent
   * steps (and may run against devnet, where the Config/USDC already exist) and then drive
   * the lifecycle with this fixture.
   */
  static attach(
    connection: Connection,
    admin: Keypair,
    usdcMint: PublicKey
  ): Fixture {
    const program = getProgram({
      connection,
      publicKey: admin.publicKey,
    } as never);
    return new Fixture(connection, admin, program, usdcMint);
  }

  /** Build the SDK `MarketId` for a market created via this fixture. */
  marketId(opts: CreateMarketOptions): MarketId {
    return {
      ticker: opts.ticker,
      strike: new BN(opts.strike),
      tradingDay: new BN(this.resolveTradingDay(opts.tradingDay)),
    };
  }

  private resolveTradingDay(tradingDay?: number): number {
    if (tradingDay !== undefined) return tradingDay;
    // Closed long enough ago that admin_settle is already callable.
    return Math.floor(Date.now() / 1000) - ADMIN_OVERRIDE_DELAY_SECONDS - 60;
  }

  /**
   * Provision a market end-to-end: create_strike_market → init_order_book →
   * grow_order_book (the two-step book creation the order-book realloc cap requires).
   * Returns the market identity for use with SDK builders.
   */
  async createMarket(opts: CreateMarketOptions): Promise<MarketId> {
    const id = this.marketId(opts);
    await sendTx(
      this.connection,
      this.admin,
      [
        await createStrikeMarket(this.program, {
          admin: this.admin.publicKey,
          usdcMint: this.usdcMint,
          market: id,
        }),
      ],
      [this.admin]
    );
    await sendTx(
      this.connection,
      this.admin,
      [
        await initOrderBook(this.program, {
          payer: this.admin.publicKey,
          usdcMint: this.usdcMint,
          market: id,
        }),
      ],
      [this.admin]
    );
    await sendTx(
      this.connection,
      this.admin,
      [
        await growOrderBook(this.program, {
          payer: this.admin.publicKey,
          market: id,
        }),
      ],
      [this.admin]
    );

    // Confirm the collateral vault was actually created. Without this, a wrong vault PDA
    // would later read as a non-existent (0-balance) account and make assertCollateralization
    // pass vacuously on a fresh market (0 == PAYOFF_UNIT*0 - 0). Proving the account exists
    // here makes the collateralization checks meaningful from the first assertion.
    const { vault } = deriveMarketPdasFromIdentity(
      id.ticker,
      id.strike,
      id.tradingDay
    );
    const vaultInfo = await this.connection.getAccountInfo(vault);
    if (!vaultInfo) {
      throw new Error(
        `vault account not created for market ${vault.toBase58()}`
      );
    }
    return id;
  }

  /** Create a funded user: airdrop SOL, create its USDC ATA, mint it `usdcDollars` USDC. */
  async newUser(usdcDollars: number, sol = 5): Promise<TestUser> {
    const keypair = Keypair.generate();
    const sig = await this.connection.requestAirdrop(
      keypair.publicKey,
      sol * LAMPORTS_PER_SOL
    );
    // Confirm by HTTP polling (not WS). Airdrop returns only a signature, so set the
    // expiry deadline from the current block height + a generous buffer (~150 slots, the
    // usual blockhash validity window).
    const deadline = (await this.connection.getBlockHeight("confirmed")) + 150;
    await confirmSignature(this.connection, sig, deadline);

    const usdcAcc = await getOrCreateAssociatedTokenAccount(
      this.connection,
      this.admin,
      this.usdcMint,
      keypair.publicKey
    );
    if (usdcDollars > 0) {
      await mintTo(
        this.connection,
        this.admin,
        this.usdcMint,
        usdcAcc.address,
        this.admin,
        BigInt(usdcDollars) * BigInt(PAYOFF_UNIT.toString())
      );
    }
    return { keypair, publicKey: keypair.publicKey, usdc: usdcAcc.address };
  }

  /** Mint `count` Yes/No pairs for `user` on `market` (user signs; deposits $1 each). */
  async mintPairs(
    user: TestUser,
    market: MarketId,
    count: number
  ): Promise<void> {
    for (let i = 0; i < count; i++) {
      await sendTx(
        this.connection,
        user.keypair,
        [
          await mintPair(this.program, {
            user: user.publicKey,
            usdcMint: this.usdcMint,
            market,
          }),
        ],
        [user.keypair]
      );
    }
  }

  /**
   * Drive a four-button trade as one transaction, the way the frontend does: read the
   * live book, compute the maker payout accounts for the crossing, then build the intent
   * via the SDK (`buildTradeIntent` — the single source of the four-button mapping) and
   * send all of its instructions together. `price` is in the action's own perspective
   * (Yes price for Yes actions, No price for No actions). Returns the SDK's `BuiltIntent`.
   *
   * **Single-writer only.** The maker accounts are computed from a book snapshot taken
   * just before the send. If another actor consumes or inserts crossing liquidity in that
   * gap, `remaining_accounts` no longer match the on-chain fill plan and `place_order` can
   * fail or rest a different remainder. The convergence suite runs sequentially with one
   * writer per market, so this never happens here; do not reuse this helper for
   * parallel/load scenarios without re-reading the book and retrying on a maker-account
   * mismatch (the production frontend handles that re-read/retry path).
   */
  async trade(
    user: TestUser,
    market: MarketId,
    opts: {
      action: TradeAction;
      price: BN | number;
      size: BN | number;
      isMarket?: boolean;
    }
  ): Promise<{ mintPairs: number; bookSide: number; yesPrice: BN }> {
    const price = new BN(opts.price);
    const size = new BN(opts.size);
    const isMarket = opts.isMarket ?? false;

    // Compute the crossing from the live book, in the Yes-book frame the action maps to.
    const book = await fetchOrderBook(
      this.program,
      marketPda(market.ticker, market.strike, market.tradingDay)
    );
    const makerAccounts = book
      ? makerAccountsFor({
          book,
          side: yesSideFor(opts.action),
          price: yesPriceFor(opts.action, price),
          size,
          isMarket,
          usdcMint: this.usdcMint,
          yesMint: deriveMarketPdasFromIdentity(
            market.ticker,
            market.strike,
            market.tradingDay
          ).yesMint,
        })
      : [];

    const built = await buildTradeIntent(this.program, user.publicKey, {
      market,
      action: opts.action,
      price,
      size,
      isMarket,
      usdcMint: this.usdcMint,
      makerAccounts,
    });
    await sendTx(this.connection, user.keypair, built.instructions, [
      user.keypair,
    ]);
    return {
      mintPairs: built.mintPairs,
      bookSide: built.bookSide,
      yesPrice: built.yesPrice,
    };
  }

  /**
   * Settle a (past-dated) market via the admin override. `settlementPrice` is in USDC
   * base units; outcome is YesWins iff `settlementPrice >= strike` (the program's rule).
   */
  async settleAdmin(
    market: MarketId,
    settlementPrice: BN | number
  ): Promise<void> {
    await sendTx(
      this.connection,
      this.admin,
      [
        await adminSettle(this.program, {
          admin: this.admin.publicKey,
          market,
          settlementPrice: new BN(settlementPrice),
        }),
      ],
      [this.admin]
    );
  }

  // --- reads + invariant assertions ---

  /** Fetch the decoded Market by identity. */
  async market(market: MarketId): Promise<MarketAccount> {
    const addr = marketPda(market.ticker, market.strike, market.tradingDay);
    const acc = await fetchMarket(this.program, addr);
    if (!acc) throw new Error(`market not found: ${addr.toBase58()}`);
    return acc;
  }

  /**
   * Strict vault USDC balance (base units). Unlike {@link tokenBalance}, this does NOT
   * treat a missing/closed/mis-owned vault as a 0 balance — it verifies the vault is a
   * live token account for the fixture's USDC mint and throws otherwise. That keeps
   * {@link assertCollateralization} honest: a redeem/vault regression that closes or
   * mis-owns the vault must fail the assertion, not pass vacuously when the expected
   * balance is also 0.
   */
  async vaultBalance(market: MarketId): Promise<bigint> {
    const { vault } = deriveMarketPdasFromIdentity(
      market.ticker,
      market.strike,
      market.tradingDay
    );
    const parsed = await this.connection.getParsedAccountInfo(vault);
    const value = parsed.value;
    if (!value) {
      throw new Error(`vault account missing: ${vault.toBase58()}`);
    }
    const data = value.data;
    if (!("parsed" in data) || data.program !== "spl-token") {
      throw new Error(`vault is not an SPL token account: ${vault.toBase58()}`);
    }
    const info = data.parsed?.info as
      | { mint?: string; tokenAmount?: { amount?: string } }
      | undefined;
    if (info?.mint !== this.usdcMint.toBase58()) {
      throw new Error(
        `vault mint mismatch: expected ${this.usdcMint.toBase58()}, got ${
          info?.mint
        }`
      );
    }
    return BigInt(info?.tokenAmount?.amount ?? "0");
  }

  /**
   * Token balance (base units) for any token account; 0 if the account does not exist.
   * Used for user ATAs, which legitimately may not exist yet — so a not-found is a real
   * zero. Other RPC errors are NOT swallowed (they rethrow), so a transport/parse failure
   * can't masquerade as a zero balance. For the collateral vault use {@link vaultBalance},
   * which is strict.
   */
  async tokenBalance(account: PublicKey): Promise<bigint> {
    try {
      const info = await this.connection.getTokenAccountBalance(account);
      return BigInt(info.value.amount);
    } catch (e) {
      if (isAccountNotFound(e)) return 0n;
      throw e;
    }
  }

  /** A user's Yes/No/USDC balances for a market. */
  async position(
    user: PublicKey,
    market: MarketId
  ): Promise<{ yes: bigint; no: bigint; usdc: bigint }> {
    const { yesMint, noMint } = deriveMarketPdasFromIdentity(
      market.ticker,
      market.strike,
      market.tradingDay
    );
    return {
      yes: await this.tokenBalance(ata(yesMint, user)),
      no: await this.tokenBalance(ata(noMint, user)),
      usdc: await this.tokenBalance(ata(this.usdcMint, user)),
    };
  }

  /**
   * Collateralization invariant (ARCHITECTURE §7.1): the vault holds exactly
   * `PAYOFF_UNIT × pairs_minted − winning_redeemed` USDC base units. Asserted against the
   * live validator.
   */
  async assertCollateralization(market: MarketId): Promise<void> {
    const acc = await this.market(market);
    const expected =
      BigInt(PAYOFF_UNIT.toString()) * BigInt(acc.pairsMinted.toString()) -
      BigInt(acc.winningRedeemed.toString());
    const actual = await this.vaultBalance(market);
    expect(
      actual.toString(),
      "vault == PAYOFF_UNIT*pairs_minted - winning_redeemed"
    ).to.equal(expected.toString());
  }
}

/**
 * True when an RPC error means "this token account does not exist" — the only case where a
 * 0 balance is the right answer. `getTokenAccountBalance` surfaces a not-found as a JSON-RPC
 * "could not find account" / "Invalid param" error; anything else (transport, parse, node
 * error) must propagate rather than be read as zero.
 */
function isAccountNotFound(e: unknown): boolean {
  const msg = (e instanceof Error ? e.message : String(e)).toLowerCase();
  return (
    msg.includes("could not find account") ||
    msg.includes("account not found") ||
    msg.includes("invalid param") // RPC's response when the account doesn't exist
  );
}

/**
 * Build, sign, and confirm one transaction — confirming by HTTP polling via the SDK's
 * shared `sendAndConfirm` (not WebSocket `signatureSubscribe`, which many RPC endpoints
 * don't expose and which floods devnet runs with `-32601` errors).
 *
 * `signers` defaults to `[payer]`. The SDK helper always signs with `payer` as fee payer,
 * so any extra co-signers are forwarded and `payer` is de-duplicated out of the list.
 */
export async function sendTx(
  connection: Connection,
  payer: Keypair,
  instructions: TransactionInstruction[],
  signers: Keypair[] = [payer]
): Promise<string> {
  const extraSigners = signers.filter(
    (s) => !s.publicKey.equals(payer.publicKey)
  );
  return sendAndConfirm(connection, payer, instructions, {
    signers: extraSigners,
  });
}

export { PROGRAM_ID, getAssociatedTokenAddressSync };
