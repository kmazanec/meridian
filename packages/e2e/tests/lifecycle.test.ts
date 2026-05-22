/**
 * Full daily lifecycle, end-to-end on a real validator (AC#1, AC#4).
 *
 *   create market → mint pair → trade on the order book → settle → redeem
 *
 * Drives the integrated stack through the SDK and asserts the on-chain invariants
 * (ARCHITECTURE.md §7) after *each* phase:
 *   - collateralization (vault == PAYOFF_UNIT × pairs_minted − winning_redeemed) after mint/trade/redeem,
 *   - settlement immutability (a second settle is rejected; outcome/price unchanged),
 *   - payout completeness (Yes_payout + No_payout == $1.00) at redemption.
 */

import { expect } from "chai";
import BN from "bn.js";
import {
  OrderSide,
  RedeemSide,
  Ticker,
  PAYOFF_UNIT,
  placeOrder,
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
import { Fixture, sendTx } from "../src/fixture";
import { makerAccountsFor } from "../src/crossing";

const STRIKE = 680_000_000;
const ONE = new BN(PAYOFF_UNIT);

describeOnValidator(
  "full lifecycle (create → mint → trade → settle → redeem)",
  function () {
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

    it("runs the whole cycle and holds every invariant", async () => {
      // ── create ──────────────────────────────────────────────────────────────
      // Past-dated close so admin_settle is callable later without advancing the clock;
      // the market is still Open (mint/trade gate on state, not the wall clock).
      const market = await fx.createMarket({
        ticker: Ticker.Meta,
        strike: STRIKE,
      });
      await fx.assertCollateralization(market); // empty vault, 0 pairs

      const maker = await fx.newUser(20);
      const taker = await fx.newUser(20);

      // ── mint ────────────────────────────────────────────────────────────────
      // Maker mints 5 pairs (holds 5 Yes + 5 No); vault now $5.
      await fx.mintPairs(maker, market, 5);
      expect((await fx.market(market)).pairsMinted.toString()).to.equal("5");
      expect((await fx.vaultBalance(market)).toString()).to.equal(
        (BigInt(PAYOFF_UNIT.toString()) * 5n).toString()
      );
      await fx.assertCollateralization(market);

      // ── trade ───────────────────────────────────────────────────────────────
      // Maker rests an ask: SELL 3 Yes @ $0.60. Taker buys 3 Yes @ $0.60 (bid crosses).
      const askPrice = new BN(600_000);
      const tradeSize = ONE.muln(3);

      await sendTx(
        fx.connection,
        maker.keypair,
        [
          await placeOrder(fx.program, {
            user: maker.publicKey,
            market,
            side: OrderSide.Ask,
            price: askPrice,
            size: tradeSize,
            usdcMint: fx.usdcMint,
          }),
        ],
        [maker.keypair]
      );

      // The maker's Yes is escrowed; book shows the resting ask.
      let book = await fetchOrderBook(fx.program, marketAddr(market));
      expect(
        book!.asks.filter((o) => o.active).length,
        "one resting ask"
      ).to.equal(1);

      // Taker crosses with a bid at the same price; supply the maker's USDC payout account.
      const makerAccounts = makerAccountsFor({
        book: book!,
        side: OrderSide.Bid,
        price: askPrice,
        size: tradeSize,
        isMarket: false,
        usdcMint: fx.usdcMint,
        yesMint: yesMint(market),
      });
      expect(makerAccounts.length, "one maker to cross").to.equal(1);

      const takerUsdcBefore = (await fx.position(taker.publicKey, market)).usdc;
      // The raw place_order builder does not create the buyer's Yes ATA (only the SDK's
      // buildTradeIntent prepends that). A taker buying Yes for the first time must create
      // it — exactly what the frontend's intent flow does idempotently.
      await sendTx(
        fx.connection,
        taker.keypair,
        [
          createAtaIfNeeded(taker.publicKey, taker.publicKey, yesMint(market)),
          await placeOrder(fx.program, {
            user: taker.publicKey,
            market,
            side: OrderSide.Bid,
            price: askPrice,
            size: tradeSize,
            usdcMint: fx.usdcMint,
            makerAccounts,
          }),
        ],
        [taker.keypair]
      );

      // Taker now holds 3 Yes; the ask is fully consumed.
      const takerPos = await fx.position(taker.publicKey, market);
      expect(takerPos.yes.toString(), "taker bought 3 Yes").to.equal(
        tradeSize.toString()
      );
      // Taker paid 3 × $0.60 = $1.80.
      expect(
        (takerUsdcBefore - takerPos.usdc).toString(),
        "taker paid 3×$0.60"
      ).to.equal((BigInt(askPrice.toString()) * 3n).toString());
      book = await fetchOrderBook(fx.program, marketAddr(market));
      expect(
        book!.asks.filter((o) => o.active && !o.size.isZero()).length,
        "ask fully filled"
      ).to.equal(0);

      // Trading moves tokens/USDC between users but never touches the collateral vault.
      await fx.assertCollateralization(market);

      // ── settle ──────────────────────────────────────────────────────────────
      // Close ≥ strike → Yes wins. (admin override; market was created past-dated.)
      await fx.settleAdmin(market, STRIKE + 1);
      const settled = await fx.market(market);
      expect(settled.state).to.equal("settled");
      expect(settled.outcome).to.equal("yesWins");
      expect(settled.settlementPrice!.toString()).to.equal(String(STRIKE + 1));

      // Settlement immutability (§7.4): a second settle is an idempotent no-op (ADR-005) —
      // it must NOT overwrite the recorded outcome/price even with a different argument.
      await fx.settleAdmin(market, STRIKE + 999);
      const after = await fx.market(market);
      expect(
        after.settlementPrice!.toString(),
        "settlement price unchanged"
      ).to.equal(String(STRIKE + 1));
      expect(after.outcome, "outcome unchanged").to.equal("yesWins");

      // ── redeem ──────────────────────────────────────────────────────────────
      // Winner (taker, holds 3 Yes) redeems → $3.00; loser side (No) redeems → $0.
      // Payout completeness: a maker who holds both 2 Yes + 5 No redeems each side and
      // the per-pair sum is exactly $1.00.
      const takerUsdcPre = (await fx.position(taker.publicKey, market)).usdc;
      await sendTx(
        fx.connection,
        taker.keypair,
        [
          await redeem(fx.program, {
            user: taker.publicKey,
            market,
            side: RedeemSide.Yes,
            amount: tradeSize,
            usdcMint: fx.usdcMint,
          }),
        ],
        [taker.keypair]
      );
      const takerUsdcPost = (await fx.position(taker.publicKey, market)).usdc;
      expect(
        (takerUsdcPost - takerUsdcPre).toString(),
        "winner paid $3.00"
      ).to.equal((BigInt(PAYOFF_UNIT.toString()) * 3n).toString());
      await fx.assertCollateralization(market); // winning_redeemed now tracks the $3

      // Maker redeems the winning Yes it kept (5 minted − 3 sold = 2 Yes) → $2.00.
      const makerPosBefore = await fx.position(maker.publicKey, market);
      expect(makerPosBefore.yes.toString(), "maker kept 2 Yes").to.equal(
        ONE.muln(2).toString()
      );
      const makerUsdcPre = makerPosBefore.usdc;
      await sendTx(
        fx.connection,
        maker.keypair,
        [
          await redeem(fx.program, {
            user: maker.publicKey,
            market,
            side: RedeemSide.Yes,
            amount: ONE.muln(2),
            usdcMint: fx.usdcMint,
          }),
        ],
        [maker.keypair]
      );

      // The losing No side pays $0 (burns the tokens). Maker holds 5 No.
      await sendTx(
        fx.connection,
        maker.keypair,
        [
          await redeem(fx.program, {
            user: maker.publicKey,
            market,
            side: RedeemSide.No,
            amount: ONE.muln(5),
            usdcMint: fx.usdcMint,
          }),
        ],
        [maker.keypair]
      );
      const makerUsdcPost = (await fx.position(maker.publicKey, market)).usdc;
      expect(
        (makerUsdcPost - makerUsdcPre).toString(),
        "maker: 2 winning Yes pay $2, 5 losing No pay $0"
      ).to.equal((BigInt(PAYOFF_UNIT.toString()) * 2n).toString());

      // All winning tokens redeemed (3 taker + 2 maker = 5); vault fully drains.
      expect(
        (await fx.vaultBalance(market)).toString(),
        "vault drained"
      ).to.equal("0");
      await fx.assertCollateralization(market);

      // Payout completeness across the whole market: total paid out == $5 (one dollar per
      // minted pair), matching the $5 collateral that ever entered the vault.
      const finalMarket = await fx.market(market);
      expect(
        finalMarket.winningRedeemed.toString(),
        "total paid == $5"
      ).to.equal((BigInt(PAYOFF_UNIT.toString()) * 5n).toString());
    });
  }
);

// --- local PDA helpers (thin wrappers to keep the test readable) ---

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
