# Roadmap — Meridian

**Status:** draft · **Date:** 2026-05-20 · **Source:** [ARCHITECTURE.md](../ARCHITECTURE.md) · [RESEARCH.md](../RESEARCH.md)

## Overview

Meridian is a non-custodial Solana dApp for trading binary 0DTE stock-outcome
contracts (Yes/No SPL tokens, `Yes + No = $1.00`, on-chain CLOB, oracle settlement).
Delivery strategy in one line: **scaffold the program first, then build the
mint/redeem and order-book tracks in parallel, fold settlement (with the oracle
spike) on top, then build the shared TS SDK that fans out into the automation
service and frontend, converging on an end-to-end integration pass and a
one-command devnet deployment.**

Sequencing is **critical-path-first**: the longest chain
(scaffold → settlement → SDK → frontend → integration → deploy) drives the
schedule; everything else is arranged to run alongside it. The #1 risk (devnet
equity feeds) is de-risked *inside* the settlement feature as an early spike,
before any settlement logic is committed.

## Project Pieces

| ID | Piece | Purpose | Depends on | Unblocks | Parallel with |
|----|-------|---------|-----------|----------|---------------|
| F-01 | Program scaffold & accounts | Anchor program shell, `Config`/`Market`/`OrderBook` account types, PDAs, `initialize_config`, error/event scaffolding | — | F-02, F-03, F-05 | — |
| F-02 | Mint & redeem (vault) | `mint_pair`, `redeem`, PDA vault + mint authority, collateralization invariant | F-01 | F-04, F-09 | F-03, F-05 |
| F-03 | Order book & matching | `place_order`, `cancel_order`, `match_orders`; bounded on-chain book, price-time priority, partial fills | F-01 | F-09 | F-02, F-05 |
| F-04 | Settlement & oracle | `settle_market`, `admin_settle`, Pyth read (staleness/confidence), **devnet feed spike**, payout-completeness invariant | F-02 | F-06, F-09 | F-03, F-05 |
| F-05 | Market creation & admin | `create_strike_market`, `add_strike`, `pause`/`unpause`, strike algorithm on-chain bits | F-01 | F-06, F-09 | F-02, F-03, F-04 |
| F-06 | Shared TypeScript SDK | IDL-typed client, instruction builders, PDA derivation, Pyth/Hermes price-update helpers, "four buttons → one book" intent translation | F-04, F-05 | F-07, F-08, F-09 | — |
| F-07 | Automation service | Node.js AM job (create strikes) + PM job (settle), scheduler, market calendar, retry/backoff/alert | F-06 | F-09 | F-08 |
| F-08 | Frontend | Next.js: Landing/Markets/Trade/Portfolio/History, wallet adapter, order-book views, position-aware trade panel | F-06 | F-09 | F-07 |
| F-09 | Integration & E2E | Full lifecycle, all 4 trade paths, multi-user scenario, invariant verification across the stack | F-02, F-03, F-04, F-05, F-06, F-07, F-08 | F-10 | — |
| F-10 | Deployment & reproducibility | `make dev` one-command setup, devnet deploy + lifecycle scripts, `.env.example`, README | F-09 | — | — |

## Dependency Graph

```
                     ┌──────────────────────────┐
                     │ F-01 Scaffold & accounts │
                     └──────────┬───────────────┘
            ┌───────────────────┼───────────────────┬───────────────┐
            ▼                   ▼                   ▼               │
   ┌────────────────┐ ┌────────────────┐ ┌──────────────────────┐ │
   │ F-02 Mint/Redeem│ │ F-03 OrderBook │ │ F-05 Market creation │ │
   └───────┬─────────┘ └───────┬────────┘ └──────────┬───────────┘ │
           │                   │                     │             │
           ▼                   │                     │             │
   ┌────────────────┐          │                     │             │
   │ F-04 Settlement│          │                     │             │
   │   + Oracle     │          │                     │             │
   └───────┬────────┘          │                     │             │
           │   ┌───────────────┴─────────────────────┘             │
           └──▶│  (F-04 + F-05) ─▶ F-06 Shared TS SDK               │
               └───────────────┬──────────────┬────────────────────┘
                               ▼              ▼
                     ┌──────────────┐ ┌──────────────┐
                     │ F-07 Automation│ │ F-08 Frontend│
                     └───────┬────────┘ └──────┬───────┘
                             └───────┬─────────┘
   (F-02,F-03,F-04,F-05,F-06,F-07,F-08) all feed ▼
                          ┌──────────────────────────┐
                          │ F-09 Integration & E2E   │
                          └──────────┬───────────────┘
                                     ▼
                          ┌──────────────────────────┐
                          │ F-10 Deployment & repro  │
                          └──────────────────────────┘
```

The graph is a DAG (no cycles). The widest fan-out is right after F-01 (three
program tracks in parallel) and right after F-06 (automation + frontend in
parallel).

## Critical Path

```
F-01 → F-02 → F-04 → F-06 → F-08 → F-09 → F-10
(scaffold → mint/redeem → settlement+oracle → SDK → frontend → integration → deploy)
```

This is the longest chain and sets the minimum schedule. Notes:

- **F-04 (settlement) is the riskiest link** because it contains the devnet
  equity-feed spike (the project's #1 open question). Run that spike *first within
  F-04* so a "feeds aren't reliably on devnet" finding triggers the fallback
  (crypto-feed stand-ins / mocked oracle) before any settlement logic is built.
- **F-06 (SDK) is the convergence funnel** for the off-chain world: both F-07 and
  F-08 wait on it. Getting the SDK's instruction-builder and PDA-derivation
  contracts right early prevents rework in two downstream features at once.
- **F-09 (integration) is the re-synchronization point** where all parallel tracks
  weave back together. This is the highest-coordination moment: mismatches in
  account layouts, the "four buttons → one book" translation, or fixed-point/units
  between program and clients surface here. Mitigate by treating the IDL and the
  cross-cutting contracts (below) as frozen interfaces before F-09 starts.

Frontend (F-08) is chosen as the final pre-integration link over automation (F-07)
because the demo and most acceptance criteria are observed through the UI; F-07 runs
in parallel and is not on the longest chain.

## Parallelization Plan

**Wave 0 — Foundation (serial):**
- F-01 Program scaffold & accounts. *A fresh agent needs:* ARCHITECTURE.md §4–§5,
  Anchor toolchain. Nothing else exists yet.

**Wave 1 — Program tracks (parallel after F-01):**
- F-02 Mint & redeem · F-03 Order book & matching · F-05 Market creation & admin.
  *Each agent needs:* the merged F-01 account types and PDA conventions, plus the
  cross-cutting units/error contracts below.

**Wave 2 — Settlement (after F-02; parallel with remaining Wave 1 work):**
- F-04 Settlement & oracle. *Agent needs:* F-02's vault + `pairs_minted`, the oracle
  contract from ARCHITECTURE.md §10 ADR-004, and RESEARCH.md §2.5. Start with the
  devnet feed spike.

**Wave 3 — Off-chain (after F-04 + F-05 land the full instruction set):**
- F-06 Shared TS SDK (serial gate for the off-chain world). *Agent needs:* the
  built program IDL and frozen PDA-derivation rules.

**Wave 4 — Clients (parallel after F-06):**
- F-07 Automation service · F-08 Frontend. *Each agent needs:* the published SDK
  surface (typed instruction builders, PDA helpers, Pyth helpers) and the
  cross-cutting UX contract for the four-button translation.

**Wave 5 — Convergence (serial):**
- F-09 Integration & E2E, then F-10 Deployment & reproducibility.

## Cross-Cutting Concerns

These must be obeyed *consistently* across features. Source of truth as noted; do
not duplicate the rule into each feature — reference it.

1. **On-chain invariants.** Source: ARCHITECTURE.md §7. Every feature that touches
   funds/tokens (F-02, F-03, F-04, F-09) must preserve all six invariants. F-02 owns
   collateralization; F-04 owns payout-completeness; both must be re-verified in F-09.

2. **Fixed-point & units contract.** Source: ARCHITECTURE.md §14 Q2 + this doc.
   Rule: `strike` and `settlement_price` are integers; align with Pyth's
   `price × 10^exponent`. Order `price` is an integer in USDC-per-Yes within
   `[0, 1.00]` at a fixed scale. **The exact scale (decimals) must be fixed in F-01
   and consumed unchanged by F-02/F-03/F-04/F-06.** No floats anywhere on-chain or in
   serialized client math.

3. **Account & PDA derivation contract.** Source: ARCHITECTURE.md §4 + frozen in
   F-01. Seeds for the vault PDA, mint-authority PDA, `Market`, and `OrderBook` must
   be defined once in F-01 and reused verbatim by F-02–F-05 (on-chain) and F-06
   (client derivation). A change here is a breaking change for everything downstream.

4. **IDL as the client interface.** Source: the compiled Anchor program. F-06 wraps
   the IDL; F-07/F-08 consume only F-06, never hand-rolled serialization. The IDL is
   treated as frozen before F-09.

5. **"Four buttons → one book" UX translation.** Source: ARCHITECTURE.md §6 + §8.2.
   Rule: Buy No = mint_pair + sell Yes; Sell No = buy Yes. This intent translation
   lives in **F-06 (SDK)** so automation and frontend share one implementation;
   F-08 presents it but must not re-implement it.

6. **Position-constraint guardrail.** Source: ARCHITECTURE.md §10 ADR-006. Enforced
   client-side only (F-08), never on-chain. F-02/F-03 must *not* add on-chain
   prohibitions on holding both tokens.

7. **Oracle abstraction.** Source: ARCHITECTURE.md §10 ADR-004. Settlement reads
   through an oracle interface with a Pyth implementation and a time-delayed
   `admin_settle` fallback. F-04 owns the interface; F-06/F-07 own posting Hermes
   updates. The fallback must always keep the devnet demo runnable.

8. **Secrets handling.** Source: ARCHITECTURE.md §13. Secrets via env vars only;
   ship `.env.example` (F-10); never commit keys. The automation keypair (F-07) is
   loaded from env/KMS.

9. **Testing strategy.** Source: ARCHITECTURE.md §12. Each program feature ships unit
   tests for its instructions and the invariants it owns; F-09 owns cross-feature
   integration/E2E and the multi-user scenario. **Toolchain (set by F-01):**
   anchor-cli 1.0.1, solana 3.1.x, Rust pinned via `rust-toolchain.toml`. Unit tests
   use **LiteSVM in-process** (Rust); `Anchor.toml` opts out of the surfpool default
   (`[tooling] validator = "solana"`).

10. **Token dependency (discovered in F-01 — affects F-02).** F-01 needs no token
    CPIs and deliberately omits `anchor-spl`. When F-02 adds `anchor-spl`/SPL token
    deps, note that `anchor-spl 1.0.1` currently pulls `spl-token-2022-interface`,
    which **fails to compile** against this solana 3.x toolchain (a transitive
    `spl-pod`/`Into` ambiguity). F-02 must resolve this — pin compatible versions or
    use the slim `spl-token-interface` crate directly. Until resolved, the program
    validates mints with a lightweight owner check (see F-01).

## High-Level Acceptance Criteria

- **F-01:** Program builds and deploys to a local validator; `initialize_config`
  creates the singleton `Config`; account layouts and PDA seeds match §4 and are
  documented for downstream use.
- **F-02:** `mint_pair` deposits $1.00 USDC and issues 1 Yes + 1 No; `redeem` burns
  and pays out per outcome; vault balance equals `$1.00 × pairs_minted` after every
  operation.
- **F-03:** Limit and market orders rest/match by price-time priority with correct
  partial fills; token+USDC transfers settle atomically; book respects the bounded
  capacity gracefully.
- **F-04:** `settle_market` reads the oracle, enforces staleness + confidence +
  ≥4:00 PM ET timing, writes an immutable outcome; `admin_settle` enforces its time
  delay; devnet feed spike resolved with a documented decision.
- **F-05:** `create_strike_market` provisions mints/vault/order book for one
  stock-strike-day; `add_strike` and `pause`/`unpause` work under admin authority.
- **F-06:** A typed client can build/send every instruction and derive every PDA;
  Pyth/Hermes helpers post a price update; the four-button intent translation is
  exposed as a single API.
- **F-07:** AM job creates the day's strikes and PM job settles open contracts on
  schedule, with retry/backoff and admin alerting, honoring the market calendar.
- **F-08:** All five pages function; wallet connect + signing works; both order-book
  perspectives render; the trade panel enforces position constraints; portfolio P&L
  and redeem flow are correct.
- **F-09:** End-to-end create → mint → trade → settle → redeem passes on a test
  validator/devnet; all four trade paths and the multi-user scenario pass; all
  invariants hold.
- **F-10:** One command brings up the stack; documented scripts deploy and run the
  full lifecycle on devnet; `.env.example` present; README explains setup.
