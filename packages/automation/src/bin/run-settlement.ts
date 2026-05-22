#!/usr/bin/env node
/**
 * CLI entrypoint: the settlement job (settle the day's open contracts after the close).
 *
 * Reads all inputs from the environment, builds the runtime, and runs the settlement job
 * once. Uses the on-chain clock — the wide-confidence retry loop honors real time, so a
 * single invocation may run for up to the retry window before returning. Exits non-zero if
 * any market needed an operator alert (so a scheduler surfaces it). No resident scheduler.
 *
 * `nowSeconds` is the local unix clock; it gates which markets are due (>= trading_day).
 * The program independently enforces timing, so a slightly skewed local clock at worst
 * defers a market to the next run — it can never settle one early.
 */

import { loadConfig } from "../config";
import { buildRuntime, settlementDeps } from "../runtime";
import { runSettlementJob } from "../settlementJob";

async function main(): Promise<number> {
  const config = loadConfig();
  const rt = buildRuntime(config);
  const summary = await runSettlementJob({
    ...settlementDeps(rt),
    nowSeconds: () => Math.floor(Date.now() / 1000),
  });
  return summary.alerted > 0 ? 1 : 0;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error(
      JSON.stringify({
        level: "error",
        msg: "settlement job crashed",
        error: err instanceof Error ? err.message : String(err),
      })
    );
    process.exit(1);
  });
