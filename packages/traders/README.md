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
# export PRICE_SOURCE=synthetic             # see "Synthetic intraday prices" below
# export DRY_RUN=1                          # optional: log intended trades without sending
```

> **Cluster matters.** The bots trade on whatever `RPC_URL` points at — and your wallets'
> USDC, the markets, and the program must all live on that same cluster. If you funded
> traders and created markets on localnet, point `RPC_URL` at localnet (not devnet), or the
> bots will load a different cluster's empty/foreign state.

### Synthetic intraday prices (local/dev)

By default (`PRICE_SOURCE=pyth`) `get_market_price` returns the real Pyth quote — which in dev
is a single ~stale value per ticker, so the bots see no movement and tend to do the same thing.
Set **`PRICE_SOURCE=synthetic`** (requires `WEB_BASE_URL`) and the tool instead reads
`/api/price`, a **deterministic intraday price** that moves through a compressed trading day and
is **identical for every bot at the same clock tick** — so the fleet reacts to a moving market
without trading against phantom disagreements. The path replays a real prior-day %-from-open
curve (committed in `packages/web/functions/api/_intraday-curves.json`, regenerated by
`scripts/fetch-intraday-curves.mjs`) onto each market's seeded open, converging to the curve's
close as the market settles. Tune the compressed day with `SYNTH_DAY_SECONDS` (default 5400 =
90 min) in the web/wrangler env. Same mechanism on devnet — point `WEB_BASE_URL` at the deployed
dashboard.

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

### RPC rate limits (devnet)

The public devnet endpoint (`api.devnet.solana.com`) is aggressively rate-limited, and a whole
fleet scanning + trading against it will draw HTTP 429s — most from the `getProgramAccounts`
reads each bot does per tick. The fleet mitigates this two ways:

- **Staggered start.** Each bot delays its first tick by a random `[0, intervalSec)`, so the bots
  spawned together by `make bots` don't all fire their first read burst at the same instant
  (you'll see `staggering first tick by Ns` in each log).
- **Long, jittered backoff on 429.** A rate-limited transaction retries after a *random* delay —
  ~10s on the first retry, widening toward ~30s on later ones. The randomness matters: a short,
  fixed backoff just has the whole fleet retry in lockstep and re-trigger the limit. Tune the
  window with the `backoffMinMs` / `backoffMaxMs` options on `BotChain.send` (defaults 10000 /
  30000).

These reduce collisions a lot, but the **most effective fix is a dedicated RPC**. The public
endpoint caps `getProgramAccounts` at ~4/sec across your whole IP (40 per 10s, per-method — see
[Solana's cluster docs](https://solana.com/docs/references/clusters)), and all the bots share one
IP, so a gPA-heavy fleet blows past it instantly. Point `RPC_URL` at your own endpoint — the bots
read it from the environment:

```bash
export RPC_URL="https://solana-devnet.g.alchemy.com/v2/<your-key>"
make bots
```

**Mind the free-tier `getProgramAccounts` policy** — the bots discover open markets with a single
`getProgramAccounts` scan per tick (cached for 30s), so a provider that *blocks or hard-caps* gPA on
its free tier will stall the fleet, not just slow it:

- **Alchemy** free tier **blocks `getProgramAccounts` outright** (`"not available on the Free tier"`).
  Its **Pay As You Go** plan unlocks it; usage is trivial — a 2-hour 8-bot run is on the order of
  ~20K–120K compute units (well under a cent at $0.45/1M CU), since gPA is only ~1 call per tick.
- **Helius** free tier hard-caps gPA at 5/sec.
- **QuickNode** free tier meters per-method (gPA not singled out) — a reasonable no-card option.

**Locally, run against your validator** — no limits, no gPA restrictions at all.

### Closing the day

When the (compressed) trading day ends, settle the markets at the **synthetic close** the bots
traded against:

```bash
WEB_BASE_URL=http://localhost:8788 make settle-due        # settle all due markets, once
```

This settles each open, past-its-day market via `admin_settle` at `/api/price`'s end-of-session
value (`≥ strike → Yes wins`). `admin_settle` is on-chain time-gated (1h by default), but when you
ran the stack with `PRICE_SOURCE=synthetic`, `make dev` already built + deployed the program with
the `demo-fast-settle` feature (5-min delay) — so `settle-due` works ~5 min after close with no
extra build step. See `docs/local-development.md` for the full flow.

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
