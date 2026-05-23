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
    "Your GOAL: make the most profit you can today. Find strikes where the order-book mid",
    "(the implied probability) disagrees with your own estimate from the spot price, recent",
    "closes, and how far spot is from the strike — then take the cheaper side. Consider your",
    "USDC balance and existing positions; don't bet more than you can afford.",
    "",
    "Workflow each turn: observe with the read tools (list_strikes, get_market_price,",
    "get_price_history, get_strike_prices, get_wallet_balance), reason out loud about where",
    "the edge is, then place_order if (and only if) you see a worthwhile trade. It's fine to",
    "do nothing this tick if nothing is attractive. Prices you pass to place_order are",
    "probabilities in [0,1] in that action's own perspective. Always explain your reasoning",
    "before acting.",
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
        { recursionLimit: opts.recursionLimit ?? 25, streamMode: "values" }
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
