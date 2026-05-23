import { expect } from "chai";
import BN from "bn.js";
import { OrderSide, PRICE_SCALE, TradeAction } from "@meridian/sdk";
import { yesLeg } from "../src/tools/placeOrder";

describe("yesLeg (action → Yes-book side+price)", () => {
  const p = new BN(620_000); // 0.62 in this action's own perspective

  it("BUY_YES is a Yes bid at the Yes price", () => {
    const { side, yesPrice } = yesLeg(TradeAction.BuyYes, p);
    expect(side).to.equal(OrderSide.Bid);
    expect(yesPrice.eq(p)).to.equal(true);
  });

  it("SELL_YES is a Yes ask at the Yes price", () => {
    const { side, yesPrice } = yesLeg(TradeAction.SellYes, p);
    expect(side).to.equal(OrderSide.Ask);
    expect(yesPrice.eq(p)).to.equal(true);
  });

  it("BUY_NO reflects to a Yes ask at 1 - noPrice", () => {
    const { side, yesPrice } = yesLeg(TradeAction.BuyNo, p);
    expect(side).to.equal(OrderSide.Ask);
    expect(yesPrice.eq(PRICE_SCALE.sub(p))).to.equal(true); // 0.38
  });

  it("SELL_NO reflects to a Yes bid at 1 - noPrice", () => {
    const { side, yesPrice } = yesLeg(TradeAction.SellNo, p);
    expect(side).to.equal(OrderSide.Bid);
    expect(yesPrice.eq(PRICE_SCALE.sub(p))).to.equal(true); // 0.38
  });
});
