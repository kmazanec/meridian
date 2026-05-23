import { expect } from "chai";
import BN from "bn.js";
import {
  unitsToAmount,
  amountToUnits,
  priceToProb,
  probToPrice,
  round,
} from "../src/format";

describe("format conversions", () => {
  it("round-trips token amounts through base units", () => {
    expect(unitsToAmount(new BN(1_500_000))).to.equal(1.5);
    expect(amountToUnits(1.5).toString()).to.equal("1500000");
    expect(amountToUnits(10).toString()).to.equal("10000000");
  });

  it("maps prices to probabilities and back", () => {
    expect(priceToProb(new BN(620_000))).to.be.closeTo(0.62, 1e-9);
    expect(probToPrice(0.62).toString()).to.equal("620000");
  });

  it("clamps probabilities into [0,1] when building a price", () => {
    expect(probToPrice(1.7).toString()).to.equal("1000000");
    expect(probToPrice(-0.3).toString()).to.equal("0");
  });

  it("rejects negative amounts", () => {
    expect(() => amountToUnits(-1)).to.throw(/non-negative/);
  });

  it("rounds to the requested places", () => {
    expect(round(0.123456, 4)).to.equal(0.1235);
    expect(round(0.5)).to.equal(0.5);
  });
});
