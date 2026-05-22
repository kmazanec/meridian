// @vitest-environment node
// Builds real intents (which derive ATAs); needs Node's crypto/curve path, not jsdom.
import { describe, it, expect } from "vitest";
import BN from "bn.js";
import { Keypair, Connection } from "@solana/web3.js";
import {
  buildTradeIntent,
  getProgram,
  TradeAction,
  Ticker,
} from "@meridian/sdk";
import { yesSideFor } from "./tradeForm";

/**
 * Anti-drift contract test: the frontend's `yesSideFor` mirror MUST agree with the SDK's
 * own `buildTradeIntent` about which Yes-book side each action lands on. If the SDK ever
 * changes that mapping, this fails — so the maker-account computation (which uses
 * `yesSideFor`) can't silently feed wrong `remaining_accounts` to `place_order`.
 */
describe("yesSideFor agrees with the SDK's buildTradeIntent.bookSide", () => {
  // A connection-only provider is enough for the Anchor client to *build* instructions.
  const program = getProgram({
    connection: new Connection("http://127.0.0.1:8899"),
    publicKey: Keypair.generate().publicKey,
  } as never);
  const user = Keypair.generate().publicKey;
  const usdcMint = Keypair.generate().publicKey;
  const market = { ticker: Ticker.Meta, strike: 680_000_000, tradingDay: 1 };

  for (const action of [
    TradeAction.BuyYes,
    TradeAction.SellYes,
    TradeAction.BuyNo,
    TradeAction.SellNo,
  ]) {
    it(`${action}`, async () => {
      const built = await buildTradeIntent(program, user, {
        market,
        action,
        // Use a mid price so the No-reflection (1 − p) is in range for No actions.
        price: new BN(500_000),
        size: new BN(1_000_000),
        usdcMint,
      });
      expect(yesSideFor(action)).toBe(built.bookSide);
    });
  }
});
