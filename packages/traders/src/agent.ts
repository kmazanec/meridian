/**
 * The decision agent: a LangGraph ReAct loop (model ⇄ tools) that runs one trading tick.
 *
 * We use LangGraph's prebuilt `createReactAgent`, which wires the canonical loop — the
 * model proposes tool calls, the tool node runs them, results feed back, repeat until the
 * model answers with no more tool calls. We bind our six tools and a system prompt that
 * states the goal ("make the most money possible today"), the rules of the market, and the
 * units everything is expressed in.
 *
 * Crucially, we *stream* the run and surface every step to the logger — the model's
 * narrated reasoning, each tool call with its args, and each tool result — so an operator
 * tailing the log watches the agent think and act in real time.
 */

import { createReactAgent } from "@langchain/langgraph/prebuilt";
import {
  AIMessage,
  HumanMessage,
  SystemMessage,
  ToolMessage,
  isAIMessage,
  isToolMessage,
} from "@langchain/core/messages";
import type { ChatOpenAI } from "@langchain/openai";
import type { StructuredToolInterface } from "@langchain/core/tools";
import type { Logger } from "./logger";

export interface TradingAgent {
  /** Run one tick: hand the agent its goal and let it observe + act. */
  runTick(goalPrompt: string): Promise<void>;
}

/** The standing instructions every tick begins from. */
export function systemPrompt(persona?: string): string {
  return [
    "You are an autonomous trading agent on Meridian, a prediction market for US stocks.",
    'Each market asks: "Will <STOCK> close at or above <STRIKE> today?" You trade Yes/No',
    "outcome tokens. Yes + No always settle to $1.00: a winning token redeems for $1.00, a",
    "losing one for $0. So a token's price in [0,1] is the market-implied probability of",
    "that outcome.",
    "",
    "Your four actions:",
    "- BUY_YES  — bet the stock closes >= strike (pay the Yes price).",
    "- SELL_YES — sell Yes you hold / take the other side.",
    "- BUY_NO   — bet it closes < strike (pay the No price).",
    "- SELL_NO  — close No exposure / take the other side.",
    "",
    "Your GOAL: make the most profit you can today. There are two ways to do that, and you",
    "should use both:",
    "",
    "1. TAKE edges. When a strike already has order-book quotes (get_strike_prices shows a",
    "   non-null bid/ask/mid), compare that implied probability against YOUR estimate (from",
    "   spot price, recent closes, and how far spot is from the strike). If the market is",
    "   mispriced, take the cheaper side with a marketable order (isMarket=true, or a limit",
    "   that crosses).",
    "",
    "2. MAKE markets. Most strikes start with an EMPTY book (bid/ask/mid all null) — that is",
    "   normal and it is your biggest opportunity, not a reason to do nothing. Estimate your",
    "   own fair probability p that the stock closes >= strike (use spot vs strike + the",
    "   recent closes; a strike far below spot is likely Yes, far above is likely No), then",
    "   POST RESTING LIMIT ORDERS around it: e.g. a BUY_YES limit a few cents below p and a",
    "   SELL_YES limit a few cents above p. A limit order that doesn't cross simply rests on",
    "   the book, providing liquidity and earning the spread when someone trades against it.",
    "   On an empty book you MUST quote rather than wait — that is how the market comes to",
    "   life and how you and the other bots trade with each other.",
    "",
    "Size orders to your USDC balance and existing positions; don't bet more than you can",
    "afford, and spread risk across several strikes rather than dumping it all on one.",
    "",
    "Workflow each turn: observe with the read tools (list_strikes, get_market_price,",
    "get_price_history, get_strike_prices, get_wallet_balance), reason out loud about each",
    "strike's fair value, then place_order — taking edges where quotes exist and posting",
    "fresh quotes where the book is empty. Aim to place at least a few orders each tick while",
    "you have spare USDC; only sit out a strike you genuinely can't price. Prices you pass to",
    "place_order are probabilities in [0,1] in that action's own perspective (and note: if",
    "get_market_price is unavailable, rely on get_price_history + the strike level instead).",
    "Always explain your reasoning before acting.",
    ...(persona ? ["", `Your trading style: ${persona}`] : []),
  ].join("\n");
}

/** Build a {@link TradingAgent} from a tool-calling model, the tools, and a logger. */
export function createTradingAgent(opts: {
  llm: ChatOpenAI;
  tools: StructuredToolInterface[];
  persona?: string;
  log: Logger;
  /** Hard cap on model⇄tool round-trips per tick, so a confused model can't loop forever. */
  recursionLimit?: number;
}): TradingAgent {
  const { llm, tools, persona, log } = opts;
  const agent = createReactAgent({
    llm,
    tools,
    stateModifier: new SystemMessage(systemPrompt(persona)),
  });

  return {
    async runTick(goalPrompt: string): Promise<void> {
      // Track which messages we've already logged across streamed snapshots, so we narrate
      // each new step exactly once (the stream re-emits the growing message list).
      let logged = 0;
      const stream = await agent.stream(
        { messages: [new HumanMessage(goalPrompt)] },
        { recursionLimit: opts.recursionLimit ?? 60, streamMode: "values" }
      );
      for await (const snapshot of stream) {
        const messages = (snapshot.messages ?? []) as (
          | AIMessage
          | ToolMessage
          | HumanMessage
          | SystemMessage
        )[];
        for (let i = logged; i < messages.length; i++) {
          narrate(messages[i], log);
        }
        logged = messages.length;
      }
    },
  };
}

/** Emit one message to the log in the right shape (reasoning / tool call / tool result). */
function narrate(
  msg: AIMessage | ToolMessage | HumanMessage | SystemMessage,
  log: Logger
): void {
  if (isAIMessage(msg)) {
    const text = textOf(msg.content);
    if (text) log.think(text);
    for (const call of msg.tool_calls ?? []) {
      log.tool(call.name, call.args);
    }
    return;
  }
  if (isToolMessage(msg)) {
    log.result(msg.name ?? "tool", textOf(msg.content));
  }
}

/** Flatten LangChain message content (string or content-block array) to text. */
function textOf(content: unknown): string {
  if (typeof content === "string") return content.trim();
  if (Array.isArray(content)) {
    return content
      .map((c) =>
        typeof c === "string" ? c : (c as { text?: string }).text ?? ""
      )
      .join("")
      .trim();
  }
  return "";
}
