/**
 * Typed instruction builders — one per program instruction.
 *
 * Each builder takes *domain* arguments (a market identity, an amount, a side) plus
 * the few external keys a caller genuinely owns (the signer, their token accounts),
 * derives every PDA from the frozen seed contract, and returns a web3.js
 * `TransactionInstruction` produced by the Anchor client (IDL-encoded, never
 * hand-rolled). Callers compose/sign/send; building never touches the network.
 *
 * Account wiring mirrors the program's `#[derive(Accounts)]` structs exactly; the
 * LiteSVM tests prove each builder yields a transaction the real program accepts.
 */

import BN from "bn.js";
import { PublicKey, TransactionInstruction } from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
} from "@solana/spl-token";
import { SystemProgram, SYSVAR_RENT_PUBKEY } from "@solana/web3.js";
import type { MeridianProgram } from "./program";
import { PRICE_SCALE } from "./constants";
import {
  ata,
  configPda,
  deriveMarketPdas,
  marketPda,
  type BNLike,
  type MarketPdas,
} from "./pdas";
import {
  OrderSide,
  RedeemSide,
  Ticker,
  orderSideToArg,
  redeemSideToArg,
  tickerToArg,
} from "./types";

/** Identity of a market: the three values that derive its PDA. */
export interface MarketId {
  ticker: Ticker;
  strike: BNLike;
  tradingDay: BNLike;
}

function toBN(value: BNLike): BN {
  return BN.isBN(value) ? value : new BN(value);
}

/**
 * Validate an order's price/size against the program's own preconditions so the SDK
 * fails fast (and clearly) rather than spending a round-trip to learn the program
 * rejected it. Mirrors `place_order.rs`: size > 0 always; for a limit order the price
 * must be in `[1, PRICE_SCALE]`.
 */
function assertOrderArgs(price: BN, size: BN, isMarket: boolean): void {
  if (size.lten(0)) {
    throw new Error("Order size must be greater than zero");
  }
  if (!isMarket) {
    if (price.lten(0) || price.gt(PRICE_SCALE)) {
      throw new Error(
        `Limit price ${price.toString()} out of range [1, ${PRICE_SCALE.toString()}]`
      );
    }
  }
}

function pdasFor(id: MarketId): MarketPdas {
  return deriveMarketPdas(marketPda(id.ticker, id.strike, id.tradingDay));
}

/**
 * An idempotent "create the owner's associated token account for `mint`" instruction.
 *
 * Several program instructions require a token account to *already exist* (e.g.
 * `place_order`'s `user_yes`/`user_usdc`, `redeem`'s payout account). Unlike
 * `mint_pair`, they do not create it for you. Prepend this (idempotent: a no-op if the
 * ATA already exists) so a buy/sell/redeem doesn't fail with `AccountNotInitialized`.
 * The four-button intent builder prepends these automatically.
 */
export function createAtaIfNeeded(
  payer: PublicKey,
  owner: PublicKey,
  mint: PublicKey
): TransactionInstruction {
  return createAssociatedTokenAccountIdempotentInstruction(
    payer,
    ata(mint, owner),
    owner,
    mint,
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID
  );
}

// ---------------------------------------------------------------------------
// Config / admin
// ---------------------------------------------------------------------------

/** A per-ticker oracle feed config entry (32-byte Pyth feed id). */
export interface TickerConfigInput {
  ticker: Ticker;
  /** 32-byte feed id (Buffer/Uint8Array or number[]). */
  feedId: Uint8Array | number[];
}

export interface InitializeConfigParams {
  admin: PublicKey;
  /** This program's ProgramData account (holds the upgrade authority). */
  programData: PublicKey;
  usdcMint: PublicKey;
  /** Exactly NUM_TICKERS entries (the program enforces the full set). */
  tickers: TickerConfigInput[];
  feeAccount?: PublicKey | null;
}

export function initializeConfig(
  program: MeridianProgram,
  p: InitializeConfigParams
): Promise<TransactionInstruction> {
  const tickers = p.tickers.map((t) => ({
    ticker: tickerToArg(t.ticker),
    feedId: Array.from(t.feedId),
  }));
  return program.methods
    .initializeConfig({ tickers, feeAccount: p.feeAccount ?? null })
    .accountsStrict({
      admin: p.admin,
      usdcMint: p.usdcMint,
      config: configPda(),
      program: program.programId,
      programData: p.programData,
      systemProgram: SystemProgram.programId,
    })
    .instruction();
}

export interface CreateStrikeMarketParams {
  admin: PublicKey;
  usdcMint: PublicKey;
  market: MarketId;
}

/** Build `create_strike_market` (provisions Market + Yes/No mints + vault). */
export function createStrikeMarket(
  program: MeridianProgram,
  p: CreateStrikeMarketParams
): Promise<TransactionInstruction> {
  const k = pdasFor(p.market);
  return program.methods
    .createStrikeMarket({
      ticker: tickerToArg(p.market.ticker),
      strike: toBN(p.market.strike),
      tradingDay: toBN(p.market.tradingDay),
    })
    .accountsStrict({
      admin: p.admin,
      config: configPda(),
      usdcMint: p.usdcMint,
      market: k.market,
      mintAuthority: k.mintAuthority,
      yesMint: k.yesMint,
      noMint: k.noMint,
      vault: k.vault,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
      rent: SYSVAR_RENT_PUBKEY,
    })
    .instruction();
}

/** Build `add_strike` (intraday extra strike; same provisioning as create). */
export function addStrike(
  program: MeridianProgram,
  p: CreateStrikeMarketParams
): Promise<TransactionInstruction> {
  const k = pdasFor(p.market);
  return program.methods
    .addStrike({
      ticker: tickerToArg(p.market.ticker),
      strike: toBN(p.market.strike),
      tradingDay: toBN(p.market.tradingDay),
    })
    .accountsStrict({
      admin: p.admin,
      config: configPda(),
      usdcMint: p.usdcMint,
      market: k.market,
      mintAuthority: k.mintAuthority,
      yesMint: k.yesMint,
      noMint: k.noMint,
      vault: k.vault,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
      rent: SYSVAR_RENT_PUBKEY,
    })
    .instruction();
}

export interface PauseParams {
  admin: PublicKey;
}

export function pause(
  program: MeridianProgram,
  p: PauseParams
): Promise<TransactionInstruction> {
  return program.methods
    .pause()
    .accountsStrict({ admin: p.admin, config: configPda() })
    .instruction();
}

export function unpause(
  program: MeridianProgram,
  p: PauseParams
): Promise<TransactionInstruction> {
  return program.methods
    .unpause()
    .accountsStrict({ admin: p.admin, config: configPda() })
    .instruction();
}

// ---------------------------------------------------------------------------
// Order book provisioning (two-step: init then grow)
// ---------------------------------------------------------------------------

export interface OrderBookProvisionParams {
  payer: PublicKey;
  usdcMint: PublicKey;
  market: MarketId | PublicKey;
}

function resolveMarketPdas(market: MarketId | PublicKey): MarketPdas {
  return market instanceof PublicKey
    ? deriveMarketPdas(market)
    : pdasFor(market);
}

/** Build `init_order_book` (allocates book ≤10 KB + escrow accounts). Permissionless. */
export function initOrderBook(
  program: MeridianProgram,
  p: OrderBookProvisionParams
): Promise<TransactionInstruction> {
  const k = resolveMarketPdas(p.market);
  return program.methods
    .initOrderBook()
    .accountsStrict({
      payer: p.payer,
      market: k.market,
      orderBook: k.orderBook,
      mintAuthority: k.mintAuthority,
      yesMint: k.yesMint,
      usdcMint: p.usdcMint,
      vault: k.vault,
      usdcEscrow: k.usdcEscrow,
      yesEscrow: k.yesEscrow,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
      rent: SYSVAR_RENT_PUBKEY,
    })
    .instruction();
}

/** Build `grow_order_book` (reallocs to full size + wires Market.order_book). Permissionless. */
export function growOrderBook(
  program: MeridianProgram,
  p: { payer: PublicKey; market: MarketId | PublicKey }
): Promise<TransactionInstruction> {
  const k = resolveMarketPdas(p.market);
  return program.methods
    .growOrderBook()
    .accountsStrict({
      payer: p.payer,
      market: k.market,
      orderBook: k.orderBook,
      systemProgram: SystemProgram.programId,
    })
    .instruction();
}

// ---------------------------------------------------------------------------
// Mint / redeem
// ---------------------------------------------------------------------------

export interface MintPairParams {
  user: PublicKey;
  usdcMint: PublicKey;
  market: MarketId | PublicKey;
}

/**
 * Build `mint_pair`: deposit exactly $1.00 (PAYOFF_UNIT USDC base units) and receive
 * 1.0 Yes + 1.0 No. The instruction takes no amount — each call mints one unit pair;
 * mint N pairs by sending N instructions. The user's Yes/No token accounts are created
 * on demand (the program's associated-token accounts are `init_if_needed`); the user's
 * USDC account must already exist and hold ≥ PAYOFF_UNIT.
 */
export function mintPair(
  program: MeridianProgram,
  p: MintPairParams
): Promise<TransactionInstruction> {
  const k = resolveMarketPdas(p.market);
  const userUsdc = ata(p.usdcMint, p.user);
  const userYes = ata(k.yesMint, p.user);
  const userNo = ata(k.noMint, p.user);
  return program.methods
    .mintPair()
    .accountsStrict({
      user: p.user,
      config: configPda(),
      market: k.market,
      mintAuthority: k.mintAuthority,
      yesMint: k.yesMint,
      noMint: k.noMint,
      vault: k.vault,
      usdcMint: p.usdcMint,
      userUsdc,
      userYes,
      userNo,
      tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .instruction();
}

export interface RedeemParams {
  user: PublicKey;
  market: MarketId | PublicKey;
  /** Which outcome token to redeem. */
  side: RedeemSide;
  /** Token base units to redeem. */
  amount: BNLike;
  usdcMint: PublicKey;
  /** Optional explicit token/usdc accounts; default to the user's ATAs. */
  userTokens?: PublicKey;
  userUsdc?: PublicKey;
}

/** Build `redeem` (burn settled tokens → payout for the winning side). */
export function redeem(
  program: MeridianProgram,
  p: RedeemParams
): Promise<TransactionInstruction> {
  const k = resolveMarketPdas(p.market);
  const tokenMint = p.side === RedeemSide.Yes ? k.yesMint : k.noMint;
  const userTokens = p.userTokens ?? ata(tokenMint, p.user);
  const userUsdc = p.userUsdc ?? ata(p.usdcMint, p.user);
  return program.methods
    .redeem(redeemSideToArg(p.side), toBN(p.amount))
    .accountsStrict({
      user: p.user,
      market: k.market,
      mintAuthority: k.mintAuthority,
      yesMint: k.yesMint,
      noMint: k.noMint,
      vault: k.vault,
      userTokens,
      userUsdc,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .instruction();
}

// ---------------------------------------------------------------------------
// Trading
// ---------------------------------------------------------------------------

export interface PlaceOrderParams {
  user: PublicKey;
  market: MarketId | PublicKey;
  side: OrderSide;
  /** Limit price in USDC-per-Yes at PRICE_SCALE. Ignored when `isMarket`. */
  price: BNLike;
  /** Size in Yes-token base units. */
  size: BNLike;
  /** Market order: cross at any price, fill-or-cancel the remainder. */
  isMarket?: boolean;
  usdcMint: PublicKey;
  /** Optional explicit taker accounts; default to the user's ATAs. */
  userUsdc?: PublicKey;
  userYes?: PublicKey;
  /**
   * Maker counterparty token accounts for any orders filled this call. The program
   * reads these from `remaining_accounts` and verifies them against each resting
   * order's recorded owner + mint. Callers compute them from the current book
   * (see {@link reads}); empty if no cross is expected.
   */
  makerAccounts?: PublicKey[];
}

/** Build `place_order` (cross-then-rest). */
export async function placeOrder(
  program: MeridianProgram,
  p: PlaceOrderParams
): Promise<TransactionInstruction> {
  const k = resolveMarketPdas(p.market);
  const price = toBN(p.price);
  const size = toBN(p.size);
  const isMarket = p.isMarket ?? false;
  assertOrderArgs(price, size, isMarket);
  const userUsdc = p.userUsdc ?? ata(p.usdcMint, p.user);
  const userYes = p.userYes ?? ata(k.yesMint, p.user);
  const remaining = (p.makerAccounts ?? []).map((pubkey) => ({
    pubkey,
    isSigner: false,
    isWritable: true,
  }));
  return program.methods
    .placeOrder({
      side: orderSideToArg(p.side),
      price,
      size,
      isMarket,
    })
    .accountsStrict({
      user: p.user,
      config: configPda(),
      market: k.market,
      orderBook: k.orderBook,
      mintAuthority: k.mintAuthority,
      yesMint: k.yesMint,
      usdcEscrow: k.usdcEscrow,
      yesEscrow: k.yesEscrow,
      userUsdc,
      userYes,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .remainingAccounts(remaining)
    .instruction();
}

export interface CancelOrderParams {
  user: PublicKey;
  market: MarketId | PublicKey;
  side: OrderSide;
  /** The resting order's sequence number. */
  seq: BNLike;
  usdcMint: PublicKey;
  /**
   * Where to refund escrow: USDC account for a bid, Yes account for an ask.
   * Defaults to the caller's ATA for the appropriate mint.
   */
  refundTo?: PublicKey;
}

/** Build `cancel_order` (remove a resting order, return its escrow). */
export function cancelOrder(
  program: MeridianProgram,
  p: CancelOrderParams
): Promise<TransactionInstruction> {
  const k = resolveMarketPdas(p.market);
  const refundTo =
    p.refundTo ??
    (p.side === OrderSide.Bid
      ? ata(p.usdcMint, p.user)
      : ata(k.yesMint, p.user));
  return program.methods
    .cancelOrder({ side: orderSideToArg(p.side), seq: toBN(p.seq) })
    .accountsStrict({
      user: p.user,
      market: k.market,
      orderBook: k.orderBook,
      mintAuthority: k.mintAuthority,
      usdcEscrow: k.usdcEscrow,
      yesEscrow: k.yesEscrow,
      refundTo,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .instruction();
}

export interface MatchOrdersParams {
  cranker: PublicKey;
  market: MarketId | PublicKey;
  /** Max fills this call (compute-budget bound). */
  maxFills: number;
  /** Maker counterparty token accounts for the orders to be filled. */
  makerAccounts?: PublicKey[];
}

/** Build `match_orders` (permissionless crank settling crossed bid/ask pairs). */
export function matchOrders(
  program: MeridianProgram,
  p: MatchOrdersParams
): Promise<TransactionInstruction> {
  const k = resolveMarketPdas(p.market);
  const remaining = (p.makerAccounts ?? []).map((pubkey) => ({
    pubkey,
    isSigner: false,
    isWritable: true,
  }));
  return program.methods
    .matchOrders({ maxFills: p.maxFills })
    .accountsStrict({
      cranker: p.cranker,
      config: configPda(),
      market: k.market,
      orderBook: k.orderBook,
      mintAuthority: k.mintAuthority,
      yesMint: k.yesMint,
      usdcEscrow: k.usdcEscrow,
      yesEscrow: k.yesEscrow,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .remainingAccounts(remaining)
    .instruction();
}

// ---------------------------------------------------------------------------
// Settlement
// ---------------------------------------------------------------------------

export interface SettleMarketParams {
  cranker: PublicKey;
  market: MarketId | PublicKey;
  /** The Pyth `PriceUpdateV2` account posted via the Receiver. */
  priceUpdate: PublicKey;
}

/** Build `settle_market` (permissionless oracle settlement). */
export function settleMarket(
  program: MeridianProgram,
  p: SettleMarketParams
): Promise<TransactionInstruction> {
  const k = resolveMarketPdas(p.market);
  return program.methods
    .settleMarket()
    .accountsStrict({
      cranker: p.cranker,
      config: configPda(),
      market: k.market,
      priceUpdate: p.priceUpdate,
    })
    .instruction();
}

export interface AdminSettleParams {
  admin: PublicKey;
  market: MarketId | PublicKey;
  /** Closing price in USDC base units (6 dp). */
  settlementPrice: BNLike;
}

/** Build `admin_settle` (time-delayed admin override). */
export function adminSettle(
  program: MeridianProgram,
  p: AdminSettleParams
): Promise<TransactionInstruction> {
  const k = resolveMarketPdas(p.market);
  return program.methods
    .adminSettle(toBN(p.settlementPrice))
    .accountsStrict({
      admin: p.admin,
      config: configPda(),
      market: k.market,
    })
    .instruction();
}
