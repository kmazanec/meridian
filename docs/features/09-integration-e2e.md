# Feature: Integration & E2E

**ID:** F-09 · **Roadmap piece:** F-09 · **Status:** In progress

## Description

This delivers the cross-stack integration and end-to-end test suite that proves the
whole system works together: the full daily lifecycle (create → mint → trade → settle
→ redeem), all four trade paths (Buy Yes, Buy No, Sell Yes, Sell No), and a
multi-user scenario (one user mints and quotes, another takes, both redeem). It
verifies the on-chain invariants hold across the integrated stack.

It exists because the parallel tracks (program features, SDK, automation, frontend)
must re-synchronize, and the brief's success criteria are end-to-end behaviors. This
is the convergence point where interface mismatches surface.

## How it fits the roadmap

Wave 5, the re-synchronization point on the critical path. It depends on essentially
everything and is the highest-coordination moment in the plan. It unblocks deployment
(F-10).

## Dependencies (must exist before this starts)

- **F-02, F-03, F-04, F-05** — the complete on-chain instruction set.
- **F-06 Shared TS SDK** — the client used to drive the lifecycle.
- **F-07 Automation service** — the scheduled create/settle legs.
- **F-08 Frontend** — the user-facing lifecycle and trade paths.

## Unblocks (what waits on this)

- **F-10 Deployment & reproducibility** — packages and scripts the verified lifecycle
  for one-command devnet runs.

## Acceptance criteria

- The full lifecycle passes end-to-end on a test validator and/or devnet:
  create market → mint pair → trade on the order book → settle via oracle → redeem.
- All four trade paths function on the one order book: Buy Yes, Buy No (mint + sell
  Yes), Sell Yes, Sell No (buy Yes).
- The multi-user scenario passes: a maker mints and posts quotes, a taker fills, the
  market settles, and both parties redeem to the correct USDC amounts.
- All on-chain invariants hold across the integrated run: collateralization, payout
  completeness, token provenance, settlement immutability, settlement timing, oracle
  quality (ARCHITECTURE.md §7).
- Settlement executes correctly within 10 minutes of market close in the scenario
  (using the chosen devnet oracle path or the documented fallback).
- Interface mismatches between program, SDK, automation, and frontend are resolved;
  any cross-cutting contract changes are propagated back to ROADMAP.md/ARCHITECTURE.md.

## Testing requirements

- Integration/E2E tests covering: the full lifecycle; each of the four trade paths;
  the multi-user scenario; invariant assertions after each phase.
- Tests must run against a real environment (local validator and/or devnet), not just
  mocks, and must cover the architecture's named risks (oracle staleness/confidence,
  partial fills, at-strike boundary).

## Manual setup required

- A configured devnet (or local validator) environment with funded keypairs and test
  USDC; for the oracle leg, whatever the F-04 spike concluded (live devnet feeds
  during market hours, or the fallback path).

## Build plan (approved)

Delivered as a new private workspace package **`@meridian/e2e`** (`packages/e2e`) — the
convergence suite that uses `@meridian/sdk` (and `@meridian/automation`) to drive a
**real `solana-test-validator`** end-to-end. A new package because the SDK's `Harness`
is LiteSVM-only (no `getProgramAccounts`, native leak, skipped in CI) and F-09 needs a
real validator + must import both sdk and automation. Test runner: ts-mocha (matches
sdk/automation).

**Decisions taken with the user:** (1) deterministic suite vs a local validator, plus an
opt-in env-gated live-devnet settlement smoke test (real Pyth Hermes→Receiver path);
(2) suite shape = TS driving a real validator, reusing the F-08 localnet harness pattern.

- [x] **Chunk 1 — Scaffold + local-validator harness.** `packages/e2e` package.json/
  tsconfig; `src/localValidator.ts` (boot validator, upgradeable deploy so ProgramData
  exists, `MERIDIAN_SO`/program-keypair overrides, `describeOnValidator` skip-guard,
  teardown); `src/fixture.ts` (bootstrap config+USDC, createMarket, newUser, mintPairs,
  trade, settleAdmin, invariant-assert helpers); `src/crossing.ts` (maker-account +
  four-button mapping); smoke `tests/harness.test.ts`. **Green: 3 passing.**
- [x] **Chunk 2 — Full lifecycle.** `tests/lifecycle.test.ts`: create→mint→place+match
  crossing→settle→redeem; invariants asserted after each phase. (AC#1, AC#4)
  **Green: 1 passing.**
- [x] **Chunk 3 — Four trade paths.** `tests/trade-paths.test.ts`: Buy/Sell Yes, Buy/Sell
  No via `buildTradeIntent` vs maker liquidity; partial-fill + at-strike boundary. (AC#2)
  **Green: 6 passing.**
- [ ] **Chunk 4 — Multi-user.** `tests/multi-user.test.ts`: maker mints+quotes, taker
  fills, settle, both redeem correctly; collateralization across both + vault drains. (AC#3,#4,#5)
- [ ] **Chunk 5 — Automation vs real validator.** `tests/automation.test.ts`:
  `runMorningJob` (Mock price → strikes → provision via real `RpcChainClient`) then
  `runSettlementJob` (discovery + injected settler); created/settled counts + outcomes. (AC#6,#5)
- [ ] **Chunk 6 — Live-devnet settle smoke (opt-in).** `tests/devnet-settle.smoke.test.ts`:
  env-gated real Hermes→Receiver→`settleMarket`; skipped without creds/market-hours;
  fallback ladder documented. (AC#5)
- [ ] **Chunk 7 — Wiring + docs.** Workspace wiring; keep validator suite out of the
  Node-only CI `lint-ts` job (mirror Playwright); note in `.gitlab-ci.yml` + docs.
- [ ] **Adversarial review** — robustness/efficiency/security-integrity; fix high/medium.
- [ ] **Rebase, push, open MR.**

## Cross-cutting contracts obeyed

Fixed-point/units (PAYOFF_UNIT=PRICE_SCALE=1e6, no floats; SDK constants), frozen PDA
seeds (SDK derivation only), IDL-as-interface (no hand-rolled serialization),
four-buttons→one-book in the SDK (`buildTradeIntent`, not reimplemented), settlement
timing (`trading_day` = 4:00 PM ET close instant; gate `now >= trading_day`). Any
mismatch forcing a contract change is fixed at source and propagated to
ROADMAP.md/ARCHITECTURE.md, not patched locally.

## Implementation notes (filled in by the building agent)

> Decisions and rationale recorded as the build progresses.

- **New `@meridian/e2e` workspace package** (private, no build/publish, ts-mocha runner)
  is the home for the convergence suite. Reasons: (a) the SDK's `Harness` is LiteSVM-only
  (no real `getProgramAccounts`, native-memory leak → skipped in CI) and F-09 needs a
  *real* validator so discovery, ATAs, and the automation `RpcChainClient` run for real;
  (b) F-09 is the only place that imports **both** sdk and automation. Test timeout is
  600s (a validator boot + upgradeable deploy is tens of seconds).

- **Local settlement uses `admin_settle`, not `settle_market`.** The program's
  `settle_market` requires the price-update account to be **owned by the Pyth Receiver
  program** (`rec5EK…`). On a fresh local validator the Receiver isn't deployed, and a
  live validator has no `set_account` RPC to forge a Receiver-*owned* data account
  (only the owning program may write an account's data after creation). The real
  Hermes→Receiver→`settle_market` pull-oracle path is therefore exercised in the opt-in
  **devnet** smoke test (Chunk 6), where the Receiver is actually deployed. The on-chain
  oracle parsing/staleness/confidence checks are already proven by the program's Rust
  LiteSVM tests (`test_settlement.rs`, `test_invariants.rs` real-`settle_market` sweep);
  F-09's job is cross-stack convergence, and `admin_settle` gives deterministic,
  time-gated settlement to drive the integrated lifecycle. The settlement-timing
  invariant (#5) is still asserted (admin delay enforced).

- **Worktree `target/`:** this branch is built in a git worktree whose `target/` is
  empty; the harness honors `MERIDIAN_SO` / `MERIDIAN_PROGRAM_KEYPAIR` env overrides to
  point at a `.so` built in the main checkout for the same program source.

### Convergence findings (surfaced by the integrated run)

- **Raw `placeOrder` requires the caller's Yes ATA to already exist — on *both* sides.**
  `place_order` wires `user_yes` for every order (an ask escrows Yes; a bid *receives*
  Yes when it fills), so a fresh account that hasn't minted yet hits
  `AccountNotInitialized` (0xbc4) whether it's resting a bid or an ask. Only the SDK's
  `buildTradeIntent` prepends the idempotent ATA-creation; callers using the low-level
  builder directly must create it themselves (the frontend always goes through
  `buildTradeIntent`, so it is unaffected). This is a *usage* contract, not a bug —
  documented here and handled in the suite by prepending `createAtaIfNeeded` (the same
  instruction the intent uses). No source change.
