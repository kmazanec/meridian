# Meridian

> Binary stock-outcome markets on Solana. A non-custodial dApp where you trade
> **Yes/No** tokens on whether a MAG7 stock will close at or above a strike price
> today. Each contract pays **$1.00 USDC** to the winning side, and
> **`Yes + No = $1.00`** always.

**▶ Live demo: [meridian.llmonster.dev](https://meridian.llmonster.dev)** (Solana
devnet — connect a wallet, no real money). Prefer to run it yourself? Jump to
[Quick start](#quick-start).

Meridian is a same-day (0DTE) binary options market. The question is always:

> **"Will [STOCK] close at or above [STRIKE] today?"**

If you think *yes*, you hold **Yes tokens**; if *no*, **No tokens**. At 4:00 PM ET
the market settles against an on-chain price oracle:

- Closing price **≥ strike** → each **Yes** token redeems for **$1.00 USDC**, **No** = $0.
- Closing price **< strike** → each **No** token redeems for **$1.00 USDC**, **Yes** = $0.

The design north star is **non-custodial by construction**: USDC collateral lives
in a Program Derived Address (PDA) vault that can only release funds according to
on-chain rules. No human or service ever holds your money — correctness is enforced
by code and math, not by trust in an operator.

---

## Find your way around

New here? These are the doors in, roughly in the order most people want them:

| If you want to… | Go to |
|---|---|
| **See it running** | [meridian.llmonster.dev](https://meridian.llmonster.dev) (live devnet demo) |
| **Run the whole thing locally in one command** | [Quick start](#quick-start) → `make dev` |
| **Understand the design and *why* each decision was made** | [`ARCHITECTURE.md`](ARCHITECTURE.md) |
| **Learn the underlying tech from scratch** (Solana, PDAs, SPL tokens, oracles) | [`RESEARCH.md`](RESEARCH.md) |
| **Read the on-chain program** | [`programs/meridian/src/`](programs/meridian/src/) · [instruction reference](#on-chain-instructions) |
| **Deploy to devnet yourself** | [`docs/devnet-deployment.md`](docs/devnet-deployment.md) (step-by-step runbook) |
| **See a real end-to-end run** (create→mint→trade→settle→redeem) | [`docs/devnet-lifecycle-run.md`](docs/devnet-lifecycle-run.md) (captured transcript + explorer links) |
| **Know how this was built** | [How this was built](#how-this-was-built) |
| **Browse every doc** | [Documentation map](#documentation-map) |

---

## How it works

A Meridian **contract** is a pair of complementary SPL tokens — **Yes** and **No** —
for one stock, one strike, one trading day. You acquire exposure in two ways:

- **Mint a pair** — deposit $1.00 USDC into the contract's vault and receive 1 Yes
  + 1 No token. (`Yes + No = $1.00`, always — that's the collateral.)
- **Trade on the order book** — each strike has exactly **one** on-chain order book:
  Yes tokens against USDC. Because selling a Yes is economically identical to buying
  a No, that single book serves all four user actions by flipping perspective:

  | You click… | Under the hood |
  |---|---|
  | **Buy Yes** | Buy Yes from the ask side |
  | **Sell Yes** | Sell Yes to the bid side |
  | **Buy No** | Mint a pair, immediately sell the Yes, keep the No — *one* transaction |
  | **Sell No** | Buy a Yes (so you hold Yes + No = a redeemable $1.00) |

  The frontend translates intent into the right book action; you just see four
  buttons. ([The full "one book, two perspectives" model](ARCHITECTURE.md#6-the-order-book--one-book-two-perspectives).)

After the 4:00 PM ET close the contract **settles** against the price oracle, the
winning side is fixed forever, and holders **redeem** winning tokens for $1.00 each.
A short off-chain **automation service** creates each day's markets in the morning
and triggers settlement after the close — but it can never touch your funds.

---

## System at a glance

| Part | Tech | Role |
|---|---|---|
| **On-chain program** | Rust + Anchor (Solana) | Mints, vault, order book, settlement, redemption — the source of truth |
| **Automation service** | TypeScript / Node.js | Triggers market creation (AM) and settlement (PM) on a schedule |
| **Frontend** | TypeScript + React (Next.js) | Wallet connection, trading UI, portfolio, the "four buttons, one book" UX |
| **Price oracle** | Pyth (+ admin-override fallback) | Brings real stock prices on-chain for settlement |

**Trust boundaries:** the program is the only thing that can move funds. Everything
else merely *requests* actions; the program validates and either executes or rejects.
The automation service holds an admin keypair for *permissioned* instructions
(create/settle) but **cannot** violate invariants or drain the vault — the PDA design
forbids it. The frontend holds nothing; your wallet signs every state-changing action.
([Component architecture](ARCHITECTURE.md#3-component-architecture) ·
[the six on-chain invariants](ARCHITECTURE.md#7-invariants-enforced-on-chain).)

---

## Quick start

### Prerequisites

- **Rust** — pinned by [`rust-toolchain.toml`](rust-toolchain.toml) (1.89.0, with
  `rustfmt` and `clippy`). Install [rustup](https://rustup.rs/); the toolchain is
  selected automatically in this directory.
- **Solana CLI + Anchor** — for `make dev`, deploying, and the validator-backed
  suites (`anchor build` / `solana-test-validator`). The Rust *unit* tests don't
  need them (they run in-process via LiteSVM). Versions: Solana CLI 3.1.x, Anchor
  CLI 1.0.2.
- **Node.js + Yarn** — for the off-chain workspaces, the `make dev` stack, and the
  deploy/lifecycle scripts. Node 20+ (22 works); Yarn 4 via `corepack enable`.

### One command: a full local stack

```bash
make dev    # build the program → boot a local validator → deploy → init Config + USDC →
            # create the day's markets → fund a demo wallet → write the frontend env
make demo   # run the lifecycle headless: create → mint → trade → settle → redeem
make stop   # tear it all down
make help   # list every target
```

`make dev` leaves a local validator running and writes `packages/web/.env.local`, so
the frontend talks to it immediately:

```bash
corepack yarn@4.10.2 workspace @meridian/web dev   # open the trading UI against your local stack
```

For the full local loop, cluster targeting, and troubleshooting, see
[`docs/local-development.md`](docs/local-development.md).

### Deploy to devnet

The same scripts deploy and run the lifecycle on real Solana **devnet** with your own
funded keypair. Follow the novice-friendly runbook,
**[`docs/devnet-deployment.md`](docs/devnet-deployment.md)**:

```bash
make deploy-devnet → bootstrap-devnet → create-markets-devnet → lifecycle-devnet
```

A transcript of an actual green devnet run — create → mint → trade → settle → redeem,
with the program id, market address, and explorer links — is checked in at
**[`docs/devnet-lifecycle-run.md`](docs/devnet-lifecycle-run.md)**.

### Run the tests

```bash
# Rust program tests (LiteSVM, in-process — no validator, no airdrop)
cargo test

# Rust format + lint
cargo fmt --all -- --check
cargo clippy --workspace --all-targets -- -D warnings

# Off-chain workspaces (SDK / automation / web) + prettier
corepack yarn@4.10.2 install
corepack yarn@4.10.2 lint
corepack yarn@4.10.2 test
```

> **Which Solana cluster do I need?** **None** for the day-to-day *unit* tests — they
> run in-process under [LiteSVM](https://github.com/LiteSVM/litesvm). `make dev`, the
> convergence suite, and the deploy scripts use a local `solana-test-validator` (or
> devnet). The [testing section](#testing) and
> [`docs/local-development.md`](docs/local-development.md) have the full breakdown.

### Autonomous trading bots (optional)

For liveliness you can run a fleet of LLM agents that trade on the platform — each with
its own funded wallet and OpenRouter model, narrating every decision to a log
(`make fund-traders` → `make bots`). Full guide:
[`packages/traders/README.md`](packages/traders/README.md).

---

## How this was built

Meridian was built **documentation-first**, with three layers of living documents that
acted as both the blueprint *and* the running record of progress. Each is checked into
the repo and stayed current as the code landed:

1. **Architecture** ([`ARCHITECTURE.md`](ARCHITECTURE.md)) — the design, written before
   the code, as a set of **decision records** (ADRs). Every major choice — Solana vs an
   EVM L2, building a minimal on-chain order book vs integrating one, Pyth vs other
   oracles, a plain Node scheduler vs a keeper network — is captured with its context,
   the alternatives considered, the decision, and the trade-offs accepted. When a
   decision changed during the build, the ADR changed with it, so the document always
   reflects the system as it actually is. A companion [`RESEARCH.md`](RESEARCH.md)
   backs the decisions with from-scratch background on the underlying technology.

2. **Roadmap** ([`docs/ROADMAP.md`](docs/ROADMAP.md)) — the architecture decomposed
   into a **dependency graph** of independently buildable pieces (F-01 … F-10), with an
   explicit critical path. The sequencing strategy was critical-path-first: scaffold
   the program, build the mint/redeem and order-book tracks in parallel, fold
   settlement on top, then fan out into the SDK → automation + frontend, converging on
   an end-to-end pass and one-command deployment. The riskiest unknown (devnet equity
   feeds) was deliberately de-risked early, *inside* the settlement piece, before any
   settlement logic was committed.

3. **Feature specs** ([`docs/features/`](docs/features/)) — one file per roadmap piece,
   each with a description, where it fits, its dependencies, and **acceptance
   criteria**. These were the unit of work: a feature was built test-first against its
   acceptance criteria on an isolated branch, reviewed, then merged. Each spec carries a
   **`Status` line that tracks its output** — the merge request, the decisions made
   while building it, and any deferrals (e.g. the devnet feed spike that needs live US
   market hours) — so the spec is also the audit trail of what shipped and why.

The flow, end to end: **brief → architecture (ADRs) → roadmap (dependency graph) →
feature specs (acceptance criteria) → test-first implementation → review → merge**,
with each layer kept alive as the source of truth for the layer below it. The result is
that *every* line of code traces back to a documented decision, and the documents you
read today match the system that runs.

A later quality pass is recorded the same way: read-only audit agents swept the codebase
for duplication, weak types, and dead code, writing their findings to
[`docs/refactor-audit/`](docs/refactor-audit/); the high-confidence fixes were then
applied behind a review gate.

---

## Repository layout

```
.
├── programs/meridian/        # The Anchor on-chain program (Rust)
│   ├── src/
│   │   ├── lib.rs            # Program entrypoints (instruction dispatch)
│   │   ├── instructions/     # One module per instruction (mint, redeem, order book, settle…)
│   │   ├── state.rs          # Config / Market / OrderBook account types
│   │   ├── constants.rs      # Frozen contract constants (units, PDA seeds, book size)
│   │   ├── oracle.rs         # Vendored Pyth PriceUpdateV2 parser (no SDK)
│   │   ├── error.rs          # Program error codes
│   │   └── events.rs         # Emitted events
│   └── tests/                # LiteSVM in-process test suite
├── packages/                 # Off-chain TypeScript workspaces (Yarn)
│   ├── sdk/                  # @meridian/sdk — typed client: builders, PDAs, intents, Pyth
│   ├── automation/          # @meridian/automation — scheduled morning/settlement jobs
│   ├── web/                 # @meridian/web — Next.js frontend (four-button trading UX)
│   ├── e2e/                 # @meridian/e2e — convergence suite vs a real validator
│   ├── ops/                 # @meridian/ops — deploy + lifecycle scripts (local & devnet)
│   └── traders/             # @meridian/traders — autonomous LLM trading bots (OpenRouter + LangGraph)
├── docs/
│   ├── ROADMAP.md           # Delivery plan, dependency graph, critical path
│   ├── features/            # One spec file per deliverable (F-01 … F-10)
│   ├── local-development.md # Local dev loop + the one-command `make dev` stack
│   ├── devnet-deployment.md # Step-by-step devnet deploy runbook (novice-friendly)
│   ├── devnet-lifecycle-run.md # Captured transcript of a real devnet lifecycle run
│   ├── cloudflare-pages.md  # Frontend hosting (static export → Cloudflare Pages)
│   └── refactor-audit/      # Read-only audit findings from the code-quality pass
├── migrations/deploy.ts     # Anchor deploy migration
├── scripts/                 # Spikes & utilities (e.g. devnet Pyth feed probe)
├── Makefile                 # One-command dev (`make dev`) + devnet (`make *-devnet`)
├── .env.example             # Every environment variable, documented, with placeholders
├── Anchor.toml              # Anchor provider/program config
├── Cargo.toml               # Rust workspace
├── rust-toolchain.toml      # Pinned Rust toolchain (1.89.0 + rustfmt + clippy)
├── ARCHITECTURE.md          # System design with decision records (ADRs)
└── RESEARCH.md              # Technology background for newcomers
```

---

## On-chain instructions

| Instruction | Auth | Purpose |
|---|---|---|
| `initialize_config` | admin | One-time global setup; creates the singleton `Config` PDA |
| `create_strike_market` | admin | Provision one stock-strike-day market: `Market` PDA, Yes/No mints, USDC vault |
| `add_strike` | admin | Add an extra strike for a stock intraday (reuses market provisioning) |
| `mint_pair` | user | Deposit $1.00 USDC, receive 1 Yes + 1 No token |
| `redeem` | user | Burn settled tokens for their payout (winning side pays $1.00 each) |
| `init_order_book` / `grow_order_book` | permissionless | Two-step creation of the bounded on-chain order book + escrow accounts |
| `place_order` | user | Post a limit/market order: cross resting opposite side (price-time priority), rest the remainder |
| `cancel_order` | user | Cancel a caller's own resting order and return its escrow |
| `match_orders` | permissionless | Crank: settle any crossed resting bid/ask pairs |
| `settle_market` | permissionless | After 4:00 PM ET: read Pyth, validate, write the immutable outcome (idempotent) |
| `admin_settle` | admin (time-delayed) | Fallback settlement when the oracle path can't run; admin supplies the closing price |
| `pause` / `unpause` | admin | Emergency stop for minting and trading |

See [`ARCHITECTURE.md` §5](ARCHITECTURE.md#5-smart-contract-instructions) for full
account contexts and [§7](ARCHITECTURE.md#7-invariants-enforced-on-chain) for the six
on-chain invariants these instructions preserve.

---

## Testing

The on-chain program has 96 tests across 11 files under `programs/meridian/tests/`,
covering every instruction, the settlement rules (at/above/below strike, stale and
wide-confidence oracle rejection), and the six invariants. Off-chain, each workspace
has its own suite — the SDK builders, the automation strike math and retry windows, and
the frontend's four-trade-path mapping, position guard, and P&L — and the full-stack
convergence run in [`packages/e2e`](packages/e2e/) exercises the entire lifecycle and
all four trade paths against a real validator.

```bash
cargo test                       # the on-chain program suite (in-process, no validator)
corepack yarn@4.10.2 test        # the off-chain workspaces
```

The full testing approach is in
[`ARCHITECTURE.md` §12](ARCHITECTURE.md#12-testing-strategy).

---

The committed program keypair makes the program ID
(`9R3jRbvh9jeQLGEggB3VXQTwj88YjUKqKM8x75SefGen`) reproducible across clones — it
identifies the on-chain program only, not a funded wallet. CI (Rust fmt/clippy/test +
the off-chain lint/typecheck/test sweep) runs on every push; the pipeline is defined in
[`.gitlab-ci.yml`](.gitlab-ci.yml).

---

## Documentation map

| Document | What's in it |
|---|---|
| [`ARCHITECTURE.md`](ARCHITECTURE.md) | System design, account/data model, instructions, invariants, sequence flows, decision records (ADRs), risks |
| [`RESEARCH.md`](RESEARCH.md) | Technology background (Solana, PDAs, SPL tokens, oracles) for newcomers |
| [`docs/ROADMAP.md`](docs/ROADMAP.md) | Delivery plan, dependency graph, critical path, cross-cutting contracts |
| [`docs/features/`](docs/features/) | One spec per deliverable (F-01 … F-10) with acceptance criteria and status |
| [`docs/local-development.md`](docs/local-development.md) | Local dev loop, the `make dev` stack, cluster targeting |
| [`docs/devnet-deployment.md`](docs/devnet-deployment.md) | Step-by-step devnet deploy runbook (novice-friendly) |
| [`docs/devnet-lifecycle-run.md`](docs/devnet-lifecycle-run.md) | Captured transcript of a real green devnet lifecycle run |
| [`docs/cloudflare-pages.md`](docs/cloudflare-pages.md) | Frontend hosting (static export → Cloudflare Pages) |
| [`docs/refactor-audit/`](docs/refactor-audit/) | Read-only findings from the code-quality audit pass |
| [`packages/traders/README.md`](packages/traders/README.md) | The autonomous LLM trading-bot fleet |

---

## Risks & limitations

This is a **technical demonstration on devnet** — no real funds, no mainnet. (See
[`ARCHITECTURE.md` §11](ARCHITECTURE.md#11-risks--limitations) for the full treatment.)

- **Devnet only** for this build; never mainnet or real money.
- **Demo-grade order book:** a bounded on-chain array caps resting orders per side; it
  is not tuned for high throughput (a production path would use a slab/heap structure).
- **Automation liveness:** a single off-chain scheduler is a single point of failure for
  *timing* (not for funds — the program enforces correctness on-chain). Settlement is
  idempotent and the admin override is the fallback if the service is down.
- **Oracle:** equity Pyth feeds only update during US market hours and have per-cluster
  feed ids; the time-delayed, admin-only `admin_settle` override is the guaranteed
  settlement fallback (and the default for the reproducible demo).
- **No KYC / custody / margin**, by design.
- **No regulatory or compliance claims** are made.
