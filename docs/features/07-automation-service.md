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
- [ ] **2. Strike algorithm** (`strikes.ts`) — ±3/6/9% of prev close, round to nearest
  $10, dedupe, integer/fixed-point. Tests: META-style spread, AAPL-style collapse,
  optional rounded-close, no floats.
- [ ] **3. Market calendar** (`calendar.ts`) — weekend/holiday/half-day; DST-aware ET→unix;
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
