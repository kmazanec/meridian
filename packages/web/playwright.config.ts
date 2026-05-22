import { defineConfig, devices } from "@playwright/test";

/**
 * E2E config. `globalSetup` boots a local validator + deploys the program + seeds
 * markets + funds a test wallet (see e2e/setup), then the Next dev server runs in e2e
 * mode (`NEXT_PUBLIC_E2E=1`) pointed at the local RPC. The spec drives a real Chromium
 * through connect → the four trade paths → settle → redeem against the running program.
 *
 * Heavy and environment-dependent (needs solana-test-validator + a built program .so).
 * Run locally with `yarn workspace @meridian/web test:e2e`. It is opt-in in CI behind
 * the build-program artifact.
 */
const PORT = 3100;

export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.e2e.ts",
  globalSetup: "./e2e/setup/global-setup.ts",
  globalTeardown: "./e2e/setup/global-teardown.ts",
  timeout: 120_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    // Production build would be more faithful, but dev start is faster and fine here;
    // the env wires the app to the local validator + the injected e2e wallet.
    command: `NEXT_PUBLIC_E2E=1 NEXT_PUBLIC_RPC_URL=http://127.0.0.1:8899 NEXT_PUBLIC_CLUSTER=localnet yarn next dev -p ${PORT}`,
    url: `http://127.0.0.1:${PORT}`,
    timeout: 120_000,
    reuseExistingServer: false,
  },
});
