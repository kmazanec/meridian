import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

/**
 * Playwright global setup. Runs the localnet provisioner as a **separate Node process**
 * (`node localnet.mjs`) rather than importing it: that script uses `@meridian/sdk`'s
 * built package + Node ESM, which must resolve outside Playwright's TS/alias loader. It
 * boots the validator (detached), deploys the program, seeds Config + markets + a funded
 * wallet, and writes `e2e/.localnet.json` (addresses, the test wallet secret, the
 * validator PID) which the spec and teardown read.
 */
export default function globalSetup() {
  // eslint-disable-next-line no-console
  console.log("[e2e] provisioning local validator + program…");
  const script = resolve(__dirname, "localnet.mjs");
  execFileSync("node", [script], {
    stdio: "inherit",
    env: process.env,
  });
  // eslint-disable-next-line no-console
  console.log("[e2e] localnet ready");
}
