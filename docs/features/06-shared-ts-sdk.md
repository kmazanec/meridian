# Feature: Shared TypeScript SDK

**ID:** F-06 · **Roadmap piece:** F-06 · **Status:** In progress

## Description

This delivers a shared TypeScript client library that both the automation service and
the frontend depend on. It wraps the program's IDL with typed instruction builders,
derives all PDAs from the frozen seed conventions, provides Pyth/Hermes helpers
(fetch a signed price update and post it on-chain via the Receiver), and implements
the "four buttons → one book" intent translation in one place (Buy No = mint_pair +
sell Yes; Sell No = buy Yes — ARCHITECTURE.md §6, §8.2).

It exists to prevent two downstream features (automation, frontend) from
independently hand-rolling chain-calling code and the trade-intent translation, which
would drift apart. The SDK is the single client interface to the program.

## How it fits the roadmap

Wave 3, on the critical path (F-04 → F-06 → F-08 → …) and the convergence funnel for
the off-chain world: both F-07 and F-08 wait on it. Its instruction-builder and
PDA-derivation surface should be treated as a frozen contract before F-09.

## Dependencies (must exist before this starts)

- **F-04 Settlement & oracle** — needs the complete instruction set (incl.
  settlement) and the Pyth price-update account model to wrap.
- **F-05 Market creation & admin** — needs the create/admin instructions to wrap.
- (Transitively requires F-01–F-03 via the compiled IDL.)

## Unblocks (what waits on this)

- **F-07 Automation service** — uses instruction builders (create/settle) and Pyth
  helpers to drive the AM/PM jobs.
- **F-08 Frontend** — uses instruction builders, PDA helpers, and the four-button
  translation to render trading and sign transactions.
- **F-09 Integration & E2E** — drives the lifecycle through the SDK.

## Acceptance criteria

- Every program instruction has a typed builder that produces a valid transaction
  against the deployed program (built from the IDL, not hand-rolled serialization).
- Every PDA (vault, mint authority, `Market`, `OrderBook`) can be derived from inputs
  using the exact seeds frozen in F-01.
- A Pyth helper fetches a fresh signed price update from Hermes and posts it via the
  Pyth Solana Receiver, returning the price-update account usable by `settle_market`.
- The four-button intent translation is exposed as a single API (Buy/Sell Yes/No →
  the correct on-chain action(s)), so consumers never re-implement it.
- Reading helpers expose order-book state in both perspectives (Yes and No) from the
  one underlying book, and current positions/balances.
- The library is consumable by both a Node.js service and a browser/React app.

## Testing requirements

- Unit/contract tests: each instruction builder produces a transaction that succeeds
  against a local validator; PDA derivations match on-chain expectations; the
  four-button translation maps each action to the correct instruction(s); the Pyth
  helper posts and yields a readable price update (against a local validator with a
  cloned/fixture Pyth account, or devnet).
- Tests must lock the SDK surface as the interface F-07/F-08 rely on.

## Manual setup required

- An RPC endpoint for the target cluster and (for the Pyth helper integration test) a
  funded keypair to post price updates on devnet.

## Implementation plan (approved)

Locked decisions (confirmed with the user before building):

- **Client lib:** `@anchor-lang/core@1.0.2` — already a declared dep, version-matched to
  `anchor-cli 1.0.2`, reads the new-format IDL natively, no codegen. Most literally
  satisfies the "built from the IDL, not hand-rolled serialization" criterion.
- **Test runtime:** `litesvm` (npm) in-process, loading the built `target/deploy/meridian.so`.
  Mirrors the program's existing Rust LiteSVM convention; no external validator daemon, so
  it runs in CI. Satisfies "succeeds against a local validator" hermetically.
- **Pyth helper:** unit-test the logic + build a `PriceUpdateV2` fixture posted into LiteSVM
  so `settle_market` consumes it. The live devnet Hermes→Receiver round-trip is deferred to
  an opt-in/manual test (needs a funded keypair + US market hours — see Manual setup).

Build chunks (test-first; each ends in a tickable item):

- [x] **1. Workspace + IDL plumbing** — yarn workspaces at root, committed `yarn.lock`,
  `packages/sdk` (`@meridian/sdk`) skeleton, vendored IDL + IDL type, `getProgram()` typed
  program factory, constants re-exported from the IDL.
- [ ] **2. PDA derivation** — pure functions for every PDA (config, market, order_book,
  vault, mint_auth, yes/no mint, usdc/yes escrow) + ATA helpers + `Ticker` codec; verified
  against the accounts the program actually creates in LiteSVM and by direct seed-byte
  assertions for the market seed ordering.
- [ ] **3. Instruction builders (full set) + LiteSVM harness** — one typed builder per
  program instruction (callers pass domain args, not addresses); each proven by a tx that
  succeeds against the real program in LiteSVM with the expected state effect; error
  surfacing tested (duplicate create, unauthorized admin).
- [ ] **4. Reading helpers (both perspectives)** — typed account fetchers + Yes-view/No-view
  of the single book (No = `PRICE_SCALE − p` mirror, time priority preserved) + user
  balances and settled-market payout/PNL summary.
- [ ] **5. Four-button intent translation** — one `buildTradeIntent(...)` API: BUY_YES→bid,
  SELL_YES→ask, BUY_NO→`mint_pair + sell Yes`, SELL_NO→`buy Yes`; unit-asserted ix mapping
  (the anti-drift contract test) + end-to-end BUY_NO/SELL_NO in LiteSVM.
- [ ] **6. Pyth/Hermes helper** — `fetchPriceUpdate` / `postPriceUpdate` / `settleWithPyth`;
  unit + fixture-into-LiteSVM proves `settle_market` reads it; live devnet test
  skipped-by-default (env-gated).
- [ ] **7. Public surface + consumability** — barrel export, `main`/`types`/`exports` map for
  Node and browser, declaration emit, `tsc --noEmit` green, import-surface test, README.
- [ ] **8. Adversarial review + triage** — independent subagent (robustness/efficiency/
  security); fix high/medium, re-run suite, record lows below.

## Implementation notes (filled in by the building agent)

> The agent implementing this feature records its implementation decisions and
> rationale here as it builds — chosen libraries/patterns within the architecture's
> constraints, trade-offs made, deviations from assumptions and why, and anything the
> next agent or the integrator needs to know. This section starts empty and is owned
> by the builder, not the planner. Cross-cutting discoveries that affect other
> features must also be propagated to ROADMAP.md or the architecture doc, not just
> left here.

### Chunk 1 — workspace + IDL plumbing

- **Client library:** `@anchor-lang/core@1.0.2` (the Anchor v1 TS client, version-matched
  to `anchor-cli 1.0.2`). It consumes the compiled IDL directly and exposes camelCase
  `program.methods.*` builders and a `program.account.*` coder, so instruction encoding is
  IDL-derived, never hand-rolled (the feature's first acceptance criterion). No Codama
  codegen step. Built on `@solana/web3.js` v1 (Anchor's peer); the bundle-size cost lands on
  the frontend (F-08) and can be revisited there.
- **IDL is vendored, not imported from `target/`.** `target/` is gitignored, so the package
  carries its own `src/idl/meridian.json` (runtime IDL) + `meridian-type.ts` (Anchor's
  generated camelCase type). `src/idl/index.ts` documents the three-line regenerate recipe.
  `idl.test.ts` asserts the program id and unit constants, so a stale vendored IDL trips a
  test rather than silently shipping wrong bytes.
- **Constants come from the IDL `constants` block**, parsed once in `constants.ts`
  (`PAYOFF_UNIT`/`PRICE_SCALE`/decimals). `ORDERBOOK_N` and `NUM_TICKERS` are not program
  `#[constant]`s (they size accounts / arg arrays), so they are mirrored as plain TS
  constants matching `constants.rs`.
- **Workspace / tooling:** root converted to yarn (Berry 4.10.2) workspaces (`packages/*`);
  this is the repo's first off-chain package. `.yarnrc.yml` sets `nodeLinker: node-modules`
  (litesvm ships a native `.node` addon and ts-mocha is most reliable with a real
  `node_modules`, not PnP). Because the worktree lives *under* the main repo dir, yarn
  needed a `yarn.lock` present to treat the worktree as its own project root — and the
  committed lockfile is exactly what CI note #9 asked for at F-06+ anyway.
