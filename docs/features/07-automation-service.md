# Feature: Automation Service

**ID:** F-07 · **Roadmap piece:** F-07 · **Status:** In progress

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
- [ ] **4. PriceSource + Alerter + logger + retry** — interfaces + impls (Pyth + mock
  source; webhook + log alerter). Tests: mock close; webhook POST + log fallback; backoff
  math; the wide-confidence retry-every-30s-up-to-15min-then-alert loop (injected clock).
- [ ] **5. Morning job** (`morningJob.ts` + provisioning) — per ticker: prev close →
  strikes → `createStrikeMarket` + `initOrderBook` + `growOrderBook`; logged, failures
  alerted, retries; skips when calendar says no session. Mocked-SDK contract test.
- [ ] **6. Settlement job** (`settlementJob.ts`) — discover open markets past close →
  settle (idempotent no-op on re-settle); wide-confidence → retry loop → admin alert for
  `admin_settle`. Mocked-chain orchestration tests.
- [ ] **7. CLI entrypoints + keypair/secret loading** (`bin/*`, `keypair.ts`, `config.ts`)
  — `run-morning`/`run-settlement` parse env, load the keypair from an env secret, exit
  non-zero on failure. Tests: rejects missing/empty secret; config validation. Document
  env vars for F-10's `.env.example`.
- [ ] **8. Integration test (LiteSVM)** — load `meridian.so`, seed `Config`, run morning
  to create markets, run settlement (SDK `buildPriceUpdateV2` fixture) and assert markets
  go `Settled` with the expected outcome.
- [ ] **9. CI wiring** — extend `.gitlab-ci.yml` `lint-ts` to typecheck + test
  `@meridian/automation` in the same Node job (F-06 pattern; consumes the `build-program`
  `.so`).
- [ ] **10. Adversarial review + triage** — independent subagent (keypair handling,
  webhook SSRF/errors, retry/clock edges, calendar correctness, idempotency). Fix
  high/medium, re-run suite, record lows below.

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
