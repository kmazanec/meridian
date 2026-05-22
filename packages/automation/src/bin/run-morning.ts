#!/usr/bin/env node
/**
 * CLI entrypoint: the morning job (create the day's markets).
 *
 * Reads all inputs from the environment (see `config.ts` / `ENV_KEYS`), builds the runtime,
 * and runs the morning job once. Exits non-zero if the run is skipped-with-failures or
 * throws — so an external scheduler (cron / systemd timer / CI schedule, per the CLI-only
 * scheduling decision) can detect a failed run. There is no resident scheduler here.
 */

import { loadConfig } from "../config";
import { buildRuntime, morningDeps } from "../runtime";
import { runMorningJob } from "../morningJob";

async function main(): Promise<number> {
  const config = loadConfig();
  const rt = buildRuntime(config);
  const summary = await runMorningJob(morningDeps(rt));
  if (summary.skipped) {
    rt.logger.info("morning job skipped (no session)");
    return 0;
  }
  // Surface a failed run to the scheduler via the exit code, even though individual
  // failures were already alerted.
  return summary.failed > 0 ? 1 : 0;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error(
      JSON.stringify({
        level: "error",
        msg: "morning job crashed",
        error: err instanceof Error ? err.message : String(err),
      })
    );
    process.exit(1);
  });
