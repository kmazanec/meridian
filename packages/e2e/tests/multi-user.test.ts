/**
 * Multi-user maker/taker scenario, end-to-end (AC#3, AC#4).
 *
 * A maker mints pairs and posts quotes (resting orders on both sides); a taker crosses
 * them; the market settles; and BOTH parties redeem to the correct USDC. Proves the
 * integrated stack conserves value across users — the collateralization invariant holds
 * after every step, the vault drains to exactly zero once all winners redeem, and each
 * party's net P&L is the zero-sum mirror of the other's.
 */

import { expect } from "chai";
import BN from "bn.js";
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
  type MarketId,
} from "@meridian/sdk";
import {
  startLocalValidator,
  describeOnValidator,
  type LocalValidator,
} from "../src/localValidator";
import { Fixture, sendTx, type TestUser } from "../src/fixture";
import { makerAccountsFor } from "../src/crossing";

const ONE = new BN(PAYOFF_UNIT);
const STRIKE = 680_000_000;

describeOnValidator("multi-user maker/taker scenario", function () {
  this.timeout(180_000);

  let validator: LocalValidator;
  let fx: Fixture;

  before(async () => {
    validator = await startLocalValidator();
    fx = await Fixture.bootstrap(validator);
  });

  after(async () => {
    await validator?.stop();
  });

  it("maker quotes, taker fills, settle, both redeem to the right USDC", async () => {
    const market = await fx.createMarket({
      ticker: Ticker.Meta,
      strike: STRIKE,
    });

    // Two real users with their own keypairs and starting USDC.
    const maker = await fx.newUser(100);
    const taker = await fx.newUser(100);
    const makerStartUsdc = (await fx.position(maker.publicKey, market)).usdc;
    const takerStartUsdc = (await fx.position(taker.publicKey, market)).usdc;

    // ── maker mints and posts quotes ─────────────────────────────────────────
    // Maker mints 6 pairs (holds 6 Yes + 6 No, vault $6), then quotes the book:
    //  - rests an ASK to SELL 4 Yes @ $0.65 (offering its Yes inventory), and
    //  - rests a BID to BUY 2 Yes @ $0.55 (wanting more Yes).
    await fx.mintPairs(maker, market, 6);
    await fx.assertCollateralization(market);

    await sendTx(
      fx.connection,
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
      fx.connection,
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

    let book = await fetchOrderBook(fx.program, marketAddr(market));
    expect(
      book!.asks.filter((o) => o.active && !o.size.isZero()).length
    ).to.equal(1);
    expect(
      book!.bids.filter((o) => o.active && !o.size.isZero()).length
    ).to.equal(1);

    // ── taker fills the maker's ask ──────────────────────────────────────────
    // Taker buys all 4 Yes @ $0.65 (crosses the ask). Pays 4 × $0.65 = $2.60.
    const makerAccounts = makerAccountsFor({
      book: book!,
      side: OrderSide.Bid,
      price: new BN(650_000),
      size: ONE.muln(4),
      isMarket: false,
      usdcMint: fx.usdcMint,
      yesMint: yesMint(market),
    });
    await sendTx(
      fx.connection,
      taker.keypair,
      [
        createAtaIfNeeded(taker.publicKey, taker.publicKey, yesMint(market)),
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

    // Taker holds 4 Yes; maker sold 4 (kept 2 Yes) and gained $2.60.
    expect(
      (await fx.position(taker.publicKey, market)).yes.toString()
    ).to.equal(ONE.muln(4).toString());
    // Trading never touches the vault.
    await fx.assertCollateralization(market);

    // The maker's resting bid (BUY 2 Yes @ $0.55) is still open with USDC escrowed; cancel
    // it so the maker's books are clean before settlement (frees the escrow back to maker).
    book = await fetchOrderBook(fx.program, marketAddr(market));
    const restingBid = book!.bids.find((o) => o.active && !o.size.isZero());
    expect(restingBid, "maker bid still resting").to.not.equal(undefined);
    await sendTx(
      fx.connection,
      maker.keypair,
      [
        await cancelOrder(fx.program, {
          user: maker.publicKey,
          market,
          side: OrderSide.Bid,
          seq: restingBid!.seq,
          usdcMint: fx.usdcMint,
        }),
      ],
      [maker.keypair]
    );

    // ── settle (Yes wins) ────────────────────────────────────────────────────
    await fx.settleAdmin(market, STRIKE + 1);
    expect((await fx.market(market)).outcome).to.equal("yesWins");

    // ── both redeem ──────────────────────────────────────────────────────────
    // Winners hold Yes: taker 4, maker 2. Losers' No pay $0.
    await redeemSide(fx, taker, market, RedeemSide.Yes, ONE.muln(4));
    await fx.assertCollateralization(market);
    await redeemSide(fx, maker, market, RedeemSide.Yes, ONE.muln(2));
    // Maker also burns its 6 losing No for $0 (no payout, just clears the position).
    await redeemSide(fx, maker, market, RedeemSide.No, ONE.muln(6));

    // Vault fully drained: all 6 winning Yes (4 taker + 2 maker) redeemed.
    expect(
      (await fx.vaultBalance(market)).toString(),
      "vault drained to zero"
    ).to.equal("0");
    await fx.assertCollateralization(market);

    // ── zero-sum P&L across the two users ────────────────────────────────────
    const makerEndUsdc = (await fx.position(maker.publicKey, market)).usdc;
    const takerEndUsdc = (await fx.position(taker.publicKey, market)).usdc;
    const makerPnl = makerEndUsdc - makerStartUsdc;
    const takerPnl = takerEndUsdc - takerStartUsdc;

    // Taker: −$2.60 (bought 4 Yes) + $4.00 (redeemed 4 winning Yes) = +$1.40.
    expect(takerPnl.toString(), "taker P&L = +$1.40").to.equal(
      1_400_000n.toString()
    );
    // Maker: minted 6 ($−6) + sold 4 Yes ($+2.60) + redeemed 2 Yes ($+2.00) = −$1.40.
    expect(makerPnl.toString(), "maker P&L = −$1.40").to.equal(
      (-1_400_000n).toString()
    );
    // The system is exactly zero-sum between the two parties (no value created/destroyed).
    expect((makerPnl + takerPnl).toString(), "zero-sum across users").to.equal(
      "0"
    );
  });
});

// --- helpers ---

function marketAddr(market: MarketId) {
  return marketPda(market.ticker, market.strike, market.tradingDay);
}
function yesMint(market: MarketId) {
  return deriveMarketPdasFromIdentity(
    market.ticker,
    market.strike,
    market.tradingDay
  ).yesMint;
}

async function redeemSide(
  fx: Fixture,
  user: TestUser,
  market: MarketId,
  side: RedeemSide,
  amount: BN
) {
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
