/**
 * Pure contract tests for the create-markets + lifecycle support logic: the strike
 * computation matches the automation morning job, market-id PDA derivation matches the SDK,
 * and the dollar/P&L formatting is correct. The live create→mint→trade→settle→redeem run is
 * exercised against a real validator in repro.test.ts (Chunk 5).
 */

import { expect } from "chai";
import BN from "bn.js";
import { computeStrikes } from "@meridian/automation";
import { Ticker, marketPda, PAYOFF_UNIT } from "@meridian/sdk";
import { baseUnitsToDollars } from "../src/createMarkets";
import { dollars, signedDollars } from "../src/lifecycle";

describe("create-markets strikes (contract)", () => {
  it("derives the same strikes the automation morning job does", () => {
    // META prev close $680 → ±3/6/9% rounded to $10 (the documented example).
    const prevClose = new BN(680).mul(PAYOFF_UNIT);
    const strikes = computeStrikes(prevClose);
    const asDollars = strikes.map((s) => Number(s.div(PAYOFF_UNIT).toString()));
    // ±3% = ±20.4 → 700/660; ±6% = ±40.8 → 720/640; ±9% = ±61.2 → 740/620.
    expect(asDollars).to.deep.equal([620, 640, 660, 700, 720, 740]);
  });

  it("market id PDA derivation is the SDK's (per ticker/strike/day)", () => {
    const strike = new BN(680_000_000);
    const day = new BN(1_700_000_000);
    const a = marketPda(Ticker.Meta, strike, day);
    const b = marketPda(Ticker.Meta, strike, day);
    expect(a.toBase58()).to.equal(b.toBase58());
    // A different strike yields a different market account.
    const c = marketPda(Ticker.Meta, new BN(700_000_000), day);
    expect(c.toBase58()).to.not.equal(a.toBase58());
  });
});

describe("lifecycle formatting (contract)", () => {
  it("formats USDC base units as dollars", () => {
    expect(baseUnitsToDollars(new BN(680_000_000))).to.equal("680");
    expect(baseUnitsToDollars(new BN(214_500_000))).to.equal("214.50");
    expect(dollars(new BN(680_000_001))).to.equal("680.00");
    expect(dollars(new BN(1_400_000))).to.equal("1.40");
  });

  it("formats signed P&L with the right sign and magnitude", () => {
    expect(signedDollars(1_400_000n)).to.equal("+$1.40");
    expect(signedDollars(-1_400_000n)).to.equal("−$1.40");
    expect(signedDollars(0n)).to.equal("+$0.00");
  });
});
