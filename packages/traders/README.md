# @meridian/traders — autonomous LLM trading bots

A fleet of goal-oriented trading agents for Meridian. Each bot has its **own wallet** and its
**own LLM** (any model on [OpenRouter](https://openrouter.ai)), observes the markets through a
set of tools, reasons with [LangGraph](https://langchain-ai.github.io/langgraphjs/), and places
**real on-chain wagers** — all while narrating its decisions to a log you can watch live.

The bots are intentionally separate from the rest of the platform: all the agent logic here is
new. The one thing they reuse is [`@meridian/sdk`](../sdk), as a library, for the on-chain
transaction format (PDA derivation, Anchor encoding, the four-button intent, order-book
crossing). Re-deriving that by hand would only risk sending invalid transactions.

## What each bot can do

Six tools, matching the six required capabilities:

| Tool                 | What it does                                                                                                          |
| -------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `get_market_price`   | Current spot price of a symbol (Pyth, via the SDK).                                                                   |
| `get_price_history`  | Last 7 daily closes, from the dashboard's `GET /api/history`. Degrades gracefully when that endpoint isn't available. |
| `get_wallet_balance` | The bot's USDC, SOL, and open Yes/No positions.                                                                       |
| `list_strikes`       | Every open strike market (per stock/strike for today).                                                                |
| `get_strike_prices`  | Live order-book bid/ask/mid (the implied probability) per strike, both Yes and No sides.                              |
| `place_order`        | Place any of the four actions — **BUY_YES, SELL_YES, BUY_NO, SELL_NO** — as a limit or market order.                  |

Each bot's standing goal is **make the most money you can today**. On a strike that already has
quotes, it takes the cheaper side when the order-book implied probability disagrees with its own
read of spot + recent closes; on an empty strike it **posts resting limit orders to make a
market** around its fair-value estimate. So the fleet bootstraps liquidity and then trades against
itself.

The example config ships **8 bots**, each with its own wallet and a different (cheap,
tool-calling) OpenRouter model. Run as many or as few as you like.

## Prerequisites

Pick a cluster and make sure the program, your wallets, and the markets all live on it.

**Localnet (recommended — no RPC rate limits):**

```bash
make dev            # boot validator + deploy + bootstrap + create markets
make fund-traders   # create + fund trader{1..8}.json with SOL + mock USDC
```

**Devnet:**

```bash
make deploy-devnet bootstrap-devnet create-markets-devnet
make fund-traders-devnet   # fund trader{1..8}.json (faucet SOL + mock USDC)
```

`make fund-traders[-devnet]` creates any `~/.config/solana/trader{1..8}.json` that don't exist
yet and reuses the rest, so re-running is safe. You also need an **OpenRouter API key**.

## Configure

```bash
cp packages/traders/bots.config.example.json packages/traders/bots.config.json
```

Edit it — one entry per bot:

```jsonc
{
  "bots": [
    {
      "name": "deepseek-trader", // log-friendly id; also the log file name
      "wallet": "~/.config/solana/trader1.json", // a funded trader keypair
      "model": "deepseek/deepseek-v4-flash", // any tool-calling OpenRouter model id
      "intervalSec": 60, // seconds between trading ticks
      "maxStepsPerTick": 60, // max agent⇄tool round-trips per tick (raise if quoting many strikes)
      "persona": "A disciplined value trader…" // optional flavor for the system prompt
    }
    // … 7 more in the shipped example, one per wallet + model
  ]
}
```

Spin up **N** bots by adding/removing entries (give each its own wallet + model). The shipped
example has 8. The real config is gitignored because it names wallet paths; the committed template
is `bots.config.example.json`. **Models must support tool calling** — the major Anthropic / OpenAI
/ Google / DeepSeek / Mistral / Qwen ids do; tiny or preview models often malform tool calls.

Set the shared environment (see the root `.env.example` for the full list):

```bash
# Recommended: run against your local validator — no RPC rate limits.
export RPC_URL=http://127.0.0.1:8899
# (public devnet works too, but many bots scanning it get heavily 429-rate-limited:
#  export RPC_URL=https://api.devnet.solana.com)
export OPENROUTER_API_KEY=sk-or-...
# Optional: enables the 7-day-history tool. /api/history is a Cloudflare Pages Function, so
# point this at wherever it's served — wrangler's port locally (`wrangler pages dev` →
# http://localhost:8788), or your deployed dashboard URL.
export WEB_BASE_URL=http://localhost:8788
# export DRY_RUN=1                          # optional: log intended trades without sending
```

> **Cluster matters.** The bots trade on whatever `RPC_URL` points at — and your wallets'
> USDC, the markets, and the program must all live on that same cluster. If you funded
> traders and created markets on localnet, point `RPC_URL` at localnet (not devnet), or the
> bots will load a different cluster's empty/foreign state.

## Run the fleet

From the repo root:

```bash
make bots         # spawn one background process per bot (true concurrency)
make bots-logs    # tail every bot's reasoning together
make bots-stop    # stop the whole fleet
```

Each bot runs as its own OS process, so the fleet trades **concurrently** and one bot crashing
doesn't take down the others. Output goes to `packages/traders/logs/<name>.log`; PIDs are tracked
in `packages/traders/logs/bots.pids`.

To run a single bot in the foreground (handy for development):

```bash
RPC_URL=… OPENROUTER_API_KEY=… \
  yarn workspace @meridian/traders run-bot deepseek-trader   # a bot name from your config
```

## Watching it think

The log narrates each tick — the model's reasoning (🧠), each tool call (→) and result (←), and
every placed trade (💸) with its transaction signature:

```
2026-05-22T15:30:01Z [claude-trader] ── tick 3 ──
2026-05-22T15:30:02Z [claude-trader] 🧠 NVDA spot is $124, well above the $120 strike, but Yes
                                        only trades at 0.58 — that looks cheap. Buying Yes.
2026-05-22T15:30:02Z [claude-trader] → place_order({"symbol":"NVDA","strike":120,"action":"BUY_YES",…})
2026-05-22T15:30:04Z [claude-trader] 💸 BUY_YES 10 NVDA @120 (0.59) {sig: 5xQ…, makers: 2}
```

## Develop

```bash
yarn workspace @meridian/traders typecheck   # full type-check
yarn workspace @meridian/traders test        # unit tests (pure logic: conversions, book
                                             #   summarization, crossing, intent reflection)
yarn workspace @meridian/traders build        # emit dist/
```

> Note: this package uses `module`/`moduleResolution: "nodenext"` (the other packages use the
> legacy `"node"` resolution). That's deliberate — NodeNext honors LangChain's and zod's
> `exports` maps, which keeps `tool()`'s generics tractable; the legacy resolver makes them
> instantiate millions of types per tool call (TS2589 / out-of-memory). NodeNext still emits
> CommonJS here because the package has no `"type": "module"`.

## Safety

Run on **localnet or devnet with mock USDC** — no real money is at risk on either. There is **no
per-bot spend cap**: a bot may trade up to its balance, matching the "make the most money
possible" objective. Use `DRY_RUN=1` to watch a bot reason and decide without it actually sending
transactions. (Don't point `RPC_URL` at mainnet.)
