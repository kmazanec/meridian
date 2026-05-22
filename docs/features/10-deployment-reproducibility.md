# Feature: Deployment & Reproducibility

**ID:** F-10 · **Roadmap piece:** F-10 · **Status:** In progress

## Description

This delivers the deployment and reproducibility layer: a one-command setup
(`make dev` or equivalent), reproducible scripts to deploy the program, create
markets, and run the full lifecycle end-to-end on Solana devnet, a `.env.example`
documenting all required secrets, and a README explaining setup and the demo.

It exists because the brief requires a reproducible devnet deployment with
one-command setup and a demonstrable create → mint → trade → settle → redeem flow.
This feature turns the verified system (F-09) into something a reviewer can run.

## How it fits the roadmap

Wave 5, the final link on the critical path after integration (F-09 → F-10).

## Dependencies (must exist before this starts)

- **F-09 Integration & E2E** — packages the verified lifecycle into reproducible
  scripts; depends on the integrated stack working.

## Unblocks (what waits on this)

- None — this is the terminal deliverable for the core submission. (Bonus mainnet-beta
  deployment, if pursued, would follow from here.)

## Acceptance criteria

- A single command brings up the local stack for development (`make dev` or
  equivalent), documented in the README.
- Reproducible scripts/commands deploy the program to devnet, create the day's
  markets, and run the full lifecycle (create → mint → trade → settle → redeem)
  end-to-end on devnet.
- `.env.example` lists every required environment variable (RPC endpoint, keypairs,
  oracle feed ids, alert channel, etc.) with safe placeholder values; no real secrets
  are committed.
- Tests run locally and validate all key invariants (per ARCHITECTURE.md §12).
- The README documents prerequisites, one-command setup, the demo steps, and a short
  risks/limitations note (no regulatory or compliance claims).

## Testing requirements

- A clean-checkout dry run: from a fresh clone with `.env` filled from `.env.example`,
  the one-command setup and the lifecycle scripts complete successfully on
  devnet/local validator.
- The deploy + lifecycle scripts are themselves exercised in CI or a documented manual
  run so reproducibility is verified, not assumed.

## Manual setup required

- A funded devnet deployer keypair and the automation keypair; an RPC endpoint; the
  per-ticker devnet oracle feed ids; any alert-channel credential. All provided via
  env per `.env.example`. (Bonus: a funded mainnet-beta setup if the mainnet
  deployment is attempted — not required for the core submission.)

## Build plan (approved)

Delivered as a new private workspace package **`@meridian/ops`** (`packages/ops`) plus a
root **`Makefile`**, **`.env.example`**, and a novice-grade **devnet runbook**. The ops
package houses *environment-agnostic, RPC-driven* scripts that work against a **local
validator** (automated/CI/demo) and **real devnet** (operator-run with a funded wallet).
It reuses — never re-implements — the SDK builders, the F-09 e2e harness (`startLocalValidator`,
`Fixture`, `crossing`), and the automation jobs.

**Decisions taken with the user:** (1) deliver *both* a reproducible local-validator path
(CI + demo) and a real devnet deploy the operator runs themselves, with precise
novice-friendly instructions; (2) `make dev` = full local stack bring-up (build → boot
validator → deploy → init config + USDC → create markets → seed demo wallet → write web
`.env.local`); (3) Makefile + a scripts package reusing the SDK and e2e harness.

- [x] **Chunk 1 — `@meridian/ops` scaffold + shared config/logging.** package.json/tsconfig;
  `src/env.ts` (RPC_URL, deployer keypair via env *or* path, optional USDC_MINT, cluster,
  ticker/strike selection; fail-fast like automation `loadConfig`); `src/log.ts`. Joins the
  `packages/*` workspace. Pure `tests/env.contract.test.ts`. (AC#3 groundwork)
  **Green: 11 passing; typecheck + prettier clean.**
- [x] **Chunk 2 — Deploy + bootstrap.** `src/deploy.ts` (idempotent upgradeable
  `solana program deploy` against RPC_URL, honoring MERIDIAN_SO/keypair overrides),
  `src/bootstrap.ts` (mock USDC mint or USDC_MINT + `initialize_config`, idempotent),
  `src/manifest.ts` (secret-free deploy manifest), bins. Contract test for argv + PDA + feed
  ids + manifest schema. (AC#2 deploy leg) **Green: 19 contract tests; smoke-verified against
  a real local validator (fresh deploy → bootstrap → idempotent re-run).**
- [x] **Chunk 3 — Create-markets + lifecycle scripts.** `src/createMarkets.ts` (compute
  strikes via automation `computeStrikes`; provision via the proven `Fixture.createMarket`
  3-step; idempotent), `src/lifecycle.ts` (create→fund→mint→quote→trade(maker/taker)→
  admin_settle→redeem, asserting §7 invariants per phase; human-readable transcript), bins.
  Contract test for strike/market-id derivation + formatting. (AC#2 create+lifecycle; AC#4
  invariants) **Green: 23 contract tests; full pipeline (deploy→bootstrap→create-markets→
  lifecycle) run live against a real local validator via the bins — outcome yesWins, zero-sum
  P&L +$1.40/−$1.40, vault drained to $0, invariants held at every phase.**
- [x] **Chunk 4 — `make dev` + Makefile + `.env.example`.** Makefile (`dev`, `demo`/
  `lifecycle`, `deploy`/`bootstrap`/`create-markets` (local) + `*-devnet` forms, `build`,
  `test`, `lint`, `stop`, `clean`, `help`); `dev-up` bin + `devStack.ts` (seed demo wallet +
  write web `.env.local`); `.env.example` (every var, grouped, placeholders, loud header);
  gitignore root `.env` / `.localnet/` / `deploy-manifest.json`. Env-drift guard test. (AC#1,
  AC#3) **Green: 39 contract tests; `make dev` → `make demo` → `make stop` run live (full
  bring-up: deploy, USDC+Config, day's markets, seeded demo wallet, web `.env.local`;
  lifecycle green; clean teardown).**
- [x] **Chunk 5 — Reproducibility verification.** `tests/repro.test.ts` (validator-gated):
  boots a real validator and runs the *actual* ops bins (deploy→bootstrap→create-markets→
  lifecycle) as subprocesses, asserting exit 0 + Config initialized + manifest secret-free
  (lifecycle bin asserts §7 invariants internally). Added ops typecheck + `test:contract` to
  CI `lint-ts` (validator suite excluded, mirrors e2e); documented in `.gitlab-ci.yml` +
  `docs/local-development.md`. (Testing requirement; AC#4) **Green: repro passes against a
  real validator (~33s); skips cleanly without a validator (1 pending); immutable install +
  lint clean.**
- [x] **Chunk 6 — README + devnet runbook.** README one-command flow + Risks/Limitations
  note + refreshed repo-layout/CI/Status/doc-map; `docs/devnet-deployment.md` novice runbook
  (install toolchain, create+fund a devnet keypair, `.env`, the four `make *-devnet` targets,
  explorer viewing, live-Pyth opt-in vs admin-override, troubleshooting table); updated
  `docs/local-development.md` with the `make dev` flow + ops repro test. (AC#1, AC#5)
- [x] **Adversarial review** — robustness/efficiency/security-integrity; high/medium fixed
  (see "Adversarial review" below); lows recorded for the user. **Green after fixes: 43 ops
  tests (incl. validator-backed repro).**
- [ ] **Rebase, push, open MR.**

## Adversarial review

An independent review subagent attacked the ops scripts for robustness, efficiency, and —
most relevant here — security/secret-handling and the *integrity of the reproducibility proof*
(could a green run hide a real bug?). It verified claims against the program/SDK source and
self-retracted one initial finding (the taker `makerAccountsFor` side, confirmed correct
against the crossing contract test). **Fixed (high/medium):**

- **Lifecycle invariants were logged, not asserted (HIGH/integrity).** The zero-sum P&L and
  vault-drain checks printed `yes`/`NO` but did not `throw`, so a payout bug could exit 0 with
  `zero-sum: NO` in the transcript — undermining "a green run is the proof." Both are now hard
  assertions (`makerPnl + takerPnl === 0`, `vaultRemaining === 0`) that throw on violation, on
  top of the per-phase `assertCollateralization`. The repro test relies on this.
- **`dev-up` local-only guard was bypassable (HIGH/security).** It checked the *derived cluster
  label*, and `clusterLabel` defaulted any unrecognized RPC (e.g. a private node with no
  "devnet" in the URL) to `"localnet"` — so `dev-up` could airdrop + mint mock USDC against a
  real cluster. Fixed two ways: `clusterLabel` now returns `"unknown"` (not `"localnet"`) for
  unrecognized endpoints, and the guard now uses a new `isLocalRpc(rpcUrl)` that parses the URL
  and accepts *only* genuine loopback hosts (`127.0.0.1`/`localhost`/`::1`). Tested against
  tricky URLs (`?host=localhost`, `localhost.evil.com`, IPv6).
- **Keypair path heuristic could misread a base58 secret (MEDIUM).** `looksLikePath` treated
  any string matching an existing CWD filename as a path, so a base58 secret colliding with a
  local filename would be read as the wrong "keypair." Tightened to require a real path marker
  (`/`, `~`, or `.json`); a base58 secret carries none. Regression test added.
- **Deprecated airdrop confirm (MEDIUM).** `devStack` confirmed the demo-wallet airdrop with
  the deprecated bare-signature form (can miss a dropped tx on a busy validator); switched to
  the `{ blockhash, lastValidBlockHeight }` form.

The HIGH "deployer secret written to a temp file for the CLI" was assessed and **kept as-is**:
it is the *same accepted pattern as the existing F-09 e2e harness* (the Solana CLI requires a
keypair *file*), the temp dir is `mkdtemp` mode-0700, and the file is removed in a `finally`.
Noted as a known constraint rather than a new vulnerability.

### Low-severity findings (deferred — for the user to decide)

- `baseUnitsToDollars` truncates (not rounds) to 2 decimals in *log output only* — the
  on-chain value is exact; cosmetic.
- `Makefile` `stop`'s `pkill` fallback pattern uses the relative ledger path; only matters if
  the pid file is missing *and* `make stop` is run from another directory. The pid-based kill
  is the normal path.
- `deploy.ts` `programIdFromKeypairFile` uses an inline `require("node:fs")` rather than the
  top-level import (style nit; mirrors an existing pattern in the codebase).

## Implementation notes (filled in by the building agent)

> The agent implementing this feature records its implementation decisions and
> rationale here as it builds — chosen libraries/patterns within the architecture's
> constraints, trade-offs made, deviations from assumptions and why, and anything the
> next agent or the integrator needs to know. This section starts empty and is owned
> by the builder, not the planner. Cross-cutting discoveries that affect other
> features must also be propagated to ROADMAP.md or the architecture doc, not just
> left here.

### Chunk 1 — scaffold

- **New `@meridian/ops` workspace package** (private, no `dist` — bins run via `ts-node`,
  tests via `ts-mocha`, mirroring `@meridian/e2e`). It is the only package that needs both
  the SDK *and* the e2e harness, and the only TS run *as scripts* against an arbitrary RPC.
- **`@meridian/e2e` gained a source entry** (`src/index.ts` + `main`/`exports` →
  `./src/index.ts`) so its `startLocalValidator`/`Fixture`/`crossing` primitives are
  importable by `@meridian/ops` without re-implementing validator bring-up. e2e is consumed
  from source (never built to `dist`), so a source `exports` entry is the right shape.
- **`env.ts` deployer keypair accepts a file PATH** (in addition to the inline JSON/base58
  the automation `keypair.ts` takes) because a human operator deploying to devnet has a
  Solana CLI keypair *file*. Single source of selection between local and devnet is
  `RPC_URL` + which keypair is supplied — the scripts are otherwise identical
  (environment-agnostic). `OPS_ENV_KEYS` documents the surface for `.env.example` and is
  guarded against drift by a later test (Chunk 4).
- **`log.ts` is a human-readable console transcript** (sections/steps/details/ok), distinct
  from automation's JSON-per-line `Logger`: the ops scripts are watched live by an operator
  or during a demo. The automation *jobs* the demo invokes still log JSON via their own
  logger.

### Chunk 2 — deploy + bootstrap

- **Deploy reuses the F-09 harness's exact `solana program deploy` invocation** (global
  `--keypair`/`--url` before the subcommand; explicit fee-payer + upgrade-authority =
  deployer, which `initialize_config` checks). A pure `deployArgv` builder lets a contract
  test pin that argv so it can't silently drift from the proven-correct reference.
- **Idempotency:** `solana program deploy --program-id <kp>` upgrades when the signer is the
  upgrade authority and deploys fresh otherwise, so re-running is safe; `bootstrap` no-ops if
  `Config` already exists (a second `initialize_config` would hit the re-init guard).
- **Deploy manifest (`deploy-manifest.json`)** records only **public** addresses (program id,
  ProgramData, USDC mint, Config, admin pubkey) + RPC/cluster — never a keypair — so later
  steps and the operator have the addresses without re-deriving, and it is safe on disk.
  Gitignored (Chunk 4).
- **Fixed a latent reuse bug in `@meridian/e2e`:** `describeOnValidator` resolved
  `describe`/`describe.skip` in a **module-load IIFE**, so importing the harness from any
  non-Mocha context (the ops scripts) crashed with `describe is not defined`. Made it resolve
  the Mocha global **lazily, on first call** (a thunk forwarding `.skip`/`.only`), preserving
  every existing e2e call site while making the module import-safe for scripts. This is a
  source fix in the shared harness, not a fork — it keeps the convergence suite using the same
  primitives the ops scripts now reuse.
- **Verified live:** a smoke run booted a bare `solana-test-validator`, deployed onto it
  (`wasAlreadyDeployed=false`), bootstrapped a fresh USDC mint + Config, then re-ran both and
  observed the upgrade path + config no-op. (Folded into the Chunk 5 repro test.)

### Chunk 3 — create-markets + lifecycle

- **`createMarkets` reuses `computeStrikes`** (the automation morning job's strike math:
  ±3/6/9% rounded to $10, deduped) and the proven `Fixture.createMarket` 3-step provisioning
  (`create_strike_market` → `init_order_book` → `grow_order_book`). Idempotent: an existing
  strike is detected via `fetchMarket` and skipped. Previous closes come from
  `MOCK_CLOSE_<SYMBOL>` — the deterministic, offline source appropriate for a reproducible
  demo (the live price-pulling morning job is the automation service's own path).
- **`runLifecycle` mirrors the convergence multi-user scenario** (maker mints+quotes, taker
  crosses, admin-settle Yes-wins, both redeem, vault drains to 0, zero-sum P&L) but as a
  *script* with a transcript, reusing `Fixture` + the SDK builders + `makerAccountsFor` — no
  re-implementation of matching or the four-button mapping. The §7 invariants
  (collateralization after each phase; payout completeness via the drained vault; settlement
  timing via the admin delay) are asserted, so a green run is a real proof, not a smoke.
- **Added `Fixture.attach(connection, admin, usdcMint)`** to the shared harness: unlike
  `Fixture.bootstrap` (which creates a mint + inits Config), `attach` binds the
  lifecycle/invariant helpers to an **already-bootstrapped** world. The ops scripts deploy +
  bootstrap as separate idempotent steps (and may target devnet where Config/USDC already
  exist), so they need to attach, not re-bootstrap. Source addition to e2e, not a fork.
- **Environment-agnostic user funding:** demo users are funded by a **deployer→user SOL
  transfer** + a **USDC mint from the deployer**, not a per-user airdrop. Airdrop works on a
  local validator but is rate-limited/unreliable on devnet; a deployer transfer works on both,
  so the identical lifecycle script runs against devnet (operator pre-funds the deployer).
- **Settlement uses `admin_settle`** (deterministic, no live oracle) — the documented demo
  path, exactly as the F-09 local suites. The genuine Pyth pull path is the opt-in devnet
  smoke in the convergence suite, surfaced in the devnet runbook (Chunk 6).

### Chunk 4 — Makefile + make dev + .env.example

- **The Makefile owns the local validator lifecycle; the ops bins own everything else.**
  `make dev` starts `solana-test-validator` (detached, pid in `.localnet/`), generates +
  airdrops an **ephemeral local deployer** (persisted to `.localnet/deployer.json` so
  later `make demo`/`make create-markets` reuse the *same* Config admin), then runs the
  `dev-up` bin (deploy → bootstrap → create-markets → seed demo wallet → write web
  `.env.local`). `make stop` kills it and wipes `.localnet/`. This keeps the long-lived
  process under the operator's direct control (not buried in a Node process across `make`
  recipe lines).
- **`dev-up` refuses any non-local RPC** (it airdrops + mints mock USDC) — a guard so the
  full-bring-up convenience can't accidentally seed devnet/mainnet. Devnet uses the explicit
  `*-devnet` targets, which require the operator's own `DEPLOYER_KEYPAIR` and never airdrop.
- **`devStack.seedDevStack`** reproduces the web e2e `localnet.mjs` seeding (single-side
  inventory in two open markets + a settled redeemable market) via the SDK + `Fixture`, and
  writes `packages/web/.env.local` (`NEXT_PUBLIC_RPC_URL`/`_USDC_MINT`/`_CLUSTER`) so the
  frontend talks to the local stack with no manual config.
- **`.env.example`** documents the *entire* env surface (deploy/ops, build overrides, live
  Pyth, automation, web), grouped by task with a loud never-commit header and only safe
  placeholders. An **env-drift guard test** cross-checks it against the loaders' self-
  documented keys (`OPS_ENV_KEYS`, automation `ENV_KEYS`, web `NEXT_PUBLIC_*`) and asserts no
  real secret leaked into the template — so a future env var can't ship undocumented.
- **Secrets discipline:** root `.env`, `.localnet/` (holds the demo wallet secret + local
  deployer), and `deploy-manifest.json` are gitignored; `.env.example` is the only env file
  committed. The deploy manifest itself carries only public addresses.

### Chunk 5 — reproducibility verification + CI

- **`tests/repro.test.ts` runs the real bins, not a copy.** It boots a validator via the
  shared harness and `execFileSync`s the actual `deploy`/`bootstrap`/`create-markets`/
  `lifecycle` bins (the same commands `make` and the operator invoke) as subprocesses; a
  non-zero exit fails the test. It then confirms Config is initialized with the manifest's
  USDC mint and the manifest is secret-free. The lifecycle bin asserts the §7 invariants
  internally at every phase, so a zero exit *is* the invariant proof — this is what makes
  "reproducible" a *checked* claim. Verified live (~33s); skips cleanly with no validator.
- **CI:** ops `typecheck` + `test:contract` were added to the Node-only `lint-ts` job
  (mirroring e2e — the validator-gated repro test stays a local/documented gate, since the
  CI image has no Solana toolchain). The lockfile was synced for `--immutable`.
