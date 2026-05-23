import { expect } from "chai";
import BN from "bn.js";
import { PublicKey } from "@solana/web3.js";
import type { MeridianProgram } from "@meridian/sdk";
import { discoverOpenMarkets, MARKETS_TTL_MS } from "../src/context";

/**
 * A fake program whose `account.market.all()` counts calls, so we can assert the cache
 * collapses a tick's many lookups into a single getProgramAccounts scan.
 */
function fakeProgram(): { program: MeridianProgram; calls: () => number } {
  let calls = 0;
  const one = {
    publicKey: PublicKey.default,
    account: {
      ticker: { meta: {} },
      strike: new BN(680_000_000),
      tradingDay: new BN(1_700_000_000),
      state: { open: {} },
    },
  };
  const program = {
    account: {
      market: {
        all: async () => {
          calls += 1;
          return [one];
        },
      },
    },
  } as unknown as MeridianProgram;
  return { program, calls: () => calls };
}

describe("discoverOpenMarkets caching", () => {
  it("coalesces concurrent scans within a tick into one RPC call", async () => {
    const { program, calls } = fakeProgram();
    // Fire several lookups at once, as the tools do during a single tick.
    const results = await Promise.all([
      discoverOpenMarkets(program),
      discoverOpenMarkets(program),
      discoverOpenMarkets(program),
    ]);
    expect(calls()).to.equal(1);
    for (const r of results) expect(r).to.have.length(1);
    expect(results[0][0].symbol).to.equal("META");
  });

  it("reuses the cached value on repeat calls within the TTL", async () => {
    const { program, calls } = fakeProgram();
    await discoverOpenMarkets(program);
    await discoverOpenMarkets(program);
    expect(calls()).to.equal(1);
  });

  it("force:true bypasses the cache", async () => {
    const { program, calls } = fakeProgram();
    await discoverOpenMarkets(program);
    await discoverOpenMarkets(program, { force: true });
    expect(calls()).to.equal(2);
  });

  it("does not share a cache across different programs", async () => {
    const a = fakeProgram();
    const b = fakeProgram();
    await discoverOpenMarkets(a.program);
    await discoverOpenMarkets(b.program);
    expect(a.calls()).to.equal(1);
    expect(b.calls()).to.equal(1);
  });

  it("exposes a sane TTL", () => {
    expect(MARKETS_TTL_MS).to.be.greaterThan(0);
  });
});
