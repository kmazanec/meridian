/**
 * The end-to-end demo lifecycle: create → mint → trade → settle → redeem, with the on-chain
 * invariants (ARCHITECTURE §7) asserted after each phase and a human-readable transcript.
 *
 * This is the reproducible proof that the deployed system works, on whatever cluster
 * `RPC_URL` points at. It mirrors the convergence multi-user scenario exactly — a maker mints
 * and quotes, a taker crosses, the market settles (admin override, deterministic and callable
 * immediately on a past-dated market), both redeem to the correct USDC, and the vault drains
 * to zero — but is driven as a *script* (not a test) and reuses the proven `Fixture`
 * helpers + the SDK builders, never re-implementing matching or the four-button mapping.
 *
 * Funding is environment-agnostic: demo users are funded by **transfer from the deployer**
 * (SOL) and a **USDC mint** from the deployer, not by per-user airdrop. Airdrop works on a
 * local validator but is rate-limited/unreliable on devnet; a deployer transfer works on
 * both, so the same script runs unchanged against devnet (where the operator has pre-funded
 * the deployer).
 *
 * Settlement uses `admin_settle` (the program's time-delayed admin override): deterministic,
 * needs no live oracle, and is the documented demo path. The genuine Pyth pull-oracle
 * `settle_market` path is exercised separately (the opt-in devnet smoke in the convergence
 * suite) and documented in the devnet runbook.
 */

import BN from "bn.js";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import {
  getOrCreateAssociatedTokenAccount,
  getMint,
  mintTo,
  createTransferInstruction,
} from "@solana/spl-token";
import {
  OrderSide,
  RedeemSide,
  Ticker,
  PAYOFF_UNIT,
  placeOrder,
  cancelOrder,
  createAtaIfNeeded,
  redeem,
  fetchOrderBook,
  marketPda,
  deriveMarketPdasFromIdentity,
  getProgram,
  type MarketId,
} from "@meridian/sdk";
import {
  Fixture,
  sendTx,
  makerAccountsFor,
  ADMIN_OVERRIDE_DELAY_SECONDS,
  type TestUser,
} from "@meridian/e2e";
import type { ConsoleLog } from "./log";

const ONE = new BN(PAYOFF_UNIT);

export interface LifecycleOptions {
  rpcUrl: string;
  deployer: Keypair;
  usdcMint: PublicKey;
  /** Ticker for the demo market (default META). */
  ticker?: Ticker;
  /** Strike in USDC base units (default $680.00). */
  strike?: BN | number;
  log?: ConsoleLog;
}

export interface LifecycleResult {
  market: PublicKey;
  outcome: string;
  /** Maker net P&L in USDC base units (signed). */
  makerPnl: bigint;
  /** Taker net P&L in USDC base units (signed). */
  takerPnl: bigint;
  /** Vault balance after all redemptions (should be 0). */
  vaultRemaining: bigint;
}

/**
 * Run the full lifecycle once and return the outcome + P&L. Throws if any invariant fails
 * (the invariant assertions are the point — a green run is a real proof).
 */
export async function runLifecycle(
  opts: LifecycleOptions
): Promise<LifecycleResult> {
  const log = opts.log;
  const connection = new Connection(opts.rpcUrl, "confirmed");
  const fx = Fixture.attach(connection, opts.deployer, opts.usdcMint);
  const ticker = opts.ticker ?? Ticker.Meta;
  const strike = new BN(opts.strike ?? 680_000_000);

  // ── create ────────────────────────────────────────────────────────────────
  log?.section("Lifecycle: create");
  // Past-dated so admin_settle is callable immediately (the program gates trading on
  // state==Open, not the clock, so the market is still fully tradable). We pick an
  // explicitly UNIQUE tradingDay rather than the fixture default (which is derived from the
  // current second): the bin promises a *fresh* demo market on every run, and two invocations
  // in the same second would otherwise derive the same market PDA and fail with
  // MarketAlreadyExists. A small random offset further into the past keeps each run distinct
  // while staying comfortably past the admin-override delay so settlement is callable.
  const tradingDay =
    Math.floor(Date.now() / 1000) -
    ADMIN_OVERRIDE_DELAY_SECONDS -
    60 -
    Math.floor(Math.random() * 86_400);
  const market = await fx.createMarket({ ticker, strike, tradingDay });
  const addr = marketPda(market.ticker, market.strike, market.tradingDay);
  log?.step(`Created market ${addr.toBase58()}`);
  log?.detail("ticker/strike", `${Ticker[ticker]} @ $${dollars(strike)}`);
  await fx.assertCollateralization(market);

  // Two demo users funded from the deployer (SOL transfer + USDC mint).
  log?.section("Lifecycle: fund users");
  const maker = await fundUser(
    connection,
    opts.deployer,
    opts.usdcMint,
    100,
    log,
    "maker"
  );
  const taker = await fundUser(
    connection,
    opts.deployer,
    opts.usdcMint,
    100,
    log,
    "taker"
  );
  const makerStartUsdc = (await fx.position(maker.publicKey, market)).usdc;
  const takerStartUsdc = (await fx.position(taker.publicKey, market)).usdc;

  // ── mint + quote (maker) ────────────────────────────────────────────────────
  log?.section("Lifecycle: mint + quote (maker)");
  await fx.mintPairs(maker, market, 6);
  log?.step("Maker minted 6 pairs (6 Yes + 6 No, vault $6.00)");
  await fx.assertCollateralization(market);

  await sendTx(
    connection,
    maker.keypair,
    [
      await placeOrder(fx.program, {
        user: maker.publicKey,
        market,
        side: OrderSide.Ask,
        price: new BN(650_000),
        size: ONE.muln(4),
        usdcMint: fx.usdcMint,
      }),
    ],
    [maker.keypair]
  );
  await sendTx(
    connection,
    maker.keypair,
    [
      await placeOrder(fx.program, {
        user: maker.publicKey,
        market,
        side: OrderSide.Bid,
        price: new BN(550_000),
        size: ONE.muln(2),
        usdcMint: fx.usdcMint,
      }),
    ],
    [maker.keypair]
  );
  log?.step("Maker posted: ASK 4 Yes @ $0.65, BID 2 Yes @ $0.55");

  // ── trade (taker crosses the ask) ───────────────────────────────────────────
  log?.section("Lifecycle: trade (taker fills)");
  let book = await fetchOrderBook(fx.program, addr);
  const makerAccounts = makerAccountsFor({
    book: book!,
    side: OrderSide.Bid,
    price: new BN(650_000),
    size: ONE.muln(4),
    isMarket: false,
    usdcMint: fx.usdcMint,
    yesMint: yesMintOf(market),
  });
  await sendTx(
    connection,
    taker.keypair,
    [
      createAtaIfNeeded(taker.publicKey, taker.publicKey, yesMintOf(market)),
      await placeOrder(fx.program, {
        user: taker.publicKey,
        market,
        side: OrderSide.Bid,
        price: new BN(650_000),
        size: ONE.muln(4),
        usdcMint: fx.usdcMint,
        makerAccounts,
      }),
    ],
    [taker.keypair]
  );
  log?.step("Taker bought 4 Yes @ $0.65 (paid $2.60)");
  await fx.assertCollateralization(market); // trading never touches the vault

  // Cancel the maker's still-resting bid so its escrow returns before settlement.
  book = await fetchOrderBook(fx.program, addr);
  const restingBid = book!.bids.find((o) => o.active && !o.size.isZero());
  if (restingBid) {
    await sendTx(
      connection,
      maker.keypair,
      [
        await cancelOrder(fx.program, {
          user: maker.publicKey,
          market,
          side: OrderSide.Bid,
          seq: restingBid.seq,
          usdcMint: fx.usdcMint,
        }),
      ],
      [maker.keypair]
    );
    log?.step("Maker cancelled its resting bid (escrow returned)");
  }

  // ── settle (Yes wins: settlement price ≥ strike) ────────────────────────────
  log?.section("Lifecycle: settle");
  await fx.settleAdmin(market, strike.add(new BN(1)));
  const settled = await fx.market(market);
  log?.step(`Settled via admin override — outcome: ${settled.outcome}`);
  log?.detail("settlementPrice", `$${dollars(strike.add(new BN(1)))}`);

  // ── redeem (both parties) ───────────────────────────────────────────────────
  log?.section("Lifecycle: redeem");
  await redeemSide(fx, taker, market, RedeemSide.Yes, ONE.muln(4));
  log?.step("Taker redeemed 4 winning Yes → $4.00");
  await fx.assertCollateralization(market);
  await redeemSide(fx, maker, market, RedeemSide.Yes, ONE.muln(2));
  await redeemSide(fx, maker, market, RedeemSide.No, ONE.muln(6)); // losing No → $0
  log?.step("Maker redeemed 2 winning Yes → $2.00, cleared 6 losing No → $0");

  const vaultRemaining = await fx.vaultBalance(market);
  await fx.assertCollateralization(market);

  // ── P&L (zero-sum check) ────────────────────────────────────────────────────
  const makerEndUsdc = (await fx.position(maker.publicKey, market)).usdc;
  const takerEndUsdc = (await fx.position(taker.publicKey, market)).usdc;
  const makerPnl = makerEndUsdc - makerStartUsdc;
  const takerPnl = takerEndUsdc - takerStartUsdc;

  // Hard-assert the end-state invariants — a green run must MEAN the invariants held, so these
  // throw (not just log). Payout completeness (§7.2): value is conserved between the two
  // parties (zero-sum), and every winning token was paid from the vault and only the vault
  // (the vault drains to exactly 0 once all winners redeem). `assertCollateralization` above
  // already enforces the vault==accounting identity at each phase; these make the lifecycle's
  // own success criteria explicit failures rather than transcript notes.
  if (makerPnl + takerPnl !== 0n) {
    throw new Error(
      `zero-sum invariant violated: maker ${makerPnl} + taker ${takerPnl} != 0`
    );
  }
  if (vaultRemaining !== 0n) {
    throw new Error(
      `vault did not drain to zero after all winners redeemed: ${vaultRemaining} base units remain`
    );
  }

  log?.section("Lifecycle: result");
  log?.detail("outcome", settled.outcome);
  log?.detail("maker P&L", signedDollars(makerPnl));
  log?.detail("taker P&L", signedDollars(takerPnl));
  log?.detail("zero-sum", "yes (✓ asserted)");
  log?.detail(
    "vault remaining",
    `${signedDollars(vaultRemaining)} (drained ✓)`
  );
  log?.ok("Lifecycle complete — invariants held at every phase");

  return {
    market: addr,
    outcome: settled.outcome,
    makerPnl,
    takerPnl,
    vaultRemaining,
  };
}

// --- helpers ---

/**
 * Create a demo user funded entirely by the deployer: transfer `sol` SOL (works on local AND
 * devnet, unlike a per-user airdrop) and mint `usdcDollars` USDC to a fresh ATA. Returns a
 * {@link TestUser} usable with the `Fixture` helpers.
 */
async function fundUser(
  connection: Connection,
  deployer: Keypair,
  usdcMint: PublicKey,
  usdcDollars: number,
  log: ConsoleLog | undefined,
  label: string,
  sol = 1
): Promise<TestUser> {
  const keypair = Keypair.generate();

  // SOL via a deployer→user transfer (the user pays its own tx fees thereafter).
  await sendAndConfirmTransaction(
    connection,
    new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: deployer.publicKey,
        toPubkey: keypair.publicKey,
        lamports: sol * LAMPORTS_PER_SOL,
      })
    ),
    [deployer],
    { commitment: "confirmed" }
  );

  const usdcAcc = await getOrCreateAssociatedTokenAccount(
    connection,
    deployer,
    usdcMint,
    keypair.publicKey
  );
  if (usdcDollars > 0) {
    const amount = BigInt(usdcDollars) * BigInt(PAYOFF_UNIT.toString());
    // Fund USDC the right way for the mint we're actually using. On a mock mint (local, or a
    // bootstrap-created devnet mint) the deployer is the mint authority, so mint fresh. On a
    // pre-existing mint the deployer does NOT control (e.g. a real devnet USDC), minting would
    // fail — so transfer from the deployer's own USDC balance instead. This keeps
    // `lifecycle` working against both kinds of collateral mint.
    const deployerIsMintAuthority = await isMintAuthority(
      connection,
      usdcMint,
      deployer.publicKey
    );
    if (deployerIsMintAuthority) {
      await mintTo(
        connection,
        deployer,
        usdcMint,
        usdcAcc.address,
        deployer,
        amount
      );
    } else {
      const deployerUsdc = await getOrCreateAssociatedTokenAccount(
        connection,
        deployer,
        usdcMint,
        deployer.publicKey
      );
      if (BigInt(deployerUsdc.amount) < amount) {
        throw new Error(
          `Deployer is not the authority for USDC mint ${usdcMint.toBase58()} and holds ` +
            `${deployerUsdc.amount} base units (< ${amount} needed to fund ${label}). ` +
            `Pre-fund the deployer's USDC ATA, or run against a bootstrap-created mock mint.`
        );
      }
      await sendAndConfirmTransaction(
        connection,
        new Transaction().add(
          createTransferInstruction(
            deployerUsdc.address,
            usdcAcc.address,
            deployer.publicKey,
            amount
          )
        ),
        [deployer],
        { commitment: "confirmed" }
      );
    }
  }
  log?.step(
    `Funded ${label} ${keypair.publicKey.toBase58()} (${sol} SOL, ${usdcDollars} USDC)`
  );
  return { keypair, publicKey: keypair.publicKey, usdc: usdcAcc.address };
}

async function redeemSide(
  fx: Fixture,
  user: TestUser,
  market: MarketId,
  side: RedeemSide,
  amount: BN
): Promise<void> {
  await sendTx(
    fx.connection,
    user.keypair,
    [
      await redeem(fx.program, {
        user: user.publicKey,
        market,
        side,
        amount,
        usdcMint: fx.usdcMint,
      }),
    ],
    [user.keypair]
  );
}

function yesMintOf(market: MarketId): PublicKey {
  return deriveMarketPdasFromIdentity(
    market.ticker,
    market.strike,
    market.tradingDay
  ).yesMint;
}

/** True iff `who` is the current mint authority of `mint` (so it can `mintTo`). */
async function isMintAuthority(
  connection: Connection,
  mint: PublicKey,
  who: PublicKey
): Promise<boolean> {
  const info = await getMint(connection, mint);
  return info.mintAuthority?.equals(who) ?? false;
}

/** USDC base units (6 dp) → dollar string. */
function dollars(baseUnits: BN): string {
  const unit = new BN(1_000_000);
  const whole = baseUnits.div(unit).toString();
  const cents = baseUnits.mod(unit).toString().padStart(6, "0").slice(0, 2);
  return `${whole}.${cents}`;
}

/** Signed bigint USDC base units → "+$1.40" / "−$1.40". */
function signedDollars(v: bigint): string {
  const neg = v < 0n;
  const abs = neg ? -v : v;
  const unit = 1_000_000n;
  const whole = abs / unit;
  const cents = (abs % unit).toString().padStart(6, "0").slice(0, 2);
  return `${neg ? "−" : "+"}$${whole}.${cents}`;
}

export { signedDollars, dollars };
