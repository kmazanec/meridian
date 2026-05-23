# Meridian

> Binary stock-outcome markets on Solana. A non-custodial dApp where users trade
> **Yes/No** tokens on whether a MAG7 stock will close at or above a strike price
> today. Each contract pays **$1.00 USDC** to the winning side, and
> **`Yes + No = $1.00`** always.

Meridian is a same-day (0DTE) binary options market. The product question is
always:

> **"Will [STOCK] close at or above [STRIKE] today?"**

A user who thinks *yes* holds **Yes tokens**; a user who thinks *no* holds **No
tokens**. At 4:00 PM ET the market settles against an on-chain price oracle:

- Closing price **≥ strike** → each **Yes** token redeems for **$1.00 USDC**, **No** = $0.
- Closing price **< strike** → each **No** token redeems for **$1.00 USDC**, **Yes** = $0.

The design north star is **non-custodial by construction**: USDC collateral lives
in a Program Derived Address (PDA) vault that can only release funds according to
on-chain rules. No human or service ever holds user funds — correctness is
enforced by code and math, not by trust in an operator.

For the full design — every major decision *with its rationale* — see
[`ARCHITECTURE.md`](ARCHITECTURE.md). For a crypto-novice-friendly tour of the
underlying technologies (Solana accounts, PDAs, SPL tokens, oracles), see
[`RESEARCH.md`](RESEARCH.md).

---

## System at a glance

| Part | Tech | Role |
|---|---|---|
| **On-chain program** | Rust + Anchor (Solana) | Mints, vault, order book, settlement, redemption — the source of truth |
| **Automation service** | TypeScript / Node.js | Triggers market creation (AM) and settlement (PM) on a schedule |
| **Frontend** | TypeScript + React (Next.js) | Wallet connection, trading UI, portfolio, the "four buttons, one book" UX |
| **Price oracle** | Pyth (+ admin-override fallback) | Brings real stock prices on-chain for settlement |

**Trust boundaries:** the program is the only thing that can move funds.
Everything else merely *requests* actions; the program validates and either
executes or rejects. The automation service holds an admin keypair for
*permissioned* instructions (create/settle) but **cannot** violate invariants or
drain the vault — the PDA design forbids it. The frontend holds nothing; the
user's wallet signs every state-changing action.

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
│   ├── local-development.md # Local dev loop + the one-command `make dev` stack
│   ├── devnet-deployment.md # Step-by-step devnet deploy runbook (novice-friendly)
│   └── features/            # One spec file per deliverable (F-01 … F-10)
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
| `mint_pair` | user | Deposit $1.00 USDC, receive 1 Yes + 1 No token |
| `redeem` | user | Burn settled tokens for their payout (winning side pays $1.00 each) |
| `init_order_book` / `grow_order_book` | permissionless | Two-step creation of the bounded on-chain order book + escrow accounts |
| `place_order` | user | Post a limit/market order: cross resting opposite side (price-time priority), rest the remainder |
| `cancel_order` | user | Cancel a caller's own resting order and return its escrow |
| `match_orders` | permissionless | Crank: settle any crossed resting bid/ask pairs |
| `settle_market` | permissionless | After 4:00 PM ET: read Pyth, validate, write the immutable outcome (idempotent) |
| `admin_settle` | admin (time-delayed) | Fallback settlement when the oracle path can't run; admin supplies the closing price |

See [`ARCHITECTURE.md` §5](ARCHITECTURE.md) for full account contexts and the
six on-chain invariants these instructions preserve.

---

## Prerequisites

- **Rust** — pinned by [`rust-toolchain.toml`](rust-toolchain.toml) (1.89.0,
  with `rustfmt` and `clippy`). Install [rustup](https://rustup.rs/) and the
  toolchain is selected automatically in this directory.
- **Solana CLI + Anchor** — required for `make dev`, deploying, and the
  validator-backed suites (`anchor build` / `solana-test-validator`). The Rust
  unit tests alone don't need them (they run in-process via LiteSVM). Versions:
  Solana CLI 3.1.x, Anchor CLI 1.0.2.
- **Node.js + Yarn** — for the off-chain workspaces (`packages/*`), the
  `make dev` stack, and the deploy/lifecycle scripts. Node 20+ (22 works);
  Yarn 4 via `corepack enable`.

---

## Quick start

### One command: a full local stack

```bash
make dev    # build the program → boot a local validator → deploy → init Config + USDC →
            # create the day's markets → fund a demo wallet → write the frontend env
            # (SEED_DEMO_WALLET=1 also seeds fixed demo markets + pre-built positions)
make demo   # run the lifecycle headless: create → mint → trade → settle → redeem
make stop   # tear it all down
make help   # list every target
```

`make dev` leaves a local validator running and writes `packages/web/.env.local`, so the
frontend talks to it immediately:

```bash
corepack yarn@4.10.2 workspace @meridian/web dev   # open the trading UI against the local stack
```

### Autonomous trading bots

Spin up a fleet of LLM agents that trade on the platform — each with its own funded wallet and
OpenRouter model, making markets and taking edges, narrating every decision to a log:

```bash
make fund-traders                                  # fund trader{1..8}.json (SOL + mock USDC)
cp packages/traders/bots.config.example.json packages/traders/bots.config.json
RPC_URL=http://127.0.0.1:8899 OPENROUTER_API_KEY=sk-or-... make bots   # then: make bots-logs
```

Full guide (models, live-close strike seeding, devnet): [`packages/traders/README.md`](packages/traders/README.md)
and the "Trading bots" section of [`docs/local-development.md`](docs/local-development.md).

### Just the tests

```bash
# Rust program tests (LiteSVM, in-process — no validator, no airdrop)
cargo test

# Format + lint the Rust
cargo fmt --all -- --check
cargo clippy --workspace --all-targets -- -D warnings

# Off-chain workspaces (SDK / automation / web) + prettier
corepack yarn@4.10.2 install
corepack yarn@4.10.2 lint
corepack yarn@4.10.2 test
```

> **Which Solana cluster do I need?** **None** for the day-to-day *unit* tests — they run
> in-process under [LiteSVM](https://github.com/LiteSVM/litesvm). `make dev`, the convergence
> suite, and the deploy scripts use a local `solana-test-validator` (or devnet). See
> [`docs/local-development.md`](docs/local-development.md) for the full breakdown.

### Deploying to devnet

The same scripts deploy and run the lifecycle on real Solana **devnet** with your own funded
keypair. Follow the step-by-step, novice-friendly runbook:
**[`docs/devnet-deployment.md`](docs/devnet-deployment.md)** (`make deploy-devnet` →
`bootstrap-devnet` → `create-markets-devnet` → `lifecycle-devnet`).

### Building / deploying with Anchor

`anchor build`, `anchor test`, and `anchor deploy` read their provider settings
from [`Anchor.toml`](Anchor.toml) (`cluster = "localnet"`,
`wallet = "~/.config/solana/id.json"`), **not** from your CLI config. To deploy
elsewhere, override per command rather than switching your global CLI:

```bash
anchor deploy --provider.cluster devnet
```

The canonical program keypair (`target/deploy/meridian-keypair.json`) is
committed so the program ID
(`9R3jRbvh9jeQLGEggB3VXQTwj88YjUKqKM8x75SefGen`) is reproducible across clones.
It identifies the on-chain program only — it is **not** a funded wallet. Use a
separate, secret keypair for mainnet.

---

## Testing

The suite under `programs/meridian/tests/` (87 tests across 11 files) covers each
instruction plus the on-chain invariants:

| File | Focus |
|---|---|
| `test_initialize_config.rs` | Global config setup, re-init/authority rejection |
| `test_create_strike_market.rs` | Market + mints + vault provisioning |
| `test_mint_pair.rs` / `test_redeem.rs` | Mint/redeem flows and payouts |
| `test_order_book.rs` / `test_order_book_invariants.rs` | Resting, crossing, partial fills, capacity |
| `test_settlement.rs` / `test_admin_settle.rs` | Oracle + time-delayed admin settlement |
| `test_invariants.rs` / `test_contracts.rs` | Cross-cutting invariants and frozen contracts |

```bash
cargo test                 # everything
cargo test --test test_redeem    # a single test file
```

---

## Continuous integration

[`.gitlab-ci.yml`](.gitlab-ci.yml) runs on every push / merge request:

1. **build-program** — `cargo build-sbf` (produces `meridian.so`, passed forward as an
   artifact the Rust tests `include_bytes!`).
2. **fmt** — `cargo fmt --all -- --check`
3. **verify** — `cargo clippy --workspace --all-targets -- -D warnings` then `cargo test`.
4. **lint-ts** — prettier + each off-chain workspace's typecheck/build/tests: `@meridian/sdk`,
   `@meridian/automation`, `@meridian/web`, plus the `@meridian/e2e` and `@meridian/ops`
   typecheck + *pure contract tests*.

The validator-backed suites (the convergence run and the `@meridian/ops` reproducibility
test) need `solana-test-validator`, which the Node CI image lacks; they run locally / as
documented gates (see [`docs/local-development.md`](docs/local-development.md)). The Rust
jobs use the official Anchor image and rely on `rust-toolchain.toml` for the pinned compiler,
with the Cargo registry and `target/` cached between runs.

---

## Documentation map

| Document | What's in it |
|---|---|
| [`ARCHITECTURE.md`](ARCHITECTURE.md) | System design, account/data model, instructions, invariants, sequence flows, ADRs, risks |
| [`RESEARCH.md`](RESEARCH.md) | Technology background (Solana, PDAs, SPL tokens, oracles) for newcomers |
| [`docs/ROADMAP.md`](docs/ROADMAP.md) | Delivery plan, dependency graph, critical path, cross-cutting contracts |
| [`docs/local-development.md`](docs/local-development.md) | Local dev loop, the `make dev` stack, cluster targeting |
| [`docs/devnet-deployment.md`](docs/devnet-deployment.md) | Step-by-step devnet deploy runbook (novice-friendly) |
| [`docs/features/`](docs/features/) | One spec per deliverable (F-01 … F-10) with acceptance criteria |

---

## Risks & limitations

This is a **technical demonstration on devnet** — no real funds, no mainnet. (See
[`ARCHITECTURE.md` §11](ARCHITECTURE.md) for the full treatment.)

- **Devnet only** for the core submission; never mainnet or real money.
- **Demo-grade order book:** a bounded on-chain array caps resting orders per side; it is not
  tuned for high throughput (a production path would use a slab/heap structure).
- **Automation liveness:** a single off-chain scheduler is a single point of failure for
  *timing* (not for funds — the program enforces correctness on-chain). Settlement is
  idempotent and the admin override is the fallback if the service is down.
- **Oracle:** equity Pyth feeds only update during US market hours and have per-cluster feed
  ids; the time-delayed, admin-only `admin_settle` override is the guaranteed settlement
  fallback (and the default for the reproducible demo).
- **No KYC / custody / margin**, by design.
- **No regulatory or compliance claims** are made.

---

## Status

The full system is implemented and deployable end-to-end. The on-chain program — scaffold and
accounts (F-01), mint/redeem vault (F-02), order book & matching (F-03), settlement & oracle
(F-04), market admin (F-05) — plus the shared TS SDK (F-06), automation service (F-07),
frontend (F-08), cross-stack integration/E2E (F-09), and one-command + devnet deployment
(F-10) are landed and tested. Run it locally with `make dev`; deploy it to devnet with the
[devnet runbook](docs/devnet-deployment.md). The delivery plan is in
[`docs/ROADMAP.md`](docs/ROADMAP.md).
