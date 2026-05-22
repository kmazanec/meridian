/**
 * Import-surface smoke test: the package barrel loads, and the @meridian/sdk workspace
 * dependency resolves from inside this package (so the chain-calling layer is wired).
 */

import { expect } from "chai";
import * as automation from "../src/index";
import { PROGRAM_ID, PAYOFF_UNIT } from "@meridian/sdk";

describe("@meridian/automation surface", () => {
  it("exposes the package version marker", () => {
    expect(automation.VERSION).to.be.a("string");
  });

  it("resolves the @meridian/sdk workspace dependency", () => {
    // PROGRAM_ID and PAYOFF_UNIT come from the SDK; importing them here proves the
    // workspace link is in place and the units contract is reachable from automation.
    expect(PROGRAM_ID.toBase58()).to.be.a("string").with.length.greaterThan(0);
    expect(PAYOFF_UNIT.toString()).to.equal("1000000");
  });
});
