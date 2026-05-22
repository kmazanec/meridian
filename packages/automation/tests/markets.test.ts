/**
 * SdkMarketProvisioner idempotency tests (stub ChainClient).
 *
 * Provisioning must be safe to re-run and safe under a concurrent runner / a
 * confirmation-timeout retry: a `create_strike_market` that reverts MarketAlreadyExists (or
 * an order-book step that reverts "already initialized") is an idempotent no-op, not a hard
 * failure. The real on-chain behavior is covered by the LiteSVM integration test; here we
 * drive the error paths with a stub that the real program can't easily be coerced into.
 */

import { expect } from "chai";
import BN from "bn.js";
import { Keypair, PublicKey, TransactionInstruction } from "@solana/web3.js";
import {
  Ticker,
  Outcome,
  getProgram,
  type MarketAccount,
  type MarketId,
} from "@meridian/sdk";
import { SdkMarketProvisioner } from "../src/markets";
import type { ChainClient } from "../src/chain";

const usdc = new PublicKey(new Uint8Array(32).fill(9));
const wiredBook = new PublicKey(new Uint8Array(32).fill(123));

function marketAccount(orderBook: PublicKey): MarketAccount {
  return {
    ticker: Ticker.Meta,
    strike: new BN(620_000_000),
    tradingDay: new BN(1_716_300_000),
    yesMint: PublicKey.default,
    noMint: PublicKey.default,
    vault: PublicKey.default,
    orderBook,
    pairsMinted: new BN(0),
    winningRedeemed: new BN(0),
    state: "open",
    outcome: Outcome.Unsettled,
    settlementPrice: null,
    settledAt: null,
    bump: 0,
    vaultBump: 0,
    mintAuthorityBump: 0,
  };
}

/** A stub ChainClient with scripted fetch results and a send hook. */
class StubChain implements ChainClient {
  sends = 0;
  constructor(
    private readonly fetchResults: (MarketAccount | null)[],
    private readonly onSend: (n: number) => void = () => {}
  ) {}
  // A real (read-only) program is fine — builders only encode; we never send to it.
  readonly program = getProgram({
    connection: { rpcEndpoint: "http://localhost:8899" },
  } as never);
  readonly keypair = Keypair.generate();
  get payer(): PublicKey {
    return this.keypair.publicKey;
  }
  get connection() {
    return { rpcEndpoint: "stub" } as never;
  }
  async send(_ixs: TransactionInstruction[]): Promise<string> {
    const n = this.sends;
    this.sends++; // count the attempt even if it reverts (mirrors a real send that lands then errors)
    this.onSend(n);
    return "sig";
  }
  async fetchMarket(): Promise<MarketAccount | null> {
    return this.fetchResults.shift() ?? null;
  }
  async listMarkets() {
    return [];
  }
}

const id: MarketId = {
  ticker: Ticker.Meta,
  strike: new BN(620_000_000),
  tradingDay: new BN(1_716_300_000),
};

describe("SdkMarketProvisioner idempotency", () => {
  it("skips create + book when the market already exists with a wired book", async () => {
    // Both fetches return a fully-provisioned market → no sends at all.
    const chain = new StubChain([
      marketAccount(wiredBook),
      marketAccount(wiredBook),
    ]);
    const p = new SdkMarketProvisioner(chain, usdc);
    const r = await p.provisionMarket(id);
    expect(r.created).to.be.false;
    expect(chain.sends).to.equal(0);
  });

  it("treats a MarketAlreadyExists create revert as an idempotent no-op (race)", async () => {
    // Pre-check says absent (a concurrent runner hasn't shown up in our read yet), so we try
    // create — which reverts MarketAlreadyExists. Then the book is found wired → done.
    const chain = new StubChain([null, marketAccount(wiredBook)], (n) => {
      if (n === 0) {
        throw new Error(
          "Transaction failed: Error Code: MarketAlreadyExists. Error Number: 6005."
        );
      }
    });
    const p = new SdkMarketProvisioner(chain, usdc);
    const r = await p.provisionMarket(id);
    // create attempted (revert swallowed) → created=false; book already wired → no further send.
    expect(r.created).to.be.false;
    expect(chain.sends).to.equal(1); // only the create attempt
  });

  it("provisions create + init + grow when nothing exists yet", async () => {
    // absent on pre-check, absent (unwired) after create → init + grow run.
    const chain = new StubChain([null, marketAccount(PublicKey.default)]);
    const p = new SdkMarketProvisioner(chain, usdc);
    const r = await p.provisionMarket(id);
    expect(r.created).to.be.true;
    expect(chain.sends).to.equal(3); // create, init, grow
  });

  it("propagates a non-idempotent error (e.g. unauthorized) instead of swallowing it", async () => {
    const chain = new StubChain(
      [null, marketAccount(PublicKey.default)],
      () => {
        throw new Error("Error Code: Unauthorized. Signer is not the admin");
      }
    );
    const p = new SdkMarketProvisioner(chain, usdc);
    let err: unknown;
    try {
      await p.provisionMarket(id);
    } catch (e) {
      err = e;
    }
    expect((err as Error).message).to.match(/Unauthorized/);
  });
});
