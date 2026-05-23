/**
 * The LLM client: a LangChain `ChatOpenAI` pointed at OpenRouter.
 *
 * OpenRouter speaks the OpenAI Chat Completions API, so `ChatOpenAI` works against it by
 * overriding the base URL and supplying the OpenRouter key. The model id (e.g.
 * `anthropic/claude-3.5-sonnet`, `openai/gpt-4o`, `google/gemini-pro-1.5`) is per-bot, so
 * each bot in the fleet can reason with a different model while sharing one API key. Tool
 * calling is the standard OpenAI function-calling protocol, which OpenRouter proxies for
 * models that support it — that is what lets LangGraph bind our trading tools.
 */

import { ChatOpenAI } from "@langchain/openai";

const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

export interface LlmOptions {
  model: string;
  apiKey: string;
  /** Lower = more deterministic. Trading wants some, not wild, variance. */
  temperature?: number;
}

/** Build a tool-calling chat model served through OpenRouter. */
export function createLlm(opts: LlmOptions): ChatOpenAI {
  return new ChatOpenAI({
    model: opts.model,
    apiKey: opts.apiKey,
    temperature: opts.temperature ?? 0.4,
    configuration: {
      baseURL: OPENROUTER_BASE_URL,
      // Optional OpenRouter attribution headers — harmless if unused.
      defaultHeaders: {
        "HTTP-Referer": "https://meridian.local/traders",
        "X-Title": "Meridian Trading Bots",
      },
    },
  });
}
