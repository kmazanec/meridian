/**
 * Opt-in live-devnet settlement smoke test — the genuine Pyth pull-oracle path (AC#5).
 *
 * The local suites settle via the admin override because the Pyth Solana Receiver isn't
 * deployed on a fresh validator. This test exercises the real path on a cluster where the
 * Receiver IS deployed (devnet/mainnet): fetch a signed price from Hermes, post it via the
 * Receiver, and crank `settle_market` — proving the program's on-chain Pyth parsing,
 * staleness, and confidence checks against a live feed, end to end.
 *
 * It is **skipped unless** explicitly enabled, because it needs:
 *   - `E2E_DEVNET=1`,
 *   - `RPC_URL` for a cluster with the Pyth Receiver + the feed posted,
 *   - `SOLANA_KEYPAIR` (a funded keypair file) — the admin/cranker/fee-payer,
 *   - `FEED_<TICKER>` (the cluster's hex feed id for the ticker under test, default META),
 *   - the on-chain `Config` already initialized with that feed id (so the feed-match check
 *     passes), and the keypair as its admin (to create the market),
 *   - and a fresh price, i.e. **US market hours** for an equity feed (crypto feeds like
 *     SOL/USD are 24/7 and make a good stand-in — see the fallback ladder below).
 *
 * Fallback ladder (ARCHITECTURE §14 Q1) when an equity feed is stale/out-of-hours:
 *   (a) point FEED_<TICKER> at a 24/7 crypto feed (BTC/SOL) to prove the settlement
 *       *mechanics* on devnet any time; (b) mock the oracle behind the interface for dev;
 *       (c) validate equities on mainnet-beta with tiny amounts. The admin override
 *       (covered by the local suites) is the guaranteed demo fallback regardless.
 */

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { expect } from "chai";
import BN from "bn.js";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import {
  Ticker,
  TICKER_SYMBOLS,
  fetchConfig,
  fetchMarket,
  fetchMarketById,
  createStrikeMarket,
  getProgram,
  marketPda,
  settleWithPyth,
  tickerToSymbol,
  symbolToTicker,
} from "@meridian/sdk";

const ENABLED = process.env.E2E_DEVNET === "1";
const describeDevnet = ENABLED ? describe : describe.skip;

/** Load a Solana CLI keypair file (JSON byte array), expanding a leading ~. */
function loadKeypair(path: string): Keypair {
  const resolved = path.startsWith("~") ? path.replace(/^~/, homedir()) : path;
  const bytes = JSON.parse(readFileSync(resolved, "utf8")) as number[];
  return Keypair.fromSecretKey(Uint8Array.from(bytes));
}

describeDevnet("live-devnet settlement via Pyth (opt-in)", function () {
  this.timeout(180_000);

  // Resolve config from env; fail with a clear message if enabled-but-misconfigured.
  const rpcUrl = process.env.RPC_URL ?? "https://api.devnet.solana.com";
  const symbol = (process.env.E2E_DEVNET_TICKER ?? "META").toUpperCase();
  const ticker: Ticker = symbolToTicker(symbol);
  const feedId = process.env[`FEED_${symbol}`] ?? "";
  const keypairPath = process.env.SOLANA_KEYPAIR ?? "";

  let connection: Connection;
  let cranker: Keypair;

  before(function () {
    if (!feedId) {
      throw new Error(
        `FEED_${symbol} is required for the devnet smoke test (the cluster's hex feed id).`
      );
    }
    if (!keypairPath) {
      throw new Error(
        "SOLANA_KEYPAIR (a funded keypair file path) is required."
      );
    }
    expect(TICKER_SYMBOLS).to.include(symbol);
    connection = new Connection(rpcUrl, "confirmed");
    cranker = loadKeypair(keypairPath);
  });

  it("posts a Hermes price update and settles a market via settle_market", async () => {
    const program = getProgram({
      connection,
      publicKey: cranker.publicKey,
    } as never);

    // The Config must already be initialized with this feed id (the on-chain feed-match
    // check compares the posted update's feed id against Config.tickers[ticker].feed_id).
    const config = await fetchConfig(program);
    expect(config, "Config must be initialized on this cluster").to.not.equal(
      null
    );
    expect(
      config!.admin.toBase58(),
      "keypair must be the Config admin"
    ).to.equal(cranker.publicKey.toBase58());
    const usdcMint = config!.usdcMint;

    // Create a market whose close is a few minutes in the past, so settle_market's timing
    // gate (now >= trading_day) passes while the Pyth price is still fresh (< staleness).
    // The 300s offset is also what makes the "within 10 min of close" assertion below a
    // real bound: settledAt − tradingDay must come out ~300s (< 600s).
    const closeOffsetSeconds = 300;
    const tradingDay = Math.floor(Date.now() / 1000) - closeOffsetSeconds;
    const strike = new BN(1); // strike $0.000001 → essentially any positive price → Yes wins
    const market = { ticker, strike, tradingDay: new BN(tradingDay) };

    const existing = await fetchMarketById(
      program,
      ticker,
      strike,
      new BN(tradingDay)
    );
    if (!existing) {
      const { sendAndConfirmTransaction, Transaction } = await import(
        "@solana/web3.js"
      );
      const ix = await createStrikeMarket(program, {
        admin: cranker.publicKey,
        usdcMint,
        market,
      });
      await sendAndConfirmTransaction(
        connection,
        new Transaction().add(ix),
        [cranker],
        { commitment: "confirmed" }
      );
    }

    // The genuine pull-oracle path: Hermes → Pyth Solana Receiver → settle_market.
    const { settleSignature, priceUpdateAccount } = await settleWithPyth(
      program,
      connection,
      cranker,
      market,
      feedId,
      process.env.HERMES_URL
    );
    expect(settleSignature, "settle tx signature").to.be.a("string");
    expect(priceUpdateAccount).to.be.instanceOf(PublicKey);

    // The market is settled, with the closing price + timestamp written immutably, and
    // settled within the 10-minute window of the (past) close instant (AC#5).
    const settled = await fetchMarket(
      program,
      marketPda(ticker, strike, new BN(tradingDay))
    );
    expect(settled!.state, "settled on-chain").to.equal("settled");
    expect(settled!.outcome).to.be.oneOf(["yesWins", "noWins"]);
    expect(settled!.settlementPrice, "settlement price written").to.not.equal(
      null
    );
    // AC#5: settlement happens within 10 minutes of the close instant. Assert the actual
    // elapsed gap (settledAt − tradingDay) is in (0, 600] — a real bound here, since the
    // close is 300s in the past, not a window that's trivially satisfied by "now".
    const settledGap = settled!.settledAt!.toNumber() - tradingDay;
    expect(settledGap, "settledAt is after the close").to.be.greaterThan(0);
    expect(settledGap, "settled within 10 min of close (AC#5)").to.be.at.most(
      600
    );

    // eslint-disable-next-line no-console
    console.log(
      `devnet settle ok: ${tickerToSymbol(ticker)} outcome=${
        settled!.outcome
      } ` +
        `price=${settled!.settlementPrice!.toString()} sig=${settleSignature}`
    );
  });
});
