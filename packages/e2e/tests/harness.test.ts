/**
 * Smoke test for the convergence harness itself: a real validator boots, the program is
 * deployed upgradeably, Config exists, a market provisions, and the collateralization
 * invariant holds after a mint. If this passes, the lifecycle/trade/multi-user suites
 * have a sound foundation. Skipped automatically where no local validator can run
 * (see describeOnValidator).
 */

import { expect } from "chai";
import BN from "bn.js";
import { Ticker, PAYOFF_UNIT, fetchConfig } from "@meridian/sdk";
import {
  startLocalValidator,
  describeOnValidator,
  type LocalValidator,
} from "../src/localValidator";
import { Fixture } from "../src/fixture";

describeOnValidator("convergence harness (real validator)", function () {
  // A validator boot + upgradeable deploy is tens of seconds; give the hooks room.
  this.timeout(180_000);

  let validator: LocalValidator;
  let fx: Fixture;

  before(async () => {
    validator = await startLocalValidator();
    fx = await Fixture.bootstrap(validator);
  });

  after(() => {
    validator?.stop();
  });

  it("deploys the program with a ProgramData account", async () => {
    const info = await validator.connection.getAccountInfo(validator.programId);
    expect(info, "program account present").to.not.equal(null);
    expect(info!.executable, "program is executable").to.equal(true);
    const pd = await validator.connection.getAccountInfo(validator.programData);
    expect(pd, "ProgramData present (required by initialize_config)").to.not.equal(null);
  });

  it("initializes Config with the deployer as admin", async () => {
    const config = await fetchConfig(fx.program);
    expect(config, "config initialized").to.not.equal(null);
    expect(config!.admin.toBase58()).to.equal(validator.deployer.publicKey.toBase58());
    expect(config!.usdcMint.toBase58()).to.equal(fx.usdcMint.toBase58());
    expect(config!.paused).to.equal(false);
  });

  it("provisions a market and holds collateralization after a mint", async () => {
    const market = await fx.createMarket({
      ticker: Ticker.Meta,
      strike: 680_000_000,
    });

    // Before any mint: empty vault, zero pairs.
    await fx.assertCollateralization(market);
    expect((await fx.market(market)).pairsMinted.toString()).to.equal("0");

    const user = await fx.newUser(10);
    await fx.mintPairs(user, market, 3);

    const acc = await fx.market(market);
    expect(acc.pairsMinted.toString()).to.equal("3");
    // Vault holds exactly $3.
    expect((await fx.vaultBalance(market)).toString()).to.equal(
      (BigInt(PAYOFF_UNIT.toString()) * 3n).toString()
    );
    await fx.assertCollateralization(market);

    // User holds 3.0 Yes + 3.0 No.
    const pos = await fx.position(user.publicKey, market);
    expect(pos.yes.toString()).to.equal(new BN(PAYOFF_UNIT).muln(3).toString());
    expect(pos.no.toString()).to.equal(new BN(PAYOFF_UNIT).muln(3).toString());
  });
});
