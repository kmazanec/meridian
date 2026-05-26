# Feature: Automation Service

**ID:** F-07 · **Roadmap piece:** F-07 · **Status:** In review — [MR !7](https://labs.gauntletai.com/keithmazanec/meridian/-/merge_requests/7)

## Description

This delivers the off-chain Node.js/TypeScript service that drives Meridian's daily
lifecycle on US trading days: a **morning job** (~8:00 AM ET) that reads each stock's
previous close, computes the strikes (±3/6/9%, round to $10, dedupe), and calls
`create_strike_market` per strike; and a **settlement job** (~4:05 PM ET) that calls
`settle_market` for each open contract, retrying on wide oracle confidence every 30s
for up to 15 minutes before alerting the admin for manual override.

It exists because blockchains cannot self-trigger on a wall clock; something
off-chain must press the button on schedule. It is trust-minimized — it can only call
permissioned instructions and cannot violate on-chain invariants (ARCHITECTURE.md
ADR-005).

## How it fits the roadmap

Wave 4, parallel with the frontend (F-08). Off the single longest critical path
(frontend is the final pre-integration link), but required for F-09 integration.

## Dependencies (must exist before this starts)

- **F-06 Shared TS SDK** — uses the SDK's create/settle instruction builders and Pyth
  helpers; does not hand-roll chain calls.
- External: a price source for the previous close (oracle read or off-chain price
  API); a funded automation keypair (env/KMS).

## Unblocks (what waits on this)

- **F-09 Integration & E2E** — the scheduled create/settle legs and the multi-user
  lifecycle run through this service.

## Acceptance criteria

- The morning job reads the previous close per supported ticker, computes strikes per
  the documented algorithm (rounded to $10, deduplicated), and creates one market per
  strike; results are logged and failures alerted; retries use backoff.
- The settlement job settles every open contract after 4:00 PM ET; on wide-confidence
  it retries every 30s up to 15 minutes, then alerts the admin for `admin_settle`.
- The service encodes the US market calendar (no runs on weekends/holidays; handles
  half-days) and chooses a settlement price at/just-before 4:00 PM ET with a tight
  staleness window (ARCHITECTURE.md §11).
- Settlement calls are idempotent (safe to retry); the service never assumes
  privileged powers beyond the permissioned instructions.
- The automation keypair is loaded from an environment secret, never committed.
- Operations are observable (logs/alerts) so a failed run is visible.

## Testing requirements

- Unit tests: strike computation (incl. dedup and the AAPL-style collapse);
  market-calendar logic (weekend/holiday/half-day); retry/backoff and the
  wide-confidence retry-then-alert path; idempotent settle.
- Integration test: against a local validator/devnet, run the morning job to create
  markets and the settlement job to settle them, asserting on-chain state changes.
- Mock the external price source where needed; cover the failure → alert path.

## Manual setup required

- Provide a funded automation keypair via env var (and document where it goes in
  `.env.example`, owned by F-10). Provide credentials/endpoint for the previous-close
  price source if an external API is used. Configure the alert channel (e.g. a
  webhook) for failure notifications.

### Environment variables this service reads (for F-10's `.env.example`)

The single source of truth is `ENV_KEYS` in `packages/automation/src/config.ts`. Summary:

**Required:**
- `AUTOMATION_KEYPAIR` — the funded automation keypair *secret*, as a JSON byte array (the
  Solana CLI keypair file contents) **or** a base58 secret key. Never committed; mask it in
  CI. The keypair signs only permissioned instructions and pays fees (ADR-005).
- `RPC_URL` — the Solana RPC endpoint for the target cluster.
- `USDC_MINT` — the collateral mint pubkey (matches `Config.usdc_mint`).

**Optional:**
- `PRICE_SOURCE` — `mock` (default) or `pyth`.
- `MOCK_CLOSE_<SYMBOL>` (e.g. `MOCK_CLOSE_META=680`) — mock previous close in dollars
  (used by the mock source; lets the demo run without market hours).
- `FEED_<SYMBOL>` (e.g. `FEED_META=0x…`) — per-ticker Pyth hex feed id; required for the
  `pyth` source and the settlement path. Must equal `Config.tickers[].feed_id`.
- `TICKERS` — comma list of symbols to run (default all MAG7).
- `ALERT_WEBHOOK_URL` — failure alerts POST here (default: log-only).
- `HERMES_URL` — Pyth Hermes endpoint override.

The strike ladder always includes the at-the-money (rounded-close) strike alongside the
±3/6/9% legs — it is not configurable.

**Scheduling:** there is no resident scheduler. Run `meridian-run-morning` (~8 AM ET) and
`meridian-run-settlement` (~4:05 PM ET) from an external cron / systemd timer / CI schedule
(F-10's deployment layer). Each exits non-zero on a failed run so the scheduler can detect it.

## Implementation plan (approved)

Confirmed with the user before building:

- **Prev-close source:** a pluggable `PriceSource` interface — a Pyth/Hermes-backed impl
  + a deterministic mock, env-selectable. No new external EOD API; reuses the SDK's
  Hermes helpers and keeps the demo runnable without market hours.
- **Alerts:** generic webhook POST to a configurable URL; structured-log fallback when
  unset. Failure→alert path asserted via an in-memory spy.
- **Scheduler:** **CLI entrypoints only** (`run-morning`, `run-settlement`). No resident
  in-process cron — external cron / the F-10 deployment layer drives the schedule; these
  are the legs F-09 invokes.

New workspace package `packages/automation` (`@meridian/automation`), mirroring
`@meridian/sdk` conventions (TypeScript, ts-mocha + chai, `tsc --noEmit`, prettier via
root `yarn lint`). Consumes `@meridian/sdk` exclusively — never hand-rolls chain calls.

Build chunks (test-first; each ends in a tickable item):

- [x] **1. Workspace scaffold** — `packages/automation` wired into the yarn workspace;
  `@meridian/sdk` dep resolves; barrel `index.ts`; `tsc --noEmit` + import-surface smoke
  test green.
- [x] **2. Strike algorithm** (`strikes.ts`) — ±3/6/9% of prev close, round to nearest
  $10, dedupe, integer/fixed-point. Tests: META-style spread, AAPL-style collapse,
  optional rounded-close, no floats.
- [x] **3. Market calendar** (`calendar.ts`) — weekend/holiday/half-day; DST-aware ET→unix;
  `closeInstant()` = 4:00 PM ET (1:00 PM half-days) = `trading_day`. Tests across DST,
  holiday, half-day, weekend.
- [x] **4. PriceSource + Alerter + logger + retry** — interfaces + impls (Pyth + mock
  source; webhook + log alerter). Tests: mock close; webhook POST + log fallback; backoff
  math; the wide-confidence retry-every-30s-up-to-15min-then-alert loop (injected clock).
- [x] **5. Morning job** (`morningJob.ts` + provisioning) — per ticker: prev close →
  strikes → `createStrikeMarket` + `initOrderBook` + `growOrderBook`; logged, failures
  alerted, retries; skips when calendar says no session. Mocked-SDK contract test.
- [x] **6. Settlement job** (`settlementJob.ts`) — discover open markets past close →
  settle (idempotent no-op on re-settle); wide-confidence → retry loop → admin alert for
  `admin_settle`. Mocked-chain orchestration tests.
- [x] **7. CLI entrypoints + keypair/secret loading** (`bin/*`, `keypair.ts`, `config.ts`)
  — `run-morning`/`run-settlement` parse env, load the keypair from an env secret, exit
  non-zero on failure. Tests: rejects missing/empty secret; config validation. Document
  env vars for F-10's `.env.example`.
- [x] **8. Integration test (LiteSVM)** — load `meridian.so`, seed `Config`, run morning
  to create markets, run settlement (SDK `buildPriceUpdateV2` fixture) and assert markets
  go `Settled` with the expected outcome.
- [x] **9. CI wiring** — extend `.gitlab-ci.yml` `lint-ts` to typecheck + test
  `@meridian/automation` in the same Node job (F-06 pattern; consumes the `build-program`
  `.so`).
- [x] **10. Adversarial review + triage** — independent subagent (keypair handling,
  webhook SSRF/errors, retry/clock edges, calendar correctness, idempotency). Fixed
  H1 + M2–M5 (+ L1/L2); documented M1; recorded L3/L4/L6 below.

## Implementation notes (filled in by the building agent)

> The agent implementing this feature records its implementation decisions and
> rationale here as it builds — chosen libraries/patterns within the architecture's
> constraints, trade-offs made, deviations from assumptions and why, and anything the
> next agent or the integrator needs to know. This section starts empty and is owned
> by the builder, not the planner. Cross-cutting discoveries that affect other
> features must also be propagated to ROADMAP.md or the architecture doc, not just
> left here.

### Chunk 1 — workspace scaffold

- New workspace package `@meridian/automation` under `packages/automation`, mirroring
  `@meridian/sdk`'s tooling (TypeScript strict, ts-mocha + chai tests, `tsc --noEmit`
  typecheck, prettier via root `yarn lint`). It declares `@meridian/sdk` as a
  `workspace:^` dependency and consumes it for *all* chain interaction — no hand-rolled
  serialization or PDA derivation (ROADMAP concern #4).
- Pyth deps are inherited as **optional peer deps** (same as the SDK): the service only
  pulls them when the settlement path actually posts a Hermes update. They are also dev
  deps so the LiteSVM/integration tests can import them.
- The SDK must be built (`yarn workspace @meridian/sdk build`) before the automation
  package resolves `@meridian/sdk` (its `main` points at `dist/`). CI already builds it
  in the shared Node job; locally, build once.

### Chunk 2 — strike algorithm

- **All strike math is integer BN math on USDC base units (6 dp)** — the on-chain
  `Market.strike` scale, so a strike compares directly against `settlement_price`. No
  floats in any serialized value (ROADMAP concern #2). The previous close enters as base
  units; `dollarsToBaseUnits()` is the single quantization point if a source hands back a
  plain dollar `number`.
- **Algorithm:** ±3/6/9% (`STRIKE_OFFSET_BPS`) of the close, each rounded to the nearest
  $10 (midpoint rounds up), optional rounded-close, dedupe, ascending. Low-priced tickers
  collapse to fewer unique strikes (the AAPL case) naturally via the dedupe — verified by
  test. Any leg rounding to $0 (only possible near zero) is dropped, never emitted as a
  meaningless $0 strike.

### Chunk 3 — market calendar (DST-aware timing, off-chain per ADR-005)

- **No timezone library.** DST-correct ET→unix conversion is derived from the platform's
  IANA `America/New_York` zone via `Intl.DateTimeFormat` (built into Node, zero deps): the
  ET UTC offset for an instant is read live (`GMT-4`/`GMT-5`), so EDT/EST and any future
  rule change are handled without hand-coded transition rules. Holiday/weekend dates are
  computed in ET calendar terms so a run from any host timezone resolves the same session.
- **`closeInstant(date)` = `Market.trading_day`** — the 4:00 PM ET close instant as whole
  unix seconds (1:00 PM ET on half-days). This is the load-bearing cross-cutting value:
  the program gates `now >= trading_day` with a single integer compare (F-04 sub-contract).
  A single offset-correction step suffices because 13:00/16:00 ET never falls in the 2 AM
  DST transition window.
- **Holidays covered:** fixed-date (New Year, Juneteenth, Independence, Christmas) with
  Sat→Fri / Sun→Mon NYSE observance; floating (MLK, Presidents', Memorial, Labor,
  Thanksgiving); and Good Friday via a Gregorian-computus Easter calc. **Half-days:** the
  Friday after Thanksgiving, July 3, and Christmas Eve (the recurring three). The
  holiday/half-day table is computed, not a static list, but NYSE occasionally varies
  (one-off closures, ad-hoc half-days) — a documented, bounded demo limitation; the
  `admin_settle` fallback covers any mis-classified session.

### Chunk 4 — price source, alerter, logger, retry primitives

- **`PriceSource` interface** with `MockPriceSource` (deterministic configured map — the
  demo path that needs no market hours) and `PythPriceSource` (reuses the SDK's
  `fetchPriceUpdate` lazily; converts native-scale price → USDC base units with the *same*
  truncating integer math as the on-chain `oracle.rs::to_usdc_base_units`, so an off-chain
  strike lines up with what settlement computes). Env selects the impl. A real EOD equities
  API can drop in behind the same interface later.
- **`Alerter` interface** with `WebhookAlerter` (generic JSON POST — Slack/Discord/
  PagerDuty-compatible incoming webhook, with an `AbortController` timeout) and `LogAlerter`
  (the no-webhook fallback). `makeAlerter` picks webhook when a URL is set, else logs.
  **Alert delivery is best-effort:** a down/erroring webhook is logged and swallowed, never
  crashing the job (on-chain state is the source of truth; a missed alert is a monitoring
  gap, not a correctness bug). Every alert is *also* emitted as an ALERT-level log line so
  the signal survives a webhook outage.
- **`logger`** — tiny structured JSON-line logger with an injectable sink (tests capture
  lines; deployment redirects output) and an `alert` level.
- **`retry`** — `withBackoff` (exponential, bounded, for transient RPC failures) and
  `retryEvery` (fixed-interval within a time budget). The latter is the **wide-confidence
  settlement loop**: poll every 30s for up to 15 min, then throw `RetryGaveUp` (the caller
  alerts for `admin_settle`). Clock + sleep are injectable, so the loop is deterministic and
  instant under test.

### Chunk 5 — morning job + chain boundary

- **`ChainClient` boundary** (`chain.ts`): jobs build instructions with the SDK and hand
  them to a `ChainClient` to sign (with the automation keypair) and submit. `RpcChainClient`
  is the production transport (real `Connection`); the LiteSVM integration test supplies a
  tiny adapter implementing the same interface. Jobs depend on the interface, never a
  concrete transport — so they unit-test with a stub.
- **`MarketProvisioner`** (`markets.ts`, `SdkMarketProvisioner`): wraps the three-step
  tradeable-market flow — `create_strike_market` → `init_order_book` → `grow_order_book`
  (ROADMAP concern #3). It is **idempotent**: it skips the create when the `Market` already
  exists and skips book provisioning when `Market.order_book` is already wired, so re-running
  the morning job (a retry, or a second cron fire) is safe.
- **`runMorningJob`** never rejects on a single-strike failure: a ticker whose price can't be
  read, or a strike that fails to provision after backoff retries, is *alerted* and counted
  while the rest of the run continues. A non-session date (per the calendar) is a logged
  no-op unless an explicit `tradingDay` forces a run (a manual/CLI override). `trading_day`
  is the calendar's close instant unless supplied.
- The SDK-backed provisioner/discovery hit the live program, so they are proven by the
  LiteSVM integration test (chunk 8), not unit mocks; the orchestration logic is fully
  unit-tested against a recording stub.

### Chunk 6 — settlement job

- **`Settler` interface** returns a discriminated `SettleStatus` (`Settled` /
  `WideConfidence` / `Error`). `PythSettler` is the SDK-backed impl: it runs the pull-oracle
  path (`settleWithPyth` — Hermes fetch → Receiver post → permissionless `settle_market`)
  and **classifies the on-chain error**. Only `WideConfidence` is retryable; an
  already-settled race (`MarketSettled`) is mapped to success (idempotent); everything else
  (stale, wrong feed, RPC) is a hard error that alerts. Classification keys off the Anchor
  error *name* + `#[msg]` text, not the numeric code (which is offset by Anchor's 6000 base
  and brittle to reorderings).
- **`runSettlementJob`** discovers all `Market` accounts, then per market: skip if already
  settled (idempotent), skip if `trading_day` hasn't passed (avoid a guaranteed
  `TooEarlyToSettle` round-trip), else settle. On `WideConfidence` it runs the
  `retryEvery(30s, 15min)` loop; if the window exhausts (`RetryGaveUp`) it **alerts the admin
  to run `admin_settle`** — it never calls the privileged override itself (trust-minimized,
  human-in-the-loop). One market's failure never aborts the rest.
- **Trust boundary held:** the job's only chain write is the permissionless `settle_market`.
  The admin override is an alert, never an automatic privileged call.

### Chunk 7 — CLI entrypoints, keypair/secret loading, config

- **Keypair from an env secret only** (`AUTOMATION_KEYPAIR`): JSON byte array (Solana CLI
  format) or base58. The loader is strict — missing/empty/malformed/wrong-length throws a
  clear error; it **never reads a file path** (a path-looking value is a malformed secret).
  Verified end-to-end: `meridian-run-morning` with no secret exits 1 with a clear,
  non-leaking message.
- **`config.ts`** parses + validates all env into a typed `AutomationConfig`; `ENV_KEYS` is
  the documented contract for F-10's `.env.example` (mirrored in "Manual setup" above).
  Mock closes are parsed as exact dollar values into base units; the $10 strike snapping
  happens later in `computeStrikes`.
- **`runtime.ts`** wires config → concrete deps (connection, `RpcChainClient`, price source,
  provisioner/discovery, settler, alerter, logger). The `bin/*` entrypoints stay thin: parse
  env, build runtime, run once, **exit non-zero on a failed/alerting run** so an external
  scheduler detects it (the CLI-only scheduling decision — no resident cron here).

### Chunk 8 — LiteSVM integration test (real program)

- **Reads moved onto `ChainClient`.** `fetchMarket`/`listMarkets` are now part of the chain
  interface (not direct `program.account.*` calls), because the read path differs by
  transport: production uses RPC (`getProgramAccounts` + `getAccountInfo`), the in-process
  test uses LiteSVM's account store. `RpcChainClient` implements both via the SDK; the test
  supplies a `LiteSvmChainClient` over the SDK's `Harness`.
- The test runs the **real** `runMorningJob` + `runSettlementJob` (not mocks) against the
  compiled `meridian.so`: morning creates 6 META strikes (each Open with its order book
  wired), then settlement injects a `$700` `buildPriceUpdateV2` fixture per market (exactly
  as the SDK's own settlement test does) and asserts each lands `Settled` with the correct
  YesWins/NoWins outcome vs its strike, and that a **re-run is idempotent** (all skipped).
- **LiteSVM has no `getProgramAccounts`**, so the test adapter's `listMarkets` scans the
  addresses it provisioned; production discovery uses real RPC. The SDK harness is imported
  by relative path (`../../sdk/tests/harness`) since it is a test helper, not part of the
  SDK's published export map. The test needs `target/deploy/meridian.so` present (CI's
  `build-program` job provides it, as for the SDK's LiteSVM tests).

### Chunk 10 — adversarial review + triage

An independent review subagent attacked the service for robustness, efficiency, and security
(keypair handling, webhook SSRF, retry/clock edges, calendar correctness, settlement
classification, provisioning idempotency, the trust boundary). It confirmed the trust
boundary holds (the service only ever calls the permissionless `settle_market`; `admin_settle`
is only ever an *alert*, never an automatic call) and the keypair secret is never logged or
placed in any alert/log payload. **All high and medium findings were fixed; tests added.
Full suite green (96 passing).**

**Fixed:**
- **H1 — one wide-confidence market blocked all others for 15 min.** `runSettlementJob` was a
  sequential `for...await`, so a market parked in its 30s/15min retry window starved markets
  ready to settle now. Restructured into two **concurrent** phases: phase 1 attempts every
  due market once in parallel; phase 2 runs the wide-confidence retry loops in parallel.
  Tested: a stuck market no longer delays a ready one (it settles at virtual t=0).
- **M2 — wide-confidence classification depended on RPC returning program logs.** Some RPCs
  return only `custom program error: 0x…` with no name/msg, which would misclassify a
  retryable `WideConfidence` as a hard error and prematurely alert the admin. Added the Anchor
  numeric-code fallback (hex `0x1781` and `Error Number: 6017`), written specifically so a
  stray digit run (slot/timestamp) can't false-match. Tested both the logs-less hit and the
  no-false-match case.
- **M3 — provisioning was not race/retry-safe.** A concurrent runner or a confirmation-timeout
  retry could revert `MarketAlreadyExists` (or "already initialized" on the book steps),
  failing+alerting a market that is in fact provisioned. `provisionMarket` now swallows those
  "already done" reverts as idempotent no-ops (by name, msg, and code) while still propagating
  real errors (e.g. `Unauthorized`). Tested.
- **M4 — no off-chain feed-id validation.** `FEED_<SYMBOL>` is now validated as 32-byte hex at
  config load (catches a transposed/garbage id before it silently reads the wrong stock's
  prev-close — which the on-chain `WrongFeed` check does *not* protect). A `pyth` run with a
  missing feed for a run-ticker now fails fast at load (also resolves review L5). Tested.
- **M5 — webhook SSRF hardening.** `ALERT_WEBHOOK_URL` is now required to be http(s) and is
  refused if it points at loopback / private / link-local / cloud-metadata (`169.254.169.254`)
  hosts. (The URL is operator-supplied/trusted, so this is defense-in-depth.) Tested.
- **L1 (fixed, trivial) — `retryEvery` busy-loop on `intervalMs <= 0`.** Now throws on a
  non-positive interval instead of spinning. Tested.
- **L2 (fixed) — wide-confidence path double-cranked the market.** The retry loop now uses a
  `sleepFirst` flag so phase 2 starts with a sleep (the immediate attempt already happened in
  phase 1) — no back-to-back redundant settle. Tested.

**Documented (intended behavior / bounded limitation, not changed):**
- **M1 — settlement posts the *latest* Hermes price, not a price stamped exactly at the
  4:00 PM ET close.** The SDK's `fetchPriceUpdate` exposes `getLatestPriceUpdates` (price
  *now*); the on-chain `DEFAULT_MAX_STALENESS` (120s) bounds how stale the posted price may be
  vs. the settle call. In practice equity feeds freeze at the close, so "latest after close" is
  the close print — but this is a reliance, not a guarantee. A timestamped Hermes query would
  be the precise fix; it requires extending the **F-06 SDK** Pyth surface (a frozen
  cross-cutting contract), so it is deliberately *not* forked here. Flagged for the integrator:
  run settlement promptly after the close, and if precise close-instant pricing is required,
  add a timestamped fetch to the SDK and propagate it. The `admin_settle` fallback covers a
  contested price regardless.

**Low-severity findings recorded for your decision (not actioned):**
- **L3 — `listMarkets` does an N+1 re-fetch.** `RpcChainClient.listMarkets` calls
  `program.account.market.all()` (already decoded) then re-`fetchMarket`s each address. The
  re-fetch is redundant; mapping `.all()` results through the same normalization would halve
  the read load. Deferred — correctness is fine; worth doing if a settlement run reads many
  markets on a hot path.
- **L4 — `PythPriceSource` returns the current live price as "previous close."** During market
  hours this is the live/last price, not yesterday's official close (acknowledged in the code;
  the demo defaults to the mock source). A real EOD source would replace it behind the same
  interface.
- **L6 — the `created` summary counter** counts every successfully provisioned market
  (including idempotent re-runs where nothing new was created). The field is documented as
  "provisioned," but the name could read as "newly created." Cosmetic.

### Chunk 9 — CI wiring

- The single `lint-ts` Node job now also runs `@meridian/automation` typecheck + tests,
  after building `@meridian/sdk` (the automation package imports the SDK's `dist/`). One
  `yarn install`, one job — no duplicate install. It consumes the `build-program` `.so`
  artifact (the automation integration test loads it via `litesvm`, like the SDK tests) and
  inherits the `resource_group: heavy-rust` serialization (the box is ~3.8 GB, no swap, and
  the LiteSVM suites OOM if run concurrently with the Rust `verify` job). Root `yarn test`
  now runs both workspaces.
