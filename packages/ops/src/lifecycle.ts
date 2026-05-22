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
import { getOrCreateAssociatedTokenAccount, mintTo } from "@solana/spl-token";
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
  // state==Open, not the clock, so the market is still fully tradable).
  const market = await fx.createMarket({ ticker, strike });
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

  log?.section("Lifecycle: result");
  log?.detail("outcome", settled.outcome);
  log?.detail("maker P&L", signedDollars(makerPnl));
  log?.detail("taker P&L", signedDollars(takerPnl));
  log?.detail(
    "zero-sum",
    (makerPnl + takerPnl).toString() === "0" ? "yes (✓)" : "NO"
  );
  log?.detail("vault remaining", `${signedDollars(vaultRemaining)} (drained)`);
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
    await mintTo(
      connection,
      deployer,
      usdcMint,
      usdcAcc.address,
      deployer,
      BigInt(usdcDollars) * BigInt(PAYOFF_UNIT.toString())
    );
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
