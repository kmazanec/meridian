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
│   └── tests/                # LiteSVM in-process test suite (87 tests)
├── docs/
│   ├── ROADMAP.md            # Delivery plan, dependency graph, critical path
│   ├── local-development.md  # Which Solana cluster you need (spoiler: none)
│   └── features/             # One spec file per deliverable (F-01 … F-10)
├── migrations/deploy.ts      # Anchor deploy migration
├── scripts/                  # Spikes & utilities (e.g. devnet Pyth feed probe)
├── Anchor.toml               # Anchor provider/program config
├── Cargo.toml                # Rust workspace
├── rust-toolchain.toml       # Pinned Rust toolchain (1.89.0 + rustfmt + clippy)
├── ARCHITECTURE.md           # System design with decision records (ADRs)
└── RESEARCH.md               # Technology background for newcomers
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
- **(Optional) Solana CLI + Anchor** — only needed for `anchor build` /
  `anchor deploy` against a validator. This project currently develops and tests
  entirely in-process via LiteSVM, so neither is required to run the test suite.
  When you do need them: Solana CLI 3.1.x and Anchor CLI 1.0.2.
- **(Optional) Node.js + Yarn** — only for linting the TypeScript
  (`migrations/`, `scripts/`).

---

## Quick start

```bash
# Run the full Rust test suite (LiteSVM, in-process — no validator, no airdrop)
cargo test

# Format and lint the Rust code
cargo fmt --all -- --check
cargo clippy --workspace --all-targets -- -D warnings

# Lint the TypeScript (optional)
yarn install
yarn lint
```

> **Which Solana cluster do I need?** **None** for the day-to-day loop. The unit
> and invariant tests run in-process under
> [LiteSVM](https://github.com/LiteSVM/litesvm) — there is no local validator to
> start and no airdrop to perform. See
> [`docs/local-development.md`](docs/local-development.md) for the full breakdown
> of what targets which cluster (and how to point the CLI at devnet for manual
> `solana` commands).

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

1. **fmt** — `cargo fmt --all -- --check`
2. **clippy** — `cargo clippy --workspace --all-targets -- -D warnings`
3. **test** — `cargo test` (the 87 LiteSVM tests)
4. **lint-ts** — `yarn lint` (prettier check on `migrations/` and `scripts/`)

The pipeline uses the official `rust` image and relies on `rust-toolchain.toml`
for the pinned compiler version, with the Cargo registry and `target/` cached
between runs.

---

## Documentation map

| Document | What's in it |
|---|---|
| [`ARCHITECTURE.md`](ARCHITECTURE.md) | System design, account/data model, instructions, invariants, sequence flows, ADRs, risks |
| [`RESEARCH.md`](RESEARCH.md) | Technology background (Solana, PDAs, SPL tokens, oracles) for newcomers |
| [`docs/ROADMAP.md`](docs/ROADMAP.md) | Delivery plan, dependency graph, critical path, cross-cutting contracts |
| [`docs/local-development.md`](docs/local-development.md) | Local dev loop, cluster targeting, devnet funding |
| [`docs/features/`](docs/features/) | One spec per deliverable (F-01 … F-10) with acceptance criteria |

---

## Status

The on-chain program is implemented through settlement: scaffold and accounts
(F-01), mint/redeem vault (F-02), order book & matching (F-03), and settlement &
oracle (F-04) are landed and tested. The shared TS SDK, automation service,
frontend, end-to-end integration, and one-command devnet deployment (F-06 … F-10)
are tracked in [`docs/ROADMAP.md`](docs/ROADMAP.md).
