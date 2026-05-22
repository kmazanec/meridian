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
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
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
    await this.connection.confirmTransaction(sig, "confirmed");

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

  /** Raw vault USDC balance (base units) for a market. */
  async vaultBalance(market: MarketId): Promise<bigint> {
    const { vault } = deriveMarketPdasFromIdentity(
      market.ticker,
      market.strike,
      market.tradingDay
    );
    return this.tokenBalance(vault);
  }

  /** Token balance (base units) for any token account; 0 if it doesn't exist. */
  async tokenBalance(account: PublicKey): Promise<bigint> {
    const info = await this.connection
      .getTokenAccountBalance(account)
      .catch(() => null);
    return info ? BigInt(info.value.amount) : 0n;
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

/** Build, sign, and confirm one transaction. */
export async function sendTx(
  connection: Connection,
  payer: Keypair,
  instructions: TransactionInstruction[],
  signers: Keypair[] = [payer]
): Promise<string> {
  const tx = new Transaction().add(...instructions);
  return sendAndConfirmTransaction(connection, tx, signers, {
    commitment: "confirmed",
  });
}

export { PROGRAM_ID, getAssociatedTokenAddressSync };
