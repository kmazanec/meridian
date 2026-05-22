/**
 * Automation jobs against the real validator (AC#6, AC#5).
 *
 * Proves the off-chain orchestration wires to chain for real — not just LiteSVM. The
 * morning job computes strikes from a (mock) previous close and provisions each market
 * through the production `SdkMarketProvisioner` + `RpcChainClient`; the settlement job
 * discovers those markets via `program.account.market.all()` (real getProgramAccounts)
 * and settles the due ones through an injected settler. This is the program ↔ SDK ↔
 * automation interface, exercised end-to-end.
 *
 * The settler here uses the admin override (the local validator has no Pyth Receiver
 * deployed); the genuine Hermes→Receiver→settle_market path is the opt-in devnet smoke
 * test. The orchestration under test — discovery, due-gating, idempotence, retry/alert
 * wiring — is identical regardless of which settler backs it.
 */

import { expect } from "chai";
import BN from "bn.js";
import { Keypair, PublicKey } from "@solana/web3.js";
import { Ticker, adminSettle, type MarketAccount } from "@meridian/sdk";
import {
  RpcChainClient,
  SdkMarketProvisioner,
  SdkMarketDiscovery,
  MockPriceSource,
  computeStrikes,
  runMorningJob,
  runSettlementJob,
  SettleStatus,
  createLogger,
  LogAlerter,
  type Settler,
  type LogLine,
} from "@meridian/automation";
import {
  startLocalValidator,
  describeOnValidator,
  type LocalValidator,
} from "../src/localValidator";
import { Fixture, sendTx } from "../src/fixture";

describeOnValidator("automation jobs against a real validator", function () {
  this.timeout(180_000);

  let validator: LocalValidator;
  let fx: Fixture;

  before(async () => {
    validator = await startLocalValidator();
    fx = await Fixture.bootstrap(validator);
  });

  after(() => validator?.stop());

  it("morning job provisions the day's strikes; settlement job settles the due ones", async () => {
    // The automation service signs as the admin (deployer) via a real RpcChainClient.
    const chain = new RpcChainClient(fx.connection, fx.admin);
    const lines: LogLine[] = [];
    const logger = createLogger({ sink: (l) => lines.push(l) });
    const alerter = new LogAlerter(logger);

    // Past-dated close so the settlement job's admin-override settler is callable now.
    // runMorningJob trusts an explicit tradingDay (skips the no-session calendar guard).
    const tradingDay = Math.floor(Date.now() / 1000) - 2 * 3600;

    // META previous close $680 → strikes ±3/6/9% rounded to $10, deduped.
    const prevClose = new BN(680_000_000);
    const expectedStrikes = computeStrikes(prevClose);
    expect(expectedStrikes.length, "META yields 6 unique strikes").to.equal(6);

    const priceSource = new MockPriceSource({ [Ticker.Meta]: prevClose });
    const provisioner = new SdkMarketProvisioner(chain, fx.usdcMint);

    // ── morning job ──────────────────────────────────────────────────────────
    const morning = await runMorningJob({
      tickers: [Ticker.Meta],
      priceSource,
      provisioner,
      alerter,
      logger,
      tradingDay,
    });
    expect(morning.skipped, "not skipped (explicit tradingDay)").to.equal(
      false
    );
    expect(morning.failed, "no provisioning failures").to.equal(0);
    expect(morning.created, "created one market per computed strike").to.equal(
      expectedStrikes.length
    );

    // Discovery (real getProgramAccounts) finds exactly the provisioned markets.
    const discovery = new SdkMarketDiscovery(chain);
    const discovered = await discovery.listMarkets();
    expect(discovered.length, "all strikes discoverable on-chain").to.equal(
      expectedStrikes.length
    );
    for (const m of discovered) {
      expect(m.account.state).to.equal("open");
      expect(m.account.tradingDay.toString()).to.equal(String(tradingDay));
    }

    // Morning job is idempotent on-chain: a second run re-provisions the same strikes
    // without error and adds NO new markets. (summary.created counts successful
    // provisions, not net-new markets — so it stays 6; the on-chain set is what must
    // be unchanged.)
    const morningAgain = await runMorningJob({
      tickers: [Ticker.Meta],
      priceSource,
      provisioner,
      alerter,
      logger,
      tradingDay,
    });
    expect(morningAgain.failed, "idempotent re-run has no failures").to.equal(
      0
    );
    const afterRerun = await discovery.listMarkets();
    expect(afterRerun.length, "no duplicate markets created").to.equal(
      expectedStrikes.length
    );

    // ── settlement job ───────────────────────────────────────────────────────
    // An admin-override settler (the validator has no Pyth Receiver). It settles each
    // due market Yes-wins via the SDK's adminSettle, signed by the automation keypair.
    const settler: Settler = {
      async settle(market: { address: PublicKey; account: MarketAccount }) {
        try {
          await sendTx(
            fx.connection,
            fx.admin,
            [
              await adminSettle(fx.program, {
                admin: fx.admin.publicKey,
                market: market.address,
                settlementPrice: market.account.strike.addn(1), // ≥ strike → Yes wins
              }),
            ],
            [fx.admin]
          );
          return { status: SettleStatus.Settled };
        } catch (e) {
          return { status: SettleStatus.Error, error: (e as Error).message };
        }
      },
    };

    const settlement = await runSettlementJob({
      discovery,
      settler,
      alerter,
      logger,
      nowSeconds: () => Math.floor(Date.now() / 1000),
    });
    expect(settlement.settled, "all due markets settled").to.equal(
      expectedStrikes.length
    );
    expect(settlement.notDue, "none in the future").to.equal(0);
    expect(settlement.alerted, "no operator alerts").to.equal(0);

    // On-chain: every market is now settled Yes-wins.
    const afterSettle = await discovery.listMarkets();
    for (const m of afterSettle) {
      expect(m.account.state, "settled on-chain").to.equal("settled");
      expect(m.account.outcome).to.equal("yesWins");
    }

    // Settlement job is idempotent: a second run settles nothing new, skips the rest.
    const settlementAgain = await runSettlementJob({
      discovery,
      settler,
      alerter,
      logger,
      nowSeconds: () => Math.floor(Date.now() / 1000),
    });
    expect(settlementAgain.settled, "re-run settles nothing new").to.equal(0);
    expect(settlementAgain.skipped, "all already settled").to.equal(
      expectedStrikes.length
    );
  });
});

// Keep Keypair imported for readers comparing the automation signer wiring; the
// RpcChainClient owns the keypair internally here (fx.admin).
void Keypair;
