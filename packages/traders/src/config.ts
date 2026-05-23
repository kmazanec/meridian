/**
 * Configuration for the bot fleet.
 *
 * Two layers:
 *   - **The fleet file** (`bots.config.json`): the list of bots, each with a name, a
 *     wallet path, an OpenRouter model id, and an optional cadence + persona. This file
 *     names wallet paths, so it is gitignored; `bots.config.example.json` is the template.
 *   - **The environment**: cluster + secrets shared by all bots — `RPC_URL`,
 *     `OPENROUTER_API_KEY`, an optional `USDC_MINT` override (otherwise read from on-chain
 *     Config), the `WEB_BASE_URL` the price-history tool calls, and an optional Hermes URL.
 *
 * Everything is validated up front with zod so a typo fails loudly at startup rather than
 * deep inside a trading loop.
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";

/** One bot's static configuration. */
export const BotConfigSchema = z.object({
  /** Stable, log-friendly identifier; also the log file name. */
  name: z
    .string()
    .min(1)
    .regex(
      /^[A-Za-z0-9._-]+$/,
      "name must be filename-safe (letters, digits, . _ -)"
    ),
  /** Path to the trader's Solana CLI keypair file (~ is expanded). */
  wallet: z.string().min(1),
  /** OpenRouter model id, e.g. "anthropic/claude-3.5-sonnet", "openai/gpt-4o". */
  model: z.string().min(1),
  /** Seconds between trading ticks. Default 60. */
  intervalSec: z.number().int().positive().default(60),
  /** Optional flavor injected into the system prompt to differentiate strategies. */
  persona: z.string().optional(),
});
export type BotConfig = z.infer<typeof BotConfigSchema>;

export const FleetConfigSchema = z.object({
  bots: z.array(BotConfigSchema).min(1),
});
export type FleetConfig = z.infer<typeof FleetConfigSchema>;

/** Cluster + secrets shared by every bot, read from the environment. */
export interface Environment {
  rpcUrl: string;
  openRouterApiKey: string;
  /** Explicit USDC mint; when absent, resolved from on-chain Config at runtime. */
  usdcMint?: string;
  /** Base URL of the web app, for the /api/history price-history tool. */
  webBaseUrl?: string;
  /** Pyth Hermes endpoint for spot prices (defaults to the public endpoint in the tool). */
  hermesUrl?: string;
  /** When true, the place-order tool logs the intended trade but does not send it. */
  dryRun: boolean;
}

/** The default fleet file location, relative to the package root. */
export const DEFAULT_FLEET_PATH = resolve(__dirname, "..", "bots.config.json");

/** Load + validate the fleet file (default `bots.config.json`). */
export function loadFleet(path: string = DEFAULT_FLEET_PATH): FleetConfig {
  if (!existsSync(path)) {
    throw new Error(
      `Fleet config not found at ${path}. Copy bots.config.example.json to ` +
        `bots.config.json and edit it.`
    );
  }
  let json: unknown;
  try {
    json = JSON.parse(readFileSync(path, "utf8"));
  } catch (err) {
    throw new Error(
      `Fleet config ${path} is not valid JSON: ${
        err instanceof Error ? err.message : String(err)
      }`
    );
  }
  const parsed = FleetConfigSchema.safeParse(json);
  if (!parsed.success) {
    throw new Error(
      `Fleet config ${path} is invalid:\n${parsed.error.toString()}`
    );
  }
  const names = new Set<string>();
  for (const bot of parsed.data.bots) {
    if (names.has(bot.name)) {
      throw new Error(
        `Duplicate bot name "${bot.name}" in ${path}; names must be unique.`
      );
    }
    names.add(bot.name);
  }
  return parsed.data;
}

/** Find one bot by name, or throw listing the available names. */
export function resolveBot(fleet: FleetConfig, name: string): BotConfig {
  const bot = fleet.bots.find((b) => b.name === name);
  if (!bot) {
    const names = fleet.bots.map((b) => b.name).join(", ");
    throw new Error(`No bot named "${name}". Available: ${names}`);
  }
  return bot;
}

/** Read + validate the shared environment. Throws on missing required vars. */
export function loadEnvironment(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env
): Environment {
  const rpcUrl = env.RPC_URL?.trim();
  if (!rpcUrl) {
    throw new Error(
      "RPC_URL is required (e.g. https://api.devnet.solana.com)."
    );
  }
  const openRouterApiKey = env.OPENROUTER_API_KEY?.trim();
  if (!openRouterApiKey) {
    throw new Error(
      "OPENROUTER_API_KEY is required. Get one at https://openrouter.ai/keys."
    );
  }
  return {
    rpcUrl,
    openRouterApiKey,
    usdcMint: env.USDC_MINT?.trim() || undefined,
    webBaseUrl: env.WEB_BASE_URL?.trim() || undefined,
    hermesUrl: env.HERMES_URL?.trim() || undefined,
    dryRun: /^(1|true|yes)$/i.test(env.DRY_RUN?.trim() ?? ""),
  };
}
