import { describe, it, expect } from "vitest";
import BN from "bn.js";
import { TradeAction } from "@meridian/sdk";
import { checkPositionConstraint } from "./positionGuard";

const holdingNo = { yes: new BN(0), no: new BN(1_000_000) };
const holdingYes = { yes: new BN(1_000_000), no: new BN(0) };
const flat = { yes: new BN(0), no: new BN(0) };

describe("checkPositionConstraint (ADR-006, client-side only)", () => {
  it("blocks Buy Yes while holding No, suggesting Sell No to exit", () => {
    const r = checkPositionConstraint(TradeAction.BuyYes, holdingNo);
    expect(r.blocked).toBe(true);
    expect(r.exitAction).toBe(TradeAction.SellNo);
    expect(r.message).toMatch(/close your no position/i);
  });

  it("blocks Buy No while holding Yes, suggesting Sell Yes to exit", () => {
    const r = checkPositionConstraint(TradeAction.BuyNo, holdingYes);
    expect(r.blocked).toBe(true);
    expect(r.exitAction).toBe(TradeAction.SellYes);
  });

  it("allows selling either side (reducing exposure)", () => {
    expect(checkPositionConstraint(TradeAction.SellNo, holdingNo).blocked).toBe(
      false
    );
    expect(
      checkPositionConstraint(TradeAction.SellYes, holdingYes).blocked
    ).toBe(false);
  });

  it("allows buying a side when flat or already holding that side", () => {
    expect(checkPositionConstraint(TradeAction.BuyYes, flat).blocked).toBe(
      false
    );
    expect(
      checkPositionConstraint(TradeAction.BuyYes, holdingYes).blocked
    ).toBe(false);
  });

  it("does not block when position is unknown (not yet loaded)", () => {
    expect(checkPositionConstraint(TradeAction.BuyYes, null).blocked).toBe(
      false
    );
  });
});
