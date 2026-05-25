# 11 — Test quality & coverage audit

Read-only audit of test quality and coverage across the Meridian off-chain
workspace, with a focus on the money/correctness-critical paths (settlement
math, escrow accounting, redeem/claim reconstruction, order matching, oracle
price parsing). All file paths are absolute.

Scope note: the worktree under audit
(`/Users/keith/dev/gauntlet/peak6/meridian/.claude/worktrees/refactor-swarm`)
still has `calendar.ts` in `@meridian/automation` (the SDK move shown in the
top-level `git status` is on `main`, not here). Findings are written against the
worktree's actual layout.

## Summary

Overall the suite is **unusually high quality** for a project this size. The
pure money/correctness logic is genuinely unit-tested, not faked: settlement
payout, P&L, portfolio folding, leaderboard net-worth accounting, strike
computation, dual-perspective book projection, crossing/maker-account
derivation, the four-button intent mapping, and the settlement-job orchestration
all have real, falsifiable tests with hand-built inputs and exact-value
assertions. Mocks are confined to genuine I/O boundaries (RPC, wallet,
spl-token decode, Hermes/Pyth SDKs) and the tests around them exercise real
logic (state machines, reverted-tx handling, error classification).

I found **no tautological tests, no `.only`, no `xit`/`it.todo`, no
assertion-free test bodies, and no over-mocked "assert the mock" tests.** Every
`.skip` is a deliberate, documented conditional (`SDK_SKIP_LITESVM`, `PYTH_LIVE`,
`devnet` env gates). Every `toBe(true)` / `toHaveBeenCalled` is paired with a
meaningful assertion. **Weak-test count: 0** in the "delete this fake test"
sense.

The real risk is **not bad tests — it is what CI does not run.** A large,
load-bearing class of behavioral tests lives inside `describeOnChain(...)`, which
becomes `describe.skip` whenever `SDK_SKIP_LITESVM=1` — and **CI sets that flag**
(`.gitlab-ci.yml` `lint-ts` job). So in the pipeline that gates merges, the
**SDK instruction builders, the on-chain settle/redeem/escrow round-trips, and
the automation↔program integration test are all skipped.** They pass locally and
the Rust `verify` job covers the *program*, but the **TypeScript builder
correctness** (account ordering, escrow/vault/mint-authority account derivation
inside the instruction builders) is proven *locally only*. A refactor agent that
trusts a green CI run will not be warned if it breaks an SDK builder's account
list. This is the gating concern for the rest of the refactor.

## Findings

### A. Weak / trivial tests

None of substance. Specifics checked and cleared:

- `.skip` / `.only` / `xit` / `it.todo`: the only matches are legitimate
  conditional gates and assertions *about* a `.skipped` result field:
  - `packages/sdk/tests/pyth.test.ts:165` — `(enabled ? it : it.skip)(...)`,
    gated on `PYTH_LIVE=1` (live devnet round-trip). Correct.
  - `packages/e2e/tests/devnet-settle.smoke.test.ts:47` — `ENABLED ? describe
    : describe.skip`, env-gated devnet smoke. Correct.
  - `packages/sdk/tests/harness.ts:85-87` — `describeOnChain` = `describe.skip`
    when `SDK_SKIP_LITESVM`. Correct mechanism, but see section B for the
    coverage consequence.
  - `morningJob.test.ts:149`, `settlementJob.test.ts:135`,
    `integration.test.ts:261`, `automation.test.ts:85/178` — all assert on a
    `summary.skipped`/`notDue` count, i.e. real behavior, not test skipping.
- `expect(true)` / `toBe(true)` / `toHaveBeenCalled`: every occurrence asserts a
  real boolean return (e.g. `c.affordable`, `row.redeemable`,
  `r.blocked`, `holder.unpriceable`) or is paired with `toHaveBeenCalledWith` /
  `toHaveBeenCalledTimes` / used as a negative guard (`not.toHaveBeenCalled`).
  None are `expect(true).toBe(true)` placeholders.
- No test file has zero assertions.

### B. Untested / under-tested in CI critical paths (the real gaps)

The following are tested **only inside `describeOnChain`**, so they **do not run
in CI** (`SDK_SKIP_LITESVM=1`). They run locally and the Rust `verify` job
covers the on-chain program, but the **TS-side construction** they prove is
unguarded in the pipeline:

1. **SDK instruction builders — entire behavioral suite.**
   `packages/sdk/tests/instructions.test.ts:25` wraps `create_strike_market`,
   `add_strike`, `init/grow_order_book`, **`mint_pair` (the $1.00 escrow
   deposit → 1 Yes + 1 No)**, **`admin_settle` + `redeem` (winner payout)**,
   **`place_order` / `cancel_order` (escrow lock + return)**, and the
   **crossing taker auto-match** all under `describeOnChain`. In CI the *only*
   thing that runs from this file is the `placeOrder` client-side validation
   block (`:395`, zero-size / out-of-range-price guards). Account-list
   correctness for every escrow-moving builder is local-only.

2. **Automation ↔ program integration.**
   `packages/automation/tests/integration.test.ts:128`
   (`describeOnChain("automation integration ...")`) is the test the
   `morningJob`/`settlementJob` unit tests cite as "the real SDK builders +
   program are exercised here." It is **skipped in CI too.** So the chain from
   morning-job → `SdkMarketProvisioner` → real `create_strike_market`, and
   settlement-job → real `settle_market`, is never end-to-end-checked in the
   pipeline.

3. **Pull-oracle settle round-trip & most of `reads.dualBook` aggregation.**
   - `packages/sdk/tests/pyth.test.ts:40` (`settle_market reads the fixture`,
     wrong-feed reject, partial-verification reject) — `describeOnChain`. In CI,
     only the `buildPriceUpdateV2` byte-layout test (`:22`) runs. The actual
     "settle consumes a PriceUpdateV2 and writes the right outcome / rejects
     wrong feed / rejects partial verification" behavior is local-only.
   - `packages/sdk/tests/reads.test.ts:69/172` — `dualBook` on a real book and
     the **same-price level aggregation/collapse** (`aggregate` count+size
     summing) are `describeOnChain`. `dualBook`'s mirror is *also* covered in CI
     by the web test (`packages/web/src/lib/dualbook.test.ts`), **but that web
     test uses all-distinct prices**, so the `aggregate` collapse path
     (`reads.ts:296-302`, two orders at one price → one level, count 2) is
     **not exercised anywhere in CI.**

4. **`payoutFor` (SDK) vs `settledPayout` (web) — settlement payout.**
   `payoutFor` (`packages/sdk/src/reads.ts:407`) has good *pure* tests
   (`reads.test.ts:223`, including the throw-on-corrupt-settled-state branch)
   and they **do** run in CI (that `describe` is plain, not `describeOnChain`).
   The web mirror `settledPayout` is covered by `market-math.test.ts`. This one
   is fine — noted so a refactor knows the two duplicated payout
   implementations are both guarded.

5. **`reflectPrice` pure tests are needlessly skipped.**
   `packages/sdk/tests/intent.test.ts:169-180` tests `reflectPrice` is its own
   inverse and rejects out-of-range prices — **pure logic that needs no
   LiteSVM** — yet it sits inside `describeOnChain("four-button intent
   translation")` (`:64`) and is skipped in CI. (`buildTradeIntent`'s
   action→side/price mapping *is* independently guarded in CI via
   `packages/e2e/tests/crossing.contract.test.ts:163`, so the mapping is safe;
   only the `reflectPrice` algebraic invariants are dark in CI.)

### C. Network/settlement helpers with no automated coverage at all

`packages/sdk/src/pyth.ts`: `fetchPriceUpdate` (Hermes parse + integer-guard),
`postPriceUpdate` (Receiver builder, account resolution, preflight policy), and
`settleWithPyth` (the full fetch→post→settle wrapper) have **no test that runs
anywhere automatically** — only the opt-in `PYTH_LIVE=1` test
(`pyth.test.ts:163`), which itself only asserts `update.binary.data.length > 0`.
The `toBigInt` decimal/non-numeric guard (`pyth.ts:86-94`) and the
"feed-id format" pre-send error (`pyth.ts:161-167`) are pure, testable, and
untested. These are network-boundary functions, so the gap is understandable,
but the *pure parsing/guard* slices inside them deserve unit tests.

### D. Well-covered critical paths (safe to refactor with confidence)

These have real CI-running tests; refactors here will be caught:

- **Settlement-job orchestration** — `settlementJob.test.ts` (virtual clock,
  idempotency, wide-confidence retry window, anti-blocking concurrency,
  alert-not-retry on hard errors). Excellent.
- **Settler error classification** — `settler.test.ts` (name/msg/numeric-code
  matching, false-match guards on stray digits, idempotent already-settled).
  Excellent.
- **Morning-job orchestration** — `morningJob.test.ts` (per-strike
  provisioning, retries, alerts, no-op on non-session day).
- **Strike computation** — `strikes.test.ts` over `strikes.ts` (±3/6/9%,
  $10 rounding with $5-up midpoint, dedupe, drop-non-positive, throw on
  non-positive close).
- **Portfolio folding & summary** — `portfolio.test.ts` (P&L, No-mark
  complement, settled winner/loser payout, claimed-winner reconstruction from
  redeem history, no-double-count).
- **Redeem reconstruction** — `reads.test.ts:275` `redeemRecordsFromEvents`
  (owner filtering, non-Redeemed skip, snake/camel field variants) — pure, runs
  in CI. (The RPC-paging `fetchRedeemHistory` wrapper around it is untested, but
  the field/filtering core is solid.)
- **Market math** — `market-math.test.ts` (mid/price-from-book fallbacks,
  complement, markValue, signed P&L, settledPayout, holdsBothSides).
- **Leaderboard net-worth accounting** — `leaderboard.test.ts` (settled vs.
  open valuation, unpriceable handling, bid/ask escrow credit-back).
- **Crossing / maker accounts** — `crossing.test.ts` and the e2e
  `crossing.contract.test.ts` (best-price-then-time order, fill-size bound,
  USDC-vs-Yes maker account selection, market-order crossing,
  buildTradeIntent agreement).
- **PDA seed encoding** — `pdas.test.ts:21-58` (config + market seed byte
  layout) runs in CI; only the "accounts exist at PDAs" cross-check is on-chain.
- **send hook & data reads** — `useSendIx.test.ts` (reverted-but-confirmed →
  error, not success), `leaderboardData.test.ts` (owner resolution + zero/
  off-curve/missing filtering). Boundary-only mocks, real logic tested.

## Recommendations

Ordered by priority. "Blast radius" = what a regression here breaks if a
refactor agent changes it undetected.

### High

- **(H1) Un-skip the pure tests that don't need LiteSVM.** Move the
  `reflectPrice` invariant tests (`intent.test.ts:169-180`) out of
  `describeOnChain` into a plain `describe` so they run in CI. They are pure
  algebra. Same treatment for any pure helper assertions currently trapped under
  `describeOnChain`. Cheap, immediate CI coverage gain.
  *Blast radius: No-side price reflection — every Buy/Sell-No order's on-chain
  price.*

- **(H2) Add a CI-running unit test for same-price book aggregation.** Add a
  case to `packages/web/src/lib/dualbook.test.ts` (or a new pure SDK test) with
  **two+ orders at the same price** on each side, asserting one collapsed level
  with summed `size` and `count`, in both perspectives. Today this `aggregate`
  branch (`reads.ts:296-302`) runs in CI nowhere.
  *Blast radius: every depth/ladder display and any consumer reading aggregated
  level size — wrong sizes mislead traders.*

- **(H3) Add pure unit tests for the testable slices of `pyth.ts`.** Factor
  nothing if possible; just test (a) `fetchPriceUpdate`'s `toBigInt`
  decimal/non-numeric guard by feeding a fake Hermes response shape, and (b)
  `buildPriceUpdateV2` round-trips through a small byte-reader for *every* field
  (price/conf/exponent/publishTime/verification tag), not just discriminator +
  feedId. The vendored-parser memory (`pyth-vendor-parser`) makes this layout
  the contract with `oracle.rs`; a field-offset regression is a settlement
  correctness bug.
  *Blast radius: settlement reads the wrong price → wrong market outcome → wrong
  payouts. Highest-stakes path in the system.*

### Medium

- **(M1) Run a minimal on-chain smoke in CI, or document the gap loudly.** The
  *builder account-list* correctness (mint_pair/redeem/place_order/settle) is
  CI-dark because LiteSVM OOMs the shared runner. Options, cheapest first:
  (a) add a CI note/checklist requiring `SDK_SKIP_LITESVM` unset locally before
  merging SDK-builder changes; (b) split *one* tiny LiteSVM smoke (single
  mint_pair + redeem) into a separate, serialized CI job on the `heavy-rust`
  resource group so at least the core escrow round-trip is gated. Until then,
  treat all `describeOnChain` SDK/automation suites as "local-only" when
  judging refactor safety.
  *Blast radius: any escrow-moving instruction builder; a wrong account index
  silently corrupts deposits/payouts.*

- **(M2) Test `fetchRedeemHistory` paging/skip logic with a mocked
  connection.** `redeemRecordsFromEvents` is tested; the wrapper
  (`reads.ts:499`) that batches signatures, skips `err` txs, and tolerates
  failed `getTransaction` is not. A mocked `Connection` (like
  `leaderboardData.test.ts` does) would cover the batch/skip branches.
  *Blast radius: claimed-winner portfolio view (missing/duplicated claims).*

### Low

- **(L1) Add a `markets.ts` (`SdkMarketProvisioner`) boundary test** mirroring
  the morning-job pattern, mocking only the SDK calls, so provisioning
  orchestration has a CI-running test independent of the skipped integration
  suite.
- **(L2) Consider consolidating the duplicated payout/escrow math** noted in
  `leaderboard.ts:27` and `portfolio.ts` (`settledPayout`) vs SDK `payoutFor`
  and `scripts/bot-results.mjs`. Both copies are currently tested, so this is a
  duplication concern (for another auditor), not a coverage gap — but a shared
  helper would shrink the surface that needs guarding.

## Risky calls (do NOT touch until CI coverage exists)

Refactor agents relying on a green CI run should **not** modify the following
without first adding a CI-running test (or running the full local suite with
`SDK_SKIP_LITESVM` unset and confirming):

1. **`packages/sdk/src/instructions.ts`** — any change to account ordering,
   `remaining_accounts`, escrow/vault/mint-authority derivation, or
   `place_order`/`mint_pair`/`redeem`/`settle_market` builders. Behavioral
   coverage is CI-skipped (`describeOnChain`). The validation block at
   `instructions.test.ts:395` does NOT cover account lists.
2. **`packages/sdk/src/pyth.ts`** — `fetchPriceUpdate`, `postPriceUpdate`,
   `settleWithPyth`, and the field-packing in `buildPriceUpdateV2` beyond
   discriminator/feedId. Settlement correctness; only the layout discriminator
   and live-opt-in path are touched by CI today.
3. **`packages/sdk/src/reads.ts` `aggregate`/`dualBook`** — the same-price
   level-collapse branch is CI-dark (see H2). The mirror direction is covered;
   the aggregation is not.
4. **`packages/automation/src/markets.ts` `SdkMarketProvisioner`** — its real
   behavior is only in the CI-skipped integration suite.

These are *narrow* "add a test first" zones, not "code is unsafe" zones — the
logic appears correct, it is simply unguarded in the gating pipeline.

## Conflicts / dependencies with other concerns

**This audit gates the safety of the other refactor workstreams.** Specifically:

- Any concern proposing changes to **SDK instruction builders, `pyth.ts`,
  escrow/PDA derivation, or `reads.ts` aggregation** must treat CI green as
  *insufficient* evidence and either (a) run the full local LiteSVM suite, or
  (b) land the H1/H2/H3/M1 tests first. Flag this to the
  duplication/types/dead-code auditors: the duplicated payout/escrow math
  (L2) and any "simplify the builders" suggestion ride directly on the
  CI-dark coverage above.
- The **`SDK_SKIP_LITESVM` gate is intentional and load-bearing** (litesvm
  native memory leak OOMs the runner — see `harness.ts:73-87`). Do not "fix" it
  by re-enabling LiteSVM in the shared CI job; that reintroduces the OOM. The
  right move is H1/H2/H3 (pull pure logic into CI-runnable tests) plus the
  optional serialized smoke in M1.
- No conflict with formatting/lint concerns: every test file is prettier-clean
  and the suite structure is consistent across packages.
