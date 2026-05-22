/**
 * End-to-end integration test against the *real* compiled program in LiteSVM.
 *
 * Proves the two jobs drive the on-chain lifecycle:
 *   1. the morning job creates one market per computed strike (create + order book), and
 *   2. the settlement job settles them via the pull oracle (a `PriceUpdateV2` fixture
 *      injected exactly as the SDK's settlement test does), writing the right outcome.
 *
 * The jobs run through a LiteSVM-backed {@link ChainClient} adapter — the same interface
 * the production `RpcChainClient` implements — so the orchestration code under test is the
 * real thing, not a mock. (LiteSVM has no `getProgramAccounts`, so the adapter's
 * `listMarkets` scans the addresses the test provisioned; production uses real RPC.)
 */

import { expect } from "chai";
import BN from "bn.js";
import {
  Connection,
  Keypair,
  PublicKey,
  TransactionInstruction,
} from "@solana/web3.js";
import {
  Ticker,
  Outcome,
  marketPda,
  buildPriceUpdateV2,
  PYTH_RECEIVER_PROGRAM_ID,
  settleMarket,
  type MarketAccount,
  type MarketId,
} from "@meridian/sdk";
// The SDK's LiteSVM harness is a test helper (not part of the package's public export map);
// import it by relative path from the sibling package in this workspace.
import { Harness } from "../../sdk/tests/harness";
import { runMorningJob } from "../src/morningJob";
import { runSettlementJob, SettleStatus, type Settler } from "../src/settlementJob";
import { SdkMarketProvisioner } from "../src/markets";
import { MockPriceSource } from "../src/priceSource";
import { createLogger } from "../src/logger";
import { LogAlerter } from "../src/alerter";
import type { ChainClient } from "../src/chain";

/** A ChainClient backed by the SDK's LiteSVM harness. */
class LiteSvmChainClient implements ChainClient {
  /** Markets provisioned through this client (LiteSVM has no getProgramAccounts). */
  readonly knownMarkets: PublicKey[] = [];

  constructor(private readonly h: Harness) {}

  get program() {
    return this.h.program;
  }
  get payer(): PublicKey {
    return this.h.admin.publicKey;
  }
  get keypair(): Keypair {
    return this.h.admin;
  }
  // Not used in-process (settlement is injected); present to satisfy the interface.
  get connection(): Connection {
    return { rpcEndpoint: "litesvm://in-process" } as Connection;
  }

  async send(
    instructions: TransactionInstruction[],
    extraSigners: Keypair[] = []
  ): Promise<string> {
    // Track any market this create touches so listMarkets can find it later.
    this.h.send(instructions, [this.h.admin, ...extraSigners]);
    return "litesvm-signature";
  }

  async fetchMarket(address: PublicKey): Promise<MarketAccount | null> {
    if (!this.h.exists(address)) return null;
    return decodeMarket(this.h, address);
  }

  async listMarkets(): Promise<
    { address: PublicKey; account: MarketAccount }[]
  > {
    const out: { address: PublicKey; account: MarketAccount }[] = [];
    for (const address of this.knownMarkets) {
      const account = await this.fetchMarket(address);
      if (account) out.push({ address, account });
    }
    return out;
  }
}

/** Decode a Market from LiteSVM bytes and normalize it like the SDK's `fetchMarket`. */
function decodeMarket(h: Harness, address: PublicKey): MarketAccount {
  const raw = h.decode<Record<string, unknown>>("market", address);
  const enumKey = (e: unknown) => Object.keys(e as object)[0] ?? "";
  const outcome =
    enumKey(raw.outcome) === "yesWins"
      ? Outcome.YesWins
      : enumKey(raw.outcome) === "noWins"
        ? Outcome.NoWins
        : Outcome.Unsettled;
  return {
    ticker: raw.ticker as Ticker, // not used by the assertions below
    strike: raw.strike as BN,
    tradingDay: raw.tradingDay as BN,
    yesMint: raw.yesMint as PublicKey,
    noMint: raw.noMint as PublicKey,
    vault: raw.vault as PublicKey,
    orderBook: raw.orderBook as PublicKey,
    pairsMinted: raw.pairsMinted as BN,
    winningRedeemed: raw.winningRedeemed as BN,
    state: enumKey(raw.state) === "settled" ? "settled" : "open",
    outcome,
    settlementPrice: (raw.settlementPrice as BN | null) ?? null,
    settledAt: (raw.settledAt as BN | null) ?? null,
    bump: raw.bump as number,
    vaultBump: raw.vaultBump as number,
    mintAuthorityBump: raw.mintAuthorityBump as number,
  };
}

describe("automation integration (LiteSVM, real program)", () => {
  let h: Harness;
  let usdc: PublicKey;
  let chain: LiteSvmChainClient;
  const day = new BN(1_716_300_000);

  before(async () => {
    h = Harness.create();
    usdc = h.ensureUsdc();
    await h.seedConfig(usdc);
    chain = new LiteSvmChainClient(h);
  });

  it("morning job creates one market per strike", async () => {
    const logger = createLogger({ sink: () => {} });
    const alerter = new LogAlerter(logger);
    // META $680 → 6 strikes. Track each market address so listMarkets finds them.
    const provisioner = new SdkMarketProvisioner(chain, usdc);

    const summary = await runMorningJob({
      tickers: [Ticker.Meta],
      priceSource: new MockPriceSource({
        [Ticker.Meta]: new BN(680).mul(new BN(1_000_000)),
      }),
      provisioner: {
        provisionMarket: async (m: MarketId) => {
          const r = await provisioner.provisionMarket(m);
          chain.knownMarkets.push(
            marketPda(m.ticker, m.strike, m.tradingDay)
          );
          return r;
        },
      },
      alerter,
      logger,
      tradingDay: day.toNumber(),
      includeClose: false,
      retries: 0,
    });

    expect(summary.created).to.equal(6);
    expect(summary.failed).to.equal(0);
    // Every market exists on-chain and is Open with its book wired.
    for (const address of chain.knownMarkets) {
      const m = await chain.fetchMarket(address);
      expect(m, `market ${address.toBase58()} exists`).to.not.be.null;
      expect(m!.state).to.equal("open");
      expect(m!.orderBook.equals(PublicKey.default)).to.be.false;
    }
  });

  it("settlement job settles each market with the right outcome", async () => {
    // Past the close so settle_market is allowed.
    h.setUnixTimestamp(day.toNumber() + 1);

    // Inject a settler that posts a PriceUpdateV2 fixture and cranks settle_market for the
    // market's strike. Price $700 → strikes <= 700 are YesWins, > 700 are NoWins.
    const settler: Settler = {
      settle: async (m) => {
        const priceNative = BigInt(700_00000000); // $700 at expo -8
        const data = buildPriceUpdateV2({
          feedId: Harness.feedId(Ticker.Meta),
          price: priceNative,
          conf: BigInt(10_000000), // tight band, within MAX_CONFIDENCE_BPS
          exponent: -8,
          publishTime: BigInt(day.toNumber() + 1),
          fullVerification: true,
        });
        const priceUpdate = h.setPriceUpdateAccount(
          PYTH_RECEIVER_PROGRAM_ID,
          data
        );
        const ix = await settleMarket(h.program, {
          cranker: h.admin.publicKey,
          market: {
            ticker: Ticker.Meta,
            strike: m.account.strike,
            tradingDay: m.account.tradingDay,
          },
          priceUpdate,
        });
        try {
          h.send([ix], [h.admin]);
          return { status: SettleStatus.Settled };
        } catch (err) {
          return {
            status: SettleStatus.Error,
            error: err instanceof Error ? err.message : String(err),
          };
        }
      },
    };

    const logger = createLogger({ sink: () => {} });
    const summary = await runSettlementJob({
      discovery: { listMarkets: () => chain.listMarkets() },
      settler,
      alerter: new LogAlerter(logger),
      logger,
      nowSeconds: () => day.toNumber() + 1,
    });

    expect(summary.settled).to.equal(6);
    expect(summary.alerted).to.equal(0);

    // Verify each market settled with the expected outcome vs the $700 settlement price.
    const settlementPrice = new BN(700_000000); // $700 in 6dp base units
    for (const address of chain.knownMarkets) {
      const m = await chain.fetchMarket(address);
      expect(m!.state).to.equal("settled");
      const expected = m!.strike.lte(settlementPrice)
        ? Outcome.YesWins
        : Outcome.NoWins;
      expect(m!.outcome, `outcome for strike ${m!.strike.toString()}`).to.equal(
        expected
      );
    }
  });

  it("settlement job is idempotent: a re-run skips the already-settled markets", async () => {
    const logger = createLogger({ sink: () => {} });
    let settleCalls = 0;
    const summary = await runSettlementJob({
      discovery: { listMarkets: () => chain.listMarkets() },
      settler: {
        settle: async () => {
          settleCalls++;
          return { status: SettleStatus.Settled };
        },
      },
      alerter: new LogAlerter(logger),
      logger,
      nowSeconds: () => day.toNumber() + 1,
    });
    expect(settleCalls).to.equal(0); // all already settled → settler never called
    expect(summary.skipped).to.equal(6);
    expect(summary.settled).to.equal(0);
  });
});
