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

Each bot's standing goal is **make the most money you can today**. It looks for strikes where the
order-book implied probability disagrees with its own read of spot + recent closes, and takes the
cheaper side.

## Prerequisites

- The Meridian program **bootstrapped on your target cluster** (devnet is the default target):
  `make deploy-devnet bootstrap-devnet create-markets-devnet` from the repo root.
- The two test trader wallets, **funded**: `make fund-traders-devnet`
  (creates/funds `~/.config/solana/trader{1,2}.json` with SOL + mock USDC).
- An **OpenRouter API key**.

## Configure

```bash
cp packages/traders/bots.config.example.json packages/traders/bots.config.json
```

Edit it — one entry per bot:

```jsonc
{
  "bots": [
    {
      "name": "claude-trader", // log-friendly id; also the log file name
      "wallet": "~/.config/solana/trader1.json", // a funded trader keypair
      "model": "anthropic/claude-3.5-sonnet", // any OpenRouter model id
      "intervalSec": 60, // seconds between trading ticks
      "persona": "A disciplined value trader…" // optional flavor for the system prompt
    }
  ]
}
```

Spin up **N** bots by adding more entries (give each its own wallet + model). The real config is
gitignored because it names wallet paths; the committed template is `bots.config.example.json`.

Set the shared environment (see the root `.env.example` for the full list):

```bash
export RPC_URL=https://api.devnet.solana.com
export OPENROUTER_API_KEY=sk-or-...
export WEB_BASE_URL=http://localhost:3000   # optional: enables the 7-day-history tool
# export DRY_RUN=1                          # optional: log intended trades without sending
```

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
  yarn workspace @meridian/traders run-bot claude-trader
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

The default target is **devnet with mock USDC**, so no real money is at risk. There is **no
per-bot spend cap** — a bot may trade up to its balance, matching the "make the most money
possible" objective. Use `DRY_RUN=1` to watch a bot reason and decide without it actually sending
transactions.
