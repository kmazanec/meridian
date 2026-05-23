#!/usr/bin/env node
/**
 * Entry point for a single bot: `meridian-run-bot <name>`.
 *
 * Loads the fleet config + environment, resolves the named bot, and runs its loop until
 * the process receives SIGINT/SIGTERM (the Makefile spawns one of these per bot and tracks
 * the PID). All output goes to stdout, which the Makefile redirects to `logs/<name>.log`.
 *
 * A custom fleet path can be given via FLEET_CONFIG; otherwise the package's
 * bots.config.json is used.
 */

import { loadEnvironment, loadFleet, resolveBot } from "../config";
import { runBot } from "../runner";

async function main(): Promise<void> {
  const name = process.argv[2];
  if (!name) {
    // eslint-disable-next-line no-console
    console.error("usage: meridian-run-bot <bot-name>");
    process.exit(2);
  }

  const env = loadEnvironment();
  const fleet = loadFleet(process.env.FLEET_CONFIG);
  const bot = resolveBot(fleet, name);

  const controller = new AbortController();
  const stop = (sig: string) => () => {
    // eslint-disable-next-line no-console
    console.error(`\n[${name}] received ${sig}, shutting down…`);
    controller.abort();
  };
  process.on("SIGINT", stop("SIGINT"));
  process.on("SIGTERM", stop("SIGTERM"));

  await runBot(bot, env, controller.signal);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err instanceof Error ? err.stack ?? err.message : String(err));
  process.exit(1);
});
