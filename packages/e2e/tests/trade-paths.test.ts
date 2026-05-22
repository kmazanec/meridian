/**
 * All four trade paths on the one Yes/USDC book (AC#2).
 *
 * ARCHITECTURE §6: one book serves four user actions in two perspectives —
 *   Buy Yes  & Sell No  → buying Yes  (bid)
 *   Sell Yes & Buy No   → selling Yes (ask)
 * Each path is driven through the SDK's `buildTradeIntent` (the single source of the
 * four-button mapping) against resting maker liquidity, and the taker's resulting
 * Yes/No/USDC balances are asserted. Includes a partial fill (taker size > resting size)
 * and the at-strike settlement boundary.
 */

import { expect } from "chai";
import BN from "bn.js";
import {
  OrderSide,
  RedeemSide,
  Ticker,
  TradeAction,
  PAYOFF_UNIT,
  PRICE_SCALE,
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
import { Fixture, sendTx, type TestUser } from "../src/fixture";

const ONE = new BN(PAYOFF_UNIT);

describeOnValidator("four trade paths on one book", function () {
  this.timeout(180_000);

  let validator: LocalValidator;
  let fx: Fixture;
  let maker: TestUser;

  before(async () => {
    validator = await startLocalValidator();
    fx = await Fixture.bootstrap(validator);
    maker = await fx.newUser(200);
  });

  after(() => validator?.stop());

  /** Maker rests a resting ask (SELL Yes) of `size` at `price`. Maker must hold Yes. */
  async function makerRestsAsk(market: MarketId, price: BN, size: BN) {
    await fx.mintPairs(maker, market, size.div(ONE).toNumber());
    await sendTx(
      fx.connection,
      maker.keypair,
      [
        await placeOrder(fx.program, {
          user: maker.publicKey,
          market,
          side: OrderSide.Ask,
          price,
          size,
          usdcMint: fx.usdcMint,
        }),
      ],
      [maker.keypair]
    );
  }

  /**
   * Maker rests a resting bid (BUY Yes) of `size` at `price`. A bidder receives Yes when
   * the bid fills, so place_order requires the maker's Yes ATA to exist — create it first
   * (idempotent), the same prerequisite buildTradeIntent handles for intent-driven trades.
   */
  async function makerRestsBid(market: MarketId, price: BN, size: BN) {
    await sendTx(
      fx.connection,
      maker.keypair,
      [
        createAtaIfNeeded(maker.publicKey, maker.publicKey, yesMint(market)),
        await placeOrder(fx.program, {
          user: maker.publicKey,
          market,
          side: OrderSide.Bid,
          price,
          size,
          usdcMint: fx.usdcMint,
        }),
      ],
      [maker.keypair]
    );
  }

  it("Buy Yes: taker bids into a resting ask, gains Yes for USDC", async () => {
    const market = await fx.createMarket({ ticker: Ticker.Meta, strike: 680_000_000 });
    await makerRestsAsk(market, new BN(600_000), ONE.muln(3));

    const taker = await fx.newUser(50);
    const before = await fx.position(taker.publicKey, market);
    await fx.trade(taker, market, {
      action: TradeAction.BuyYes,
      price: new BN(600_000),
      size: ONE.muln(3),
    });
    const after = await fx.position(taker.publicKey, market);

    expect((after.yes - before.yes).toString(), "taker gained 3 Yes").to.equal(
      ONE.muln(3).toString()
    );
    expect((before.usdc - after.usdc).toString(), "paid 3 × $0.60").to.equal(
      (600_000n * 3n).toString()
    );
    expect(after.no.toString(), "no No acquired").to.equal("0");
    await fx.assertCollateralization(market);
  });

  it("Sell Yes: taker asks into a resting bid, gives Yes for USDC", async () => {
    const market = await fx.createMarket({ ticker: Ticker.Msft, strike: 400_000_000 });
    // Maker rests a bid to BUY Yes @ $0.55.
    await makerRestsBid(market, new BN(550_000), ONE.muln(2));

    // Taker must hold Yes to sell: mint 2 pairs (also leaves it 2 No, fine).
    const taker = await fx.newUser(50);
    await fx.mintPairs(taker, market, 2);

    const before = await fx.position(taker.publicKey, market);
    await fx.trade(taker, market, {
      action: TradeAction.SellYes,
      price: new BN(550_000),
      size: ONE.muln(2),
    });
    const after = await fx.position(taker.publicKey, market);

    expect((before.yes - after.yes).toString(), "taker gave up 2 Yes").to.equal(
      ONE.muln(2).toString()
    );
    expect((after.usdc - before.usdc).toString(), "received 2 × $0.55").to.equal(
      (550_000n * 2n).toString()
    );
    await fx.assertCollateralization(market);
  });

  it("Buy No: mint pair + sell the Yes, taker is left holding No", async () => {
    const market = await fx.createMarket({ ticker: Ticker.Googl, strike: 150_000_000 });
    // Buy No @ $0.30 reflects to selling Yes @ $0.70, which crosses a resting bid @ $0.70.
    await makerRestsBid(market, new BN(700_000), ONE.muln(2));

    const taker = await fx.newUser(50);
    const before = await fx.position(taker.publicKey, market);
    const built = await fx.trade(taker, market, {
      action: TradeAction.BuyNo,
      price: new BN(300_000), // No price
      size: ONE.muln(2),
    });
    const after = await fx.position(taker.publicKey, market);

    expect(built.mintPairs, "minted 2 pairs for the Buy No").to.equal(2);
    // Taker keeps 2 No, sold the 2 minted Yes.
    expect((after.no - before.no).toString(), "holds 2 No").to.equal(ONE.muln(2).toString());
    expect(after.yes.toString(), "sold all minted Yes").to.equal("0");
    // Effective No cost = $1.00 − Yes sale ($0.70) = $0.30 each → $0.60 for 2.
    // (Net USDC out = 2×$1.00 minted − 2×$0.70 received = $0.60.)
    expect((before.usdc - after.usdc).toString(), "net No cost $0.60").to.equal(
      (300_000n * 2n).toString()
    );
    await fx.assertCollateralization(market);
  });

  it("Sell No: buy Yes, taker closes No exposure into a redeemable pair", async () => {
    const market = await fx.createMarket({ ticker: Ticker.Amzn, strike: 200_000_000 });
    // Sell No @ $0.40 reflects to buying Yes @ $0.60, crossing a resting ask @ $0.60.
    await makerRestsAsk(market, new BN(600_000), ONE.muln(2));

    // Taker starts holding No (mint a pair, drop the Yes) so Sell No is meaningful.
    const taker = await fx.newUser(50);
    await fx.mintPairs(taker, market, 2);
    // Drop the taker's Yes to the maker so it holds only No going in. The maker already
    // has a Yes ATA (it minted in makerRestsAsk), so no ATA-creation is needed here — and
    // creating one with the maker as payer would wrongly require the maker to sign this
    // taker-signed transaction.
    await sendTx(
      fx.connection,
      taker.keypair,
      [transferToken(fx, taker, maker, yesMint(market), ONE.muln(2))],
      [taker.keypair]
    );

    const before = await fx.position(taker.publicKey, market);
    expect(before.yes.toString(), "starts with 0 Yes").to.equal("0");
    expect(before.no.toString(), "starts with 2 No").to.equal(ONE.muln(2).toString());

    await fx.trade(taker, market, {
      action: TradeAction.SellNo,
      price: new BN(400_000), // No price → buy Yes @ $0.60
      size: ONE.muln(2),
    });
    const after = await fx.position(taker.publicKey, market);

    // Now holds 2 Yes + 2 No = redeemable $2 (No exposure closed).
    expect((after.yes - before.yes).toString(), "bought 2 Yes").to.equal(
      ONE.muln(2).toString()
    );
    expect(after.no.toString(), "still 2 No").to.equal(ONE.muln(2).toString());
    expect((before.usdc - after.usdc).toString(), "paid 2 × $0.60").to.equal(
      (600_000n * 2n).toString()
    );
    await fx.assertCollateralization(market);
  });

  it("Partial fill: a taker order larger than resting liquidity fills part, rests the remainder", async () => {
    const market = await fx.createMarket({ ticker: Ticker.Nvda, strike: 120_000_000 });
    // Only 2 Yes resting on the ask @ $0.50.
    await makerRestsAsk(market, new BN(500_000), ONE.muln(2));

    // Taker bids to buy 5 Yes @ $0.50: 2 fill from the maker, 3 rest as a new bid.
    const taker = await fx.newUser(50);
    const before = await fx.position(taker.publicKey, market);
    await fx.trade(taker, market, {
      action: TradeAction.BuyYes,
      price: new BN(500_000),
      size: ONE.muln(5),
    });
    const after = await fx.position(taker.publicKey, market);

    expect((after.yes - before.yes).toString(), "filled 2 of 5").to.equal(
      ONE.muln(2).toString()
    );
    // Paid $1.00 for the 2 fills; the remaining 3 are escrowed at $0.50 = $1.50 reserved.
    const book = await fetchOrderBook(fx.program, marketAddr(market));
    const restingBid = book!.bids.find((o) => o.active && !o.size.isZero());
    expect(restingBid, "remainder rests as a bid").to.not.equal(undefined);
    expect(restingBid!.size.toString(), "3 Yes still wanted").to.equal(ONE.muln(3).toString());
    // USDC out = $1.00 (fills) + $1.50 (escrowed for the resting bid) = $2.50.
    expect((before.usdc - after.usdc).toString(), "spent $1 filled + $1.50 escrowed").to.equal(
      (500_000n * 5n).toString()
    );
    await fx.assertCollateralization(market);
  });

  it("At-strike boundary: settlement_price == strike → Yes wins", async () => {
    const STRIKE = 250_000_000;
    const market = await fx.createMarket({ ticker: Ticker.Tsla, strike: STRIKE });
    const holder = await fx.newUser(10);
    await fx.mintPairs(holder, market, 1);

    await fx.settleAdmin(market, STRIKE); // exactly at strike
    const acc = await fx.market(market);
    expect(acc.outcome, "at-strike favors Yes").to.equal("yesWins");

    // Winner redeems the Yes for $1; the No pays $0.
    const before = (await fx.position(holder.publicKey, market)).usdc;
    await sendTx(
      fx.connection,
      holder.keypair,
      [
        await redeem(fx.program, {
          user: holder.publicKey,
          market,
          side: RedeemSide.Yes,
          amount: ONE,
          usdcMint: fx.usdcMint,
        }),
      ],
      [holder.keypair]
    );
    const afterUsdc = (await fx.position(holder.publicKey, market)).usdc;
    expect((afterUsdc - before).toString(), "Yes pays $1 at strike").to.equal(
      PAYOFF_UNIT.toString()
    );
    await fx.assertCollateralization(market);
  });
});

// --- helpers ---

function marketAddr(market: MarketId) {
  return marketPda(market.ticker, market.strike, market.tradingDay);
}
function yesMint(market: MarketId) {
  return deriveMarketPdasFromIdentity(market.ticker, market.strike, market.tradingDay)
    .yesMint;
}

/** A raw SPL transfer instruction from one user's ATA to another's, for the given mint. */
function transferToken(
  fx: Fixture,
  from: TestUser,
  to: TestUser,
  mint: ReturnType<typeof yesMint>,
  amount: BN
) {
  // Lazy import to keep the spl-token surface local to this helper.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { createTransferInstruction, getAssociatedTokenAddressSync } = require("@solana/spl-token");
  return createTransferInstruction(
    getAssociatedTokenAddressSync(mint, from.publicKey),
    getAssociatedTokenAddressSync(mint, to.publicKey),
    from.publicKey,
    BigInt(amount.toString())
  );
}

// `PRICE_SCALE` kept imported for readers verifying the reflection math (1.00 − noPrice).
void PRICE_SCALE;
