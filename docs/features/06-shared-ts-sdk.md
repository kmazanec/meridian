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
- [x] **2. PDA derivation** — pure functions for every PDA (config, market, order_book,
  vault, mint_auth, yes/no mint, usdc/yes escrow) + ATA helpers + `Ticker` codec; verified
  against the accounts the program actually creates in LiteSVM and by direct seed-byte
  assertions for the market seed ordering.
- [x] **3. Instruction builders (full set) + LiteSVM harness** — one typed builder per
  program instruction (callers pass domain args, not addresses); each proven by a tx that
  succeeds against the real program in LiteSVM with the expected state effect; error
  surfacing tested (duplicate create, unauthorized admin).
- [x] **4. Reading helpers (both perspectives)** — typed account fetchers + Yes-view/No-view
  of the single book (No = `PRICE_SCALE − p` mirror, time priority preserved) + user
  balances and settled-market payout/PNL summary.
- [x] **5. Four-button intent translation** — one `buildTradeIntent(...)` API: BUY_YES→bid,
  SELL_YES→ask, BUY_NO→`mint_pair + sell Yes`, SELL_NO→`buy Yes`; unit-asserted ix mapping
  (the anti-drift contract test) + end-to-end BUY_NO/SELL_NO in LiteSVM.
- [x] **6. Pyth/Hermes helper** — `fetchPriceUpdate` / `postPriceUpdate` / `settleWithPyth`;
  unit + fixture-into-LiteSVM proves `settle_market` reads it; live devnet test
  skipped-by-default (env-gated).
- [x] **7. Public surface + consumability** — barrel export, `main`/`types`/`exports` map for
  Node and browser, declaration emit, `tsc --noEmit` green, import-surface test, README.
- [x] **8. Adversarial review + triage** — independent subagent (robustness/efficiency/
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

### Chunk 2 — PDA derivation + LiteSVM harness

- **`pdas.ts` mirrors `constants.rs` seed strings verbatim.** The trap the program docs
  call out is real: the mint-authority seed is **`"mint_auth"`**, not `"mint_authority"`.
  The market seed is `["market", ticker:u8, strike:u64 LE, trading_day:i64 LE]`; `i64le`
  uses two's-complement for negative timestamps to be faithful to the program's `i64`,
  though `trading_day` is normally positive.
- **Test runtime is litesvm `^0.8.0`, deliberately not `1.x`.** litesvm 1.x migrated its TS
  bindings to `@solana/kit` (web3.js v2) types (`Address`/`Transaction`/`EncodedAccount`),
  which would force a v1↔v2 bridge in every test (Anchor builds v1 `Transaction`s). litesvm
  0.8.x's bindings use web3.js **v1** directly, so Anchor instructions, signing, and account
  reads flow through with zero conversion glue. This is a *test-only* dependency choice; it
  does not affect the shipped SDK surface.
- **Strongest possible seed-contract test:** rather than asserting derivations against
  hard-coded addresses, the harness provisions a real market in LiteSVM
  (`create_strike_market` + `init_order_book` + `grow_order_book`) and the test asserts the
  SDK's independently-derived `vault`/`yes_mint`/`no_mint`/`order_book` equal the keys the
  *program itself* stored in the `Market` account, and that escrow PDAs exist and differ
  from the vault. If any seed drifts, this fails.
- **Config bootstrap is a test shim** (`harness.seedConfig`): it Anchor-encodes a `Config`
  and writes it directly with `setAccount`, exactly as the program's Rust tests do — because
  `initialize_config` requires a `program_data` upgrade-authority account that is awkward to
  stand up in LiteSVM, and that instruction is already covered by the program's own tests.
  Per-ticker test feed id is `[ticker_index; 32]`, matching the Rust shim so settlement
  tests line up.

### Chunk 3 — instruction builders

- **Builders use `.accountsStrict()`, not `.accounts()`.** Anchor's resolver-driven
  `.accounts()` types only let you pass the accounts it *cannot* itself derive, and its PDA
  resolution would re-derive seeds independently. Since the SDK already derives every PDA
  from the frozen seed contract, `.accountsStrict()` is the right call: it forces a complete,
  explicit account set wired by *our* derivations — no hidden resolver step that could drift
  from the program. The LiteSVM tests prove the strict set is correct against the real program.
- **`mint_pair` takes no amount** — each call mints exactly one $1.00 pair (`PAYOFF_UNIT` of
  each token for `PAYOFF_UNIT` USDC). Mint N pairs by sending N instructions. The builder
  doc says so explicitly to prevent a caller assuming an amount arg.
- **Finding → `createAtaIfNeeded` helper (consumer-facing).** `place_order` requires the
  taker's `user_yes`/`user_usdc` token accounts to *already exist* (no `init_if_needed`),
  unlike `mint_pair`. A buy that lands Yes into a non-existent ATA fails with
  `AccountNotInitialized (3012)`. The SDK exposes `createAtaIfNeeded(payer, owner, mint)` (an
  idempotent ATA-create) for callers to prepend; the four-button intent layer prepends these
  automatically. This is a real ergonomics gap the SDK closes for F-07/F-08.
- **Test-harness gotcha worth noting for F-09:** LiteSVM dedupes transactions by signature,
  so two *structurally identical* txs (e.g. re-posting the same order) need a fresh
  blockhash or the second silently fails with empty logs. The harness calls
  `expireBlockhash()` after every send. Any future TS test harness (F-09 E2E) must do the
  same.

### Chunk 4 — reading helpers (both perspectives)

- **The No book is a pure projection of the one Yes book, computed in `dualBook`.** Because
  `Yes + No = $1.00`: a Yes **bid** @ p maps to a No **ask** @ `1−p`; a Yes **ask** @ p maps
  to a No **bid** @ `1−p`; sizes are identical. So `no.bids` come from `yes.asks` (mirrored)
  and `no.asks` from `yes.bids` (mirrored). The test asserts the exact `1−p` mirror and the
  cross-perspective invariant (best Yes bid + best No ask = `PRICE_SCALE`). Consumers (F-08)
  render either side without re-deriving — the contract this feature exists to centralize.
- **Levels are aggregated** (price → summed size + order count), best-price-first per side,
  for direct order-book rendering.
- **Account fetchers use `program.account.*.fetchNullable`** (RPC) and normalize the Anchor
  enum/option shapes into clean TS (`Outcome`, `state`, `BN | null`). The dual-book and
  payout transforms are *pure* (book/market in, view out), so they are unit-tested directly
  against a book provisioned in LiteSVM — no RPC needed in tests.
- `payoutFor` encodes settled PNL: a winning token redeems for `PRICE_SCALE` (=$1.00) base
  units 1:1, a losing token $0; it throws on an unsettled market so callers can't mis-display
  a pending outcome as a payout.
- **Reinforced finding:** `place_order` requires `user_yes` *and* `user_usdc` to exist for
  *either* side (the accounts struct lists both unconditionally) — even a pure bid needs the
  Yes account present. The harness gained `ensureUserAtas`; consumers use `createAtaIfNeeded`
  (and the intent layer prepends them).

### Chunk 5 — four-button intent translation (cross-cutting UX contract)

- **`buildTradeIntent` is the single source of the mapping** (ROADMAP concern #5;
  ARCHITECTURE §6/§8.2): BUY_YES→bid@p; SELL_YES→ask@p; BUY_NO→`mint_pair` + sell Yes
  ask@`1−p` (keep the No); SELL_NO→buy Yes bid@`1−p`. For No actions the caller passes the
  **No** price and the module reflects it (`reflectPrice = PRICE_SCALE − p`, its own inverse).
  F-08 must call this, never re-derive it.
- **It returns an ordered instruction list for one transaction (one wallet approval)** and
  prepends idempotent ATA-creates so the order legs don't trip the `AccountNotInitialized`
  precondition. `BuiltIntent` also reports the resolved `bookSide`, `yesPrice`, and
  `mintPairs` count for display/inspection.
- **BUY_NO size must be a whole multiple of `PAYOFF_UNIT`** (whole tokens). `mint_pair`
  issues 1.0 Yes + 1.0 No per call and the Yes is sold in full; a fractional No would strand
  Yes. The builder throws on a non-multiple rather than silently leaving dust — a deliberate,
  documented constraint of the mint mechanic, surfaced to the caller.
- **Crossing counterparties stay caller-supplied.** When an order is marketable it must list
  the resting makers' payout accounts in `remaining_accounts`; the intent can't know these
  without the live book, so `TradeIntent.makerAccounts` is an optional passthrough the caller
  computes from `reads.dualBook`/`fetchOrderBook`. This keeps the intent layer book-agnostic
  while still supporting marketable orders.
- **Contract test asserts the *encoded bytes*** of each leg (decoded via the program's own
  instruction coder), and an end-to-end LiteSVM test proves BUY_NO leaves the trader holding
  exactly No (Yes sold) and SELL_NO nets a Yes (closing the No exposure).

### Chunk 6 — Pyth/Hermes helper

- **The Pyth SDKs are *optional peer dependencies*, imported lazily.** `@pythnetwork/
  hermes-client` and `@pythnetwork/pyth-solana-receiver` are heavy and (in this dep tree)
  fragile — hermes-client needs `axios`, and pyth-solana-receiver hits an `rpc-websockets`
  exports clash with web3.js 1.98. Forcing them on every consumer (and into a browser
  bundle that may never settle) is wrong, so `fetchPriceUpdate`/`postPriceUpdate`/
  `settleWithPyth` `await import(...)` them on first call and throw a clear "install the
  optional peer dep" message if absent. The constants and the fixture builder are
  dependency-free and always available.
- **`buildPriceUpdateV2` is a first-class SDK export, not just a test helper.** It emits the
  exact `PriceUpdateV2` borsh bytes the Receiver writes and `oracle.rs` parses (discriminator,
  variable-length verification tag, the `PriceFeedMessage` fields). Tests inject it into
  LiteSVM (owned by the Receiver program id) to prove `settle_market` reads an SDK-built
  update and writes the right outcome — and rejects a wrong-feed and a Partial-verification
  update. It is also useful to F-09/the demo for proving settlement against crypto-feed
  stand-ins without market hours.
- **Live devnet round-trip is deferred per plan** to an env-gated (`PYTH_LIVE=1`),
  skipped-by-default test, since it needs a funded keypair, an RPC, the optional deps, and
  (for equities) US market hours — the same constraints the F-04 spike script documents.
  The hermetic fixture path is what proves the on-chain contract here.

### Chunk 7 — public surface + consumability

- **Dual CJS + ESM, loadable under raw Node and bundlers.** `tsc` emits both; a post-build
  `finalize-dist.mjs` (a) writes `{"type":"commonjs"}` / `{"type":"module"}` markers into
  each output dir and (b) rewrites the ESM output's relative imports to carry explicit
  `.js` extensions (and `./idl` → `./idl/index.js`), which raw Node ESM requires but TS's
  classic resolution doesn't emit. Verified: both `require()` and `import()` load 70 exports
  under Node.
- **The IDL is embedded as a TS object, not a `.json` import.** Importing JSON as an ES
  module needs import attributes (`with { type: "json" }`) that vary by Node version and
  bundler; embedding it (`meridian-idl.ts`, generated by `gen-idl-module.mjs`) sidesteps that
  so the package loads identically everywhere. The canonical `meridian.json` is still
  vendored and reviewed; the generator turns it into the TS module.
- **`package.json` `exports`** maps `.` and a `./pyth` subpath (types/import/require each),
  with `main`/`module`/`types` for older resolvers.
- **`surface.test.ts` locks the public API** F-07/F-08 import (a rename/drop fails the test)
  and asserts the **Pyth peer deps don't load at import time** — only when a network helper
  is actually called — so a non-settling consumer/browser bundle stays lean.
- **Cross-cutting propagation (CI note #9):** the off-chain workspace + committed `yarn.lock`
  resolves the open item in `.gitlab-ci.yml`. After rebasing onto main (which had moved CI to
  a shell-executor `run_in_docker` pattern, a `build-program` job that emits
  `target/deploy/meridian.so` as an artifact, and a consolidated `verify` job replacing the
  separate `clippy`+`test` so the host-target workspace compiles once), the `lint-ts` job now
  does a real `corepack yarn@4.10.2 install --immutable` (Berry's frozen-lockfile) and runs
  `yarn lint` + `yarn workspace @meridian/sdk typecheck` + `yarn workspace @meridian/sdk test`
  **in one job** — so the workspace install (and node_modules link) happens exactly once per
  pipeline, no duplicate/uncached install. It consumes `build-program`'s `.so` (so the LiteSVM
  suite runs in CI, no Solana toolchain in the Node image) — F-06's tests are wired into CI
  now, not deferred to F-10. yarn is invoked via `corepack yarn@<ver>` (no global shim) with
  the download cache pinned inside the project dir for the non-root container mapping. The job
  lives in the `check` stage (main folded the `test` stage away); ordering after the build is
  enforced by `needs`, not the stage.

### Chunk 8 — adversarial review

An independent review subagent attacked the SDK for robustness, efficiency, and security.
**High and medium findings were fixed; tests were added for the fixed behavior. The full
suite is green (110 passing, 1 pending live-devnet).** Summary of what changed:

- **H-1 — negative/garbage reflected prices.** `reflectPrice` (intent) and `complementPrice`
  (reads) computed `PRICE_SCALE − p` with no guard, so a No price > `PRICE_SCALE` produced a
  negative BN that would serialize as a garbage `u64` order price. Both now reject prices
  outside `[0, PRICE_SCALE]`. Tested.
- **H-2 — `skipPreflight: true` on the settlement path.** `postPriceUpdate` and
  `settleWithPyth` submitted blind, hiding simulation failures and leaving the caller unable
  to tell a successful settle from a failed one. Preflight is now ON by default
  (`postPriceUpdate` exposes an opt-out for known-flaky RPCs).
- **H-3 — unfaithful Partial fixture.** `buildPriceUpdateV2`'s Partial path hardcoded
  `num_signatures = 0` (a real Receiver never posts a zero-guardian Partial). Now a
  `numSignatures` param, defaulting to 5 (matching the program's own fixtures).
- **M-1 — duplicated No-side aggregation.** `dualBook` had a second `collapse` path for the
  No view that could drift from `aggregate`. Refactored: the No side mirrors each order
  (`1 − price`, side flipped, seq preserved) and goes through the *same* `aggregate`.
- **M-2 — no client-side order validation.** `placeOrder` now validates `size > 0` and limit
  `price ∈ [1, PRICE_SCALE]` before building (mirrors the program), failing fast instead of
  wasting a round-trip. Tested (incl. price-0 allowed for market orders).
- **M-3 — opaque post errors.** `postPriceUpdate` now resolves/validates the price-update
  account before sending and gives a clearer error than a later on-chain `WrongFeed`.
- **M-4 — unbounded BUY_NO mint loop.** A large BUY_NO emitted N `mint_pair` ixs in one
  transaction, blowing the size/compute limits. Capped at `MAX_BUY_NO_MINT_PAIRS = 6` with a
  "split across transactions" error. Tested.
- **M-5 — BigInt parse on Hermes data.** `fetchPriceUpdate` now guards the `price`/`conf`
  string→BigInt conversion with a clear error instead of a raw `SyntaxError`, and null-checks
  `res.binary`.
- **M-6 — ESM import-rewrite regex.** The `finalize-dist.mjs` rewrite is textual; documented
  the (verified) assumption that tsc output contains no string literals that look like
  relative import specifiers, with guidance to switch to an AST rewriter if that changes.
- **L-4 (fixed though low) — test feed-id sentinel.** The harness seeded ticker 0 (Aapl) with
  an all-zero feed id, which the program rejects as the unconfigured-slot sentinel — so no
  ticker-0 market could ever settle in tests. Harness now uses `[i+1; 32]` (kept in lockstep
  with `Harness.feedId`).
- **L-5 (fixed though low) — `payoutFor` defensive check.** Now throws on the inconsistent
  "settled but `settlementPrice === null`" state instead of silently returning a payout.

**Low-severity findings recorded for your decision (not actioned):**

- **L-1:** the `dualBook` direction comment was flagged but is correct — no change needed
  (noted for completeness).
- **L-2:** `ORDERBOOK_N = 128` is a hardcoded TS constant (it isn't a program `#[constant]`,
  so it can't be IDL-derived). Could add a CI/test assertion that reads the on-chain
  `OrderBook` account size and checks it against `ORDERBOOK_N` so the two can't silently
  diverge. Deferred — low value until the cap is actually tuned.
- **L-3:** `fetchUserPosition` issues three parallel `getAccountInfo` RPCs rather than one
  `getMultipleAccountsInfo`. Functionally correct; batching would give a single-slot snapshot
  and one fewer failure point. Worth doing if F-08 reads positions on a hot path.
