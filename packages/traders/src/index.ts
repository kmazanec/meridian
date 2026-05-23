/**
 * Public surface of @meridian/traders. The fleet is normally run via the `meridian-run-bot`
 * binary (one process per bot, spawned by the Makefile), but the building blocks are
 * exported so a bot can also be embedded or tested programmatically.
 */

export {
  type BotConfig,
  type FleetConfig,
  type Environment,
  loadFleet,
  resolveBot,
  loadEnvironment,
} from "./config";
export { loadWallet, expandPath } from "./wallet";
export { BotChain } from "./chain";
export { createLlm } from "./llm";
export { createLogger, type Logger } from "./logger";
export {
  type BotContext,
  type OpenMarket,
  discoverOpenMarkets,
  feedIdHex,
  resolveSymbol,
} from "./context";
export { makeTools } from "./tools";
export { createTradingAgent, systemPrompt, type TradingAgent } from "./agent";
export { runBot, prepareBot, buildContext } from "./runner";
export { summarizeBook, type SideSummary } from "./book";
export { makerAccountsFor } from "./crossing";
export * from "./format";
