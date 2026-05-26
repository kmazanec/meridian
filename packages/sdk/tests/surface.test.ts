import { expect } from "chai";
import * as sdk from "../src/index";

/**
 * Locks the package's public surface: every symbol consumers (automation, traders,
 * web, ops) import from `@meridian/sdk`. If one is renamed or dropped, a downstream
 * consumer breaks — so this test is the tripwire. Adding new exports is fine (the
 * assertion is "these exist", not "only these").
 */
describe("public surface", () => {
  const required = [
    // program / idl / constants
    "MERIDIAN_IDL",
    "PROGRAM_ID",
    "getProgram",
    "getProgramFromConnection",
    "PAYOFF_UNIT",
    "dollarsToBaseUnits",
    "PRICE_SCALE",
    "TOKEN_DECIMALS",
    "USDC_DECIMALS",
    "ORDERBOOK_N",
    "NUM_TICKERS",
    // types / codecs
    "Ticker",
    "OrderSide",
    "RedeemSide",
    "Outcome",
    "MarketState",
    "tickerToArg",
    "symbolToTicker",
    // calendar
    "isWeekend",
    "isHoliday",
    "isHalfDay",
    "isTradingDay",
    "closeInstant",
    "sessionForDate",
    "etParts",
    // pdas
    "configPda",
    "marketPda",
    "orderBookPda",
    "vaultPda",
    "mintAuthorityPda",
    "yesMintPda",
    "noMintPda",
    "usdcEscrowPda",
    "yesEscrowPda",
    "deriveMarketPdas",
    "ata",
    // instruction builders (full set)
    "initializeConfig",
    "createStrikeMarket",
    "addStrike",
    "initOrderBook",
    "growOrderBook",
    "mintPair",
    "placeOrder",
    "cancelOrder",
    "matchOrders",
    "settleMarket",
    "adminSettle",
    "redeem",
    "pause",
    "unpause",
    "createAtaIfNeeded",
    // reads
    "fetchConfig",
    "fetchMarket",
    "fetchMarketById",
    "fetchOrderBook",
    "fetchUserPosition",
    "fetchBalance",
    "dualBook",
    "complementPrice",
    "payoutFor",
    // intent
    "buildTradeIntent",
    "reflectPrice",
    "TradeAction",
    // pyth
    "fetchPriceUpdate",
    "postPriceUpdate",
    "settleWithPyth",
    "buildPriceUpdateV2",
    "PYTH_RECEIVER_PROGRAM_ID",
    // confirm (send/confirm via HTTP polling)
    "sendAndConfirm",
    "confirmSignature",
    "isRateLimited",
    "rateLimitBackoffMs",
  ] as const;

  for (const name of required) {
    it(`exports ${name}`, () => {
      expect(
        (sdk as Record<string, unknown>)[name],
        `missing export: ${name}`
      ).to.not.equal(undefined);
    });
  }

  it("does not eagerly load the optional Pyth peer deps at import time", () => {
    // The Pyth network functions lazy-import their heavy deps; merely importing the SDK
    // (this file) must not have pulled them into the module cache. This keeps a Node
    // service / browser bundle that never settles from paying for them.
    const loaded = Object.keys(require.cache).some(
      (p) =>
        p.includes("@pythnetwork/hermes-client") ||
        p.includes("@pythnetwork/pyth-solana-receiver")
    );
    expect(
      loaded,
      "Pyth SDKs must not load until a network helper is called"
    ).to.equal(false);
  });
});
