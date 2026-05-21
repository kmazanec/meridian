import { expect } from "chai";
import { MERIDIAN_IDL } from "../src/idl";
import { PROGRAM_ID, getProgram } from "../src/program";
import type { Provider } from "@anchor-lang/core";
import {
  NUM_TICKERS,
  ORDERBOOK_N,
  PAYOFF_UNIT,
  PRICE_SCALE,
  TOKEN_DECIMALS,
  USDC_DECIMALS,
} from "../src/constants";

// The frozen program id (constants.rs / Anchor.toml). If the vendored IDL ever
// drifts from the deployed program, these assertions are the first tripwire.
const EXPECTED_PROGRAM_ID = "9R3jRbvh9jeQLGEggB3VXQTwj88YjUKqKM8x75SefGen";

describe("IDL plumbing", () => {
  it("loads the vendored IDL with the expected program id", () => {
    expect(MERIDIAN_IDL.address).to.equal(EXPECTED_PROGRAM_ID);
    expect(PROGRAM_ID.toBase58()).to.equal(EXPECTED_PROGRAM_ID);
  });

  it("builds a typed Program exposing every instruction as a camelCase method", () => {
    // A connection-only provider is enough to instantiate the client and inspect
    // its method/account surface (no network call is made here).
    const provider = {
      connection: { rpcEndpoint: "http://localhost:8899" },
    } as unknown as Provider;
    const program = getProgram(provider);

    const methods = Object.keys(program.methods).sort();
    // The full instruction set the SDK must wrap (camelCase as the Anchor client emits).
    expect(methods).to.deep.equal(
      [
        "addStrike",
        "adminSettle",
        "cancelOrder",
        "createStrikeMarket",
        "growOrderBook",
        "initOrderBook",
        "initializeConfig",
        "matchOrders",
        "mintPair",
        "pause",
        "placeOrder",
        "redeem",
        "settleMarket",
        "unpause",
      ].sort()
    );

    // The account namespace the read helpers will fetch through.
    expect(Object.keys(program.account).sort()).to.deep.equal(
      ["config", "market", "orderBook"].sort()
    );
  });

  it("re-exports the frozen unit constants verbatim from the IDL", () => {
    expect(PAYOFF_UNIT.toString()).to.equal("1000000");
    expect(PRICE_SCALE.toString()).to.equal("1000000");
    expect(TOKEN_DECIMALS).to.equal(6);
    expect(USDC_DECIMALS).to.equal(6);
  });

  it("keeps PAYOFF_UNIT and PRICE_SCALE in lockstep (Yes+No=$1.00 contract)", () => {
    expect(PAYOFF_UNIT.eq(PRICE_SCALE)).to.equal(true);
  });

  it("freezes the ticker count and book capacity contract", () => {
    expect(NUM_TICKERS).to.equal(7);
    expect(ORDERBOOK_N).to.equal(128);
  });
});
