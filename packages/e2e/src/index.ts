/**
 * Source entry for the convergence harness, so sibling workspace packages can reuse it
 * without re-implementing validator bring-up or the lifecycle/invariant helpers.
 *
 * This package is never built to `dist` — it is consumed via ts-node/ts-mocha from source
 * (see package.json `main`/`exports` pointing here). The harness boots a real
 * `solana-test-validator`, deploys the program upgradeably, and wraps `@meridian/sdk` to
 * drive and assert the on-chain lifecycle; `@meridian/ops` builds its deploy/lifecycle
 * scripts on top of these exact primitives.
 */

export {
  startLocalValidator,
  describeOnValidator,
  validatorAvailable,
  programSoPath,
  programKeypairPath,
  type LocalValidator,
  type StartLocalValidatorOptions,
} from "./localValidator";

export {
  Fixture,
  sendTx,
  ADMIN_OVERRIDE_DELAY_SECONDS,
  PROGRAM_ID,
  getAssociatedTokenAddressSync,
  type TestUser,
  type CreateMarketOptions,
} from "./fixture";

export {
  makerAccountsFor,
  yesSideFor,
  yesPriceFor,
  isNoAction,
} from "./crossing";
