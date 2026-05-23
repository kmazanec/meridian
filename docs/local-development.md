# Local Development

## TL;DR — which Solana cluster do I need?

**None.** The current dev loop does not depend on your Solana CLI's active
cluster. You can leave the CLI pointed at devnet, localnet, or anything else and
everything below still works.

| Workflow | What it targets | Depends on CLI cluster? |
|---|---|---|
| `cargo test` (unit/invariant tests) | LiteSVM, in-process — no validator, no RPC | No |
| `anchor build` / `anchor test` / `anchor deploy` | Reads `cluster`/`wallet` from `Anchor.toml` (`localnet`, `~/.config/solana/id.json`) | No |
| Bare `solana ...` commands you type (`balance`, `airdrop`, manual deploys) | Whatever `~/.config/solana/cli/config.yml` points at | Yes |

So switching the CLI to devnet (e.g. to fund a wallet from the faucet) does **not**
break local development. Only commands you invoke as `solana ...` directly are
affected.

## Running the tests

```bash
cargo test
```

The suite under `programs/meridian/tests/` uses
[LiteSVM](https://github.com/LiteSVM/litesvm), which loads the program into an
in-process VM. There is no local validator to start and no airdrop to perform.

The off-chain workspaces have their own tests:

```bash
yarn workspace @meridian/sdk test          # SDK (pure + LiteSVM)
yarn workspace @meridian/automation test   # automation (unit + LiteSVM)
yarn workspace @meridian/web test          # frontend (vitest)
```

## Convergence E2E suite (`@meridian/e2e`)

The cross-stack convergence suite drives the **full integrated lifecycle** against a
**real `solana-test-validator`** using the SDK and automation service (create → mint →
trade → settle → redeem, all four trade paths, a multi-user scenario, and the
on-chain invariants after each phase). Unlike the LiteSVM suites it boots an actual
validator, so it is **not** part of the Node-only CI job and is run locally:

```bash
# Build the program first (the harness loads target/deploy/meridian.so):
anchor build
yarn workspace @meridian/sdk build          # the e2e package imports the SDK's dist
yarn workspace @meridian/automation build

# Then run the suite (it boots + tears down its own validator):
yarn workspace @meridian/e2e test
```

Requirements: `solana-test-validator` and the `solana` CLI on PATH, and a built
`target/deploy/meridian.so`. In a git worktree whose `target/` is empty, point the
harness at a `.so` built elsewhere for the same program source:

```bash
MERIDIAN_SO=/path/to/target/deploy/meridian.so \
MERIDIAN_PROGRAM_KEYPAIR=/path/to/target/deploy/meridian-keypair.json \
  yarn workspace @meridian/e2e test
```

If no validator/`.so` is available the suite **skips** itself (green, no failures). Set
`E2E_REQUIRE_VALIDATOR=1` to turn a missing validator into a hard failure instead.

### Live-devnet settlement (opt-in)

One test exercises the genuine Pyth pull-oracle path (Hermes → Receiver →
`settle_market`) and is **skipped unless** enabled. It needs a funded devnet keypair and
a fresh price (US market hours for an equity feed; a 24/7 crypto feed works any time):

```bash
E2E_DEVNET=1 RPC_URL=https://api.devnet.solana.com \
SOLANA_KEYPAIR=~/.config/solana/id.json FEED_META=<devnet hex feed id> \
  yarn workspace @meridian/e2e test
```

## Anchor commands

`anchor build`, `anchor test`, and `anchor deploy` read their provider settings
from `Anchor.toml`, not from your CLI config:

```toml
[provider]
cluster = "localnet"
wallet = "~/.config/solana/id.json"
```

To run against a local validator, start one separately (`solana-test-validator`)
and use the Anchor commands as usual. To deploy elsewhere, override per-command
(`anchor deploy --provider.cluster devnet`) rather than switching your global CLI
config.

## Switching the CLI cluster (only needed for manual `solana` commands)

These shell helpers (defined in the maintainer's dotfiles, not in this repo) copy
a saved profile into `~/.config/solana/cli/config.yml`:

```bash
sol-devnet   # CLI → https://api.devnet.solana.com, devnet keypair
sol-local    # CLI → http://localhost:8899, id.json
sol-which    # show the active RPC URL
```

Equivalent without the helpers:

```bash
solana config set -u devnet      # or:  -u localhost
# or per-command, leaving the saved config untouched:
solana balance -u devnet
```

Funding a devnet wallet:

```bash
sol-devnet
solana airdrop 2
solana balance
# if rate-limited, use https://faucet.solana.com with your devnet address
```

## One-command local stack (`make dev`)

The fastest way to a running, trade-against-able stack is the root `Makefile`:

```bash
make dev    # build/boot validator → deploy → init Config+USDC → create the day's
            # markets → seed a demo wallet → write packages/web/.env.local
make demo   # run the headless lifecycle (create → mint → trade → settle → redeem)
make stop   # tear it all down and remove local state
make help   # list every target
```

`make dev` leaves a local validator running and writes `packages/web/.env.local`, so
`yarn workspace @meridian/web dev` immediately points the frontend at the local stack
(with a funded demo wallet — its secret is in the gitignored `.localnet/dev.json`).

> By default the demo wallet is funded with USDC but holds **no pre-built positions**, and the
> only markets are the live-seeded ones (a clean board — best for bot trading). For the
> one-click browser demo with pre-built Yes/No/redeemable positions in fixed demo markets, run
> `SEED_DEMO_WALLET=1 make dev`. (Those fixed demo strikes are off the live ladder, which is why
> they're opt-in.)

These targets are powered by the **`@meridian/ops`** package — environment-agnostic,
`RPC_URL`-driven scripts (`deploy`, `bootstrap`, `create-markets`, `lifecycle`) that run the
same way against a local validator and against devnet. In a git worktree whose `target/` is
empty, point them at a `.so` built elsewhere via `MERIDIAN_SO` / `MERIDIAN_PROGRAM_KEYPAIR`
(the same overrides the convergence harness honors).

### Test trader accounts (`make fund-traders`)

`make dev` funds one internal demo wallet (USDC; pre-built positions only with
`SEED_DEMO_WALLET=1`). To place *pretend trades between parties* — and to back the trading-bot
fleet below —
fund a set of persistent, importable accounts:

```bash
make fund-traders          # local: keypairs in ~/.config/solana/trader{1..8}.json,
                           #        each given 10 SOL + 1000 mock USDC
make fund-traders-devnet   # same keypairs, funded on devnet (faucet SOL + mock USDC)
```

The script (`scripts/fund-test-traders.mjs`) generates each `trader{1..8}.json` on first run
and reuses the rest after — so re-running is safe and the same traders work on both clusters. The
mock USDC mint authority is the deployer/admin, so it mints test USDC directly; SOL is an airdrop
locally and the faucet on devnet (if rate-limited, top up with `solana transfer`). Override the
set or amounts with `TRADERS=`, `SOL_EACH=`, `USDC_EACH=`.

To trade as them in the browser, convert each keypair to a base58 private key and import it
into your wallet (Phantom/Solflare), then switch accounts:

```bash
node -e "console.log(require('bs58').encode(Buffer.from(JSON.parse(require('fs').readFileSync(process.argv[1])))))" ~/.config/solana/trader1.json
```

> These keypair files hold real (test-only) secrets — keep them out of commits. The repo only
> ships the funding script, never the keys.

## Trading bots (`@meridian/traders`)

A fleet of autonomous LLM agents that trade on the platform — each with its own funded wallet and
its own (cheap, tool-calling) OpenRouter model. They observe the market through tools, reason with
LangGraph, make markets on empty strikes and take edges on quoted ones, and narrate every decision
to a watchable log. See [`packages/traders/README.md`](../packages/traders/README.md) for the full
guide; the end-to-end local + devnet flow is below.

**Realistic strikes (so bots don't bid one-directionally).** The strike ladder is derived from a
*previous close*. By default that's the `MOCK_CLOSE_*` values, which drift from reality — and since
the bots read live spot, a stale ladder makes every strike look near-certain and the bots quote one
way. Seed strikes from the **real last close** instead by exposing the dashboard's `/api/history`
(a Cloudflare Pages Function) and setting `WEB_BASE_URL`. Closes resolve **live → `MOCK_CLOSE_*` →
hardcoded defaults**, so it always produces a sane board.

Serve `/api/history` locally with wrangler (it answers on `:8788` — see
[`cloudflare-pages.md`](cloudflare-pages.md)):

```bash
cd packages/web && yarn build && npx wrangler pages dev out   # serves /api/* on :8788
curl -s 'http://localhost:8788/api/history?symbol=AAPL' | head -c 80   # sanity-check it returns closes
```

### Localnet (recommended — no RPC rate limits)

```bash
export OPENROUTER_API_KEY=sk-or-...
export WEB_BASE_URL=http://localhost:8788     # wrangler serving /api/history (optional but recommended)

make dev                                       # validator + deploy + markets (live closes if WEB_BASE_URL set)
make fund-traders                              # create + fund trader{1..8}.json
make create-markets-live                       # (optional) reseed strikes from the real last close

cp packages/traders/bots.config.example.json packages/traders/bots.config.json   # 8 bots, one per wallet
export RPC_URL=http://127.0.0.1:8899
make bots                                      # spawn one process per bot
make bots-logs                                 # watch them reason + trade
make bots-stop                                 # stop the fleet
```

### Devnet

```bash
export OPENROUTER_API_KEY=sk-or-...
export RPC_URL=https://api.devnet.solana.com
export WEB_BASE_URL=https://<your-deployed-dashboard>   # for live closes + the history tool

make deploy-devnet bootstrap-devnet
make create-markets-live-devnet                # WEB_BASE_URL required here; or create-markets-devnet for mock
make fund-traders-devnet
make bots                                       # heavier 429 rate-limiting on public devnet than localnet
```

The bot config (`bots.config.json`) maps each bot to a `trader{N}.json` wallet and an OpenRouter
model; `intervalSec` sets the tick cadence and `maxStepsPerTick` caps agent⇄tool round-trips per
tick (raise it if a bot quoting many strikes hits the limit). `DRY_RUN=1` makes bots log intended
trades without sending them.

**Price variability.** In dev the real Pyth quote is a single stale value per ticker, so the
bots see no movement. Set `PRICE_SOURCE=synthetic` (with `WEB_BASE_URL` pointing at wrangler/
`:8788`) and `get_market_price` instead reads `/api/price` — a deterministic intraday price that
moves through a compressed session and is identical for every bot at the same tick. It replays a
real prior-day %-from-open curve (committed JSON, regenerated by
`scripts/fetch-intraday-curves.mjs`) onto each market's open; tune the day length with
`SYNTH_DAY_SECONDS` (default 90 min). See `packages/traders/README.md` for details.

**Closing the day (`make settle-due`).** After a (compressed) trading day ends, settle the
markets the way the production cron would — except production uses `settle_market` + a real Pyth
price posted through the Pyth Receiver, which isn't available on localnet and can't be fed a
synthetic value on devnet. So the demo closes via **`admin_settle`** (the one instruction that
takes an arbitrary price), settling each due market at the **synthetic close** from `/api/price`
(progress=1) — coherent with what the bots traded against. `settlementPrice ≥ strike → Yes wins`.

```bash
# Locally, nothing extra to build: when you start the stack with PRICE_SOURCE=synthetic,
# `make dev` builds + deploys the program with the demo-fast-settle feature automatically.
WEB_BASE_URL=http://localhost:8788 make settle-due        # settle ALL due open markets, once
# devnet: build once with `make build-demo`, deploy, then:
#   WEB_BASE_URL=https://<dashboard> make settle-due-devnet
```

`admin_settle` is on-chain time-gated at `trading_day + ADMIN_OVERRIDE_DELAY` — 1 hour by
default. The `demo-fast-settle` Cargo feature shortens it to 5 minutes (localnet/devnet-demo
only; a default mainnet build keeps 1h). **You don't build this by hand for local dev:**
`make dev` selects the feature from `PRICE_SOURCE` — `synthetic` → demo-fast-settle (compressed
day, fast close), real prices → the default 1h program. (For a devnet synthetic demo, where you
deploy separately, run `make build-demo` before `make deploy-devnet`.) `settle-due` is idempotent
(already-settled markets skipped) and settles every open market whose day has passed in one run;
`GRACE_SECONDS` widens "due" to markets closing within N seconds.

### Ops reproducibility test

`@meridian/ops` has a **validator-gated** test that runs the *actual* deploy → bootstrap →
create-markets → lifecycle bins as subprocesses against a real validator and asserts the
on-chain invariants — so "reproducible" is verified, not assumed. Like the convergence suite
it **skips** cleanly without a validator/`.so`; CI runs only the package's typecheck + pure
`*.contract` tests.

```bash
# Build the program first (or set MERIDIAN_SO), then:
yarn workspace @meridian/ops test            # full (boots a validator; runs the real bins)
yarn workspace @meridian/ops test:contract   # pure contract tests only (no validator)
```

## Devnet deployment

The **same** ops scripts deploy and run the lifecycle on real devnet — you supply a funded
keypair and an RPC endpoint. See **[`devnet-deployment.md`](devnet-deployment.md)** for the
step-by-step runbook (`make deploy-devnet` / `bootstrap-devnet` / `create-markets-devnet` /
`lifecycle-devnet`), including how to fund a devnet wallet and the live-Pyth vs admin-override
settlement choice.
