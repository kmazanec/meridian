/**
 * One bot's continuous trading loop.
 *
 * Wires everything together: load the wallet, build the chain client, resolve the
 * collateral mint + on-chain Config, assemble the tools and the LangGraph agent, then tick
 * forever — each tick hands the agent a fresh goal prompt (with the wall clock and the
 * bot's identity), lets it observe and trade, logs a tick boundary, and sleeps the
 * configured interval. A failed tick is logged and the loop continues (one bad RPC moment
 * shouldn't kill the bot); the process is supervised externally (the Makefile spawns it).
 */

import { fetchConfig } from "@meridian/sdk";
import type { BotConfig, Environment } from "./config";
import { BotChain } from "./chain";
import { loadWallet } from "./wallet";
import { createLogger, type Logger } from "./logger";
import { createLlm } from "./llm";
import { makeTools } from "./tools";
import { createTradingAgent, type TradingAgent } from "./agent";
import type { BotContext } from "./context";

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/** Build the per-tick goal prompt: the standing objective plus live wall-clock context. */
function goalPrompt(bot: BotConfig, walletPubkey: string): string {
  const now = new Date();
  const et = now.toLocaleString("en-US", { timeZone: "America/New_York" });
  return [
    `It is ${et} ET (${now.toISOString()}).`,
    `You are "${bot.name}", trading from wallet ${walletPubkey}.`,
    "Markets settle at the 4:00 PM ET close, so time remaining matters.",
    "Review the markets now and make the trades you think maximize your profit today.",
    "Start by checking your balance and the available strikes.",
  ].join(" ");
}

/** Assemble the runtime context (chain, mint, config, env, logger) for a bot. */
export async function buildContext(
  bot: BotConfig,
  env: Environment,
  log: Logger
): Promise<BotContext> {
  const keypair = loadWallet(bot.wallet);
  const chain = new BotChain(env.rpcUrl, keypair);
  const config = await fetchConfig(chain.program);
  if (!config) {
    throw new Error(
      "On-chain Config not found — is the program bootstrapped on this cluster?"
    );
  }
  const usdcMint = await chain.resolveUsdcMint(env.usdcMint);
  return { chain, usdcMint, config, env, log };
}

/** Result of preparing a bot: its context + agent, ready to tick. */
export interface PreparedBot {
  ctx: BotContext;
  agent: TradingAgent;
}

/** Load + wire a single bot (wallet, chain, tools, agent) without starting the loop. */
export async function prepareBot(
  bot: BotConfig,
  env: Environment,
  log: Logger
): Promise<PreparedBot> {
  const ctx = await buildContext(bot, env, log);
  const llm = createLlm({ model: bot.model, apiKey: env.openRouterApiKey });
  const agent = createTradingAgent({
    llm,
    tools: makeTools(ctx),
    persona: bot.persona,
    log,
    recursionLimit: bot.maxStepsPerTick,
  });
  return { ctx, agent };
}

/**
 * Run a bot's loop until the process is stopped. Each iteration is a tick; failures are
 * logged and the loop continues. Returns only if `signal` aborts.
 */
export async function runBot(
  bot: BotConfig,
  env: Environment,
  signal?: AbortSignal
): Promise<void> {
  const log = createLogger({ bot: bot.name });
  log.info(`starting`, {
    model: bot.model,
    intervalSec: bot.intervalSec,
    cluster: env.rpcUrl,
    dryRun: env.dryRun,
  });

  const { ctx, agent } = await prepareBot(bot, env, log);
  log.info(`ready`, {
    wallet: ctx.chain.pubkey.toBase58(),
    usdcMint: ctx.usdcMint.toBase58(),
  });

  // Stagger the fleet's first tick. `make bots` spawns every bot within the same second, so
  // without this they all fire their first round of getProgramAccounts reads simultaneously —
  // the chief source of the shared endpoint's 429s. A random delay in [0, intervalSec) spreads
  // the fleet across the tick window up front; subsequent ticks stay spread because each bot's
  // work takes a different amount of time. Skipped when aborted before we even start.
  if (!signal?.aborted) {
    const startupJitterMs = Math.random() * bot.intervalSec * 1000;
    log.info(`staggering first tick by ${Math.round(startupJitterMs / 1000)}s`);
    await sleep(startupJitterMs);
  }

  let tick = 0;
  while (!signal?.aborted) {
    tick += 1;
    log.info(`── tick ${tick} ──`);
    try {
      await agent.runTick(goalPrompt(bot, ctx.chain.pubkey.toBase58()));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // Hitting the step limit isn't a crash: the orders placed earlier in the tick did
      // execute on-chain, the agent just ran out of round-trips before wrapping up. Log it
      // as a tunable warning (raise maxStepsPerTick) rather than an error.
      if (/recursion limit/i.test(msg)) {
        log.warn(
          `tick ${tick} hit the step limit (${bot.maxStepsPerTick}); orders placed so far ` +
            `stand. Raise maxStepsPerTick in bots.config.json if this recurs.`
        );
      } else {
        log.error(`tick failed: ${msg}`);
      }
    }
    if (signal?.aborted) break;
    await sleep(bot.intervalSec * 1000);
  }
  log.info("stopped");
}
