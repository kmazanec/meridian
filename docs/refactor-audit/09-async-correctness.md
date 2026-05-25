# 09 — Async / error correctness audit

## Summary

I traced every async surface in the off-chain packages with a bias toward the
timing-sensitive ones: the automation **jobs** (`morningJob`, `settlementJob`,
`settler`, `chain`, `retry`), the trader **bot** loop (`runner`, `agent`,
`chain`, `placeOrder`, `context`), the SDK on-chain helpers (`pyth`, `reads`),
the ops CLIs, and the web hooks. I checked for floating/unawaited promises,
missing `await`, swallowed rejections, `forEach`/`map(async)` misuse, unsafe
parallelism where on-chain ordering matters (and the reverse), never-settling
`Promise` constructors, and unhandled rejections.

**Headline:** the async discipline in this codebase is genuinely good. Error
boundaries are deliberate (the morning/settlement jobs never reject on a
single-market failure; the bot loop survives a bad tick; web hooks all guard with
a `cancelled` flag). There are **no** `forEach(async)` bugs, no missing `await`
before a `return`/conditional, and no swallowed rejections that hide real
failures. The `discoverOpenMarkets` in-flight coalescing cache is textbook.

The one real, on-chain-relevant correctness/operability bug is the
**settlement job's unbounded parallel fan-out** (Finding 1): every due market is
settled at once via `Promise.all` with no concurrency cap, firing ~120+
RPC-heavy calls from a single fee-payer at the exact moment the close passes —
against the same shared, rate-limited endpoint the trader fleet already documents
fighting 429s on. The remaining items are lower severity: a non-interruptible
sleep in the bot loop (slow shutdown), a couple of confusing-but-correct
patterns, and a test that relies on a shared-mutable virtual clock that would not
hold under real concurrency.

**Real bug count:** 1 high (operability/correctness under load), 2 medium, 3 low.

## Findings (file:line, the bug, why it's wrong, severity)

### 1. Settlement job fans out to **unbounded parallelism** from one fee-payer — HIGH

`packages/automation/src/settlementJob.ts:119-121` (phase 1) and `143-148`
(phase 2):

```ts
const firstResults = await Promise.all(
  due.map(async (m) => ({ m, result: await firstAttempt(m, opts) }))
);
...
const retryResults = await Promise.all(
  needRetry.map(async (m) => ({ m, settled: await retryWideConfidence(...) }))
);
```

Each `firstAttempt` → `settler.settle` → `settleWithPyth`
(`packages/sdk/src/pyth.ts:246`) performs, per market: a Hermes fetch
(`fetchPriceUpdate`), one-or-more Receiver post transactions (`postPriceUpdate`,
which calls `provider.sendAll`), and a `settle_market` send+confirm
(`sendAndConfirmTransaction`) — roughly 3–4 network-heavy operations each.

The due set at a single close is large: `computeStrikes`
(`packages/automation/src/strikes.ts:54-58`) produces **6 strikes per ticker**
(3 offsets × up/down legs), and the fleet runs **7 tickers**
(`STRIKE_OFFSET_BPS = [300,600,900]`, `TICKER_SYMBOLS` has 7). All ~42 markets
share the same `trading_day` close instant, so they all land in `due` together
and are settled in **one `Promise.all` with no concurrency limit** → on the order
of **120+ concurrent RPC calls**, all from the same automation keypair, in a
burst, against one endpoint.

Why it's wrong:
- The trader `BotChain.send` (`packages/traders/src/chain.ts:88-137`) is built
  around the fact that *this exact shared devnet endpoint* rate-limits a fleet
  hitting it at once ("the chief source of the shared endpoint's 429s",
  "thundering herd"). The settlement job hits the same endpoint harder, in a
  tighter burst, with **no 429 backoff at all** on the post/settle path
  (`RpcChainClient` isn't even used here — `settleWithPyth` calls web3.js's
  `sendAndConfirmTransaction` directly, which has no rate-limit handling).
- A 429 (or a transient send failure) on `settleWithPyth` is classified by
  `PythSettler.settle` (`packages/automation/src/settler.ts:119-129`) as
  `SettleStatus.Error` (it matches neither the WideConfidence nor MarketSettled
  markers) → `alertHardError` pages the operator. So load-induced failures look
  like genuine settlement failures and **generate spurious critical alerts**,
  which is precisely the human-in-the-loop the design wants to reserve for real
  wide-confidence escalation.
- The Receiver-post phase also leaves on-chain accounts when partial: each
  `settleWithPyth` posts a fresh price-update account with
  `closeUpdateAccounts: false` (`packages/sdk/src/pyth.ts:148-150`); a burst that
  partially fails wastes rent on orphaned update accounts (a cost/cleanup issue,
  not a settlement-correctness one — the on-chain program is still the source of
  truth).

Note this is **not** a tx-ordering/nonce bug: Solana has no per-account
sequential nonce for normal transactions, and the Receiver SDK uses an *ephemeral
keypair* per update account, so same-feed parallel posts don't collide on an
account or a signature. The bug is **load/burst** (rate-limit-induced spurious
failures + alerts), which on a rate-limited endpoint is a real correctness
problem for the job's *outcome* (markets that should settle don't, and the
operator gets paged for a transient).

### 2. Bot loop's `sleep` is not interruptible by the abort signal — MEDIUM

`packages/traders/src/runner.ts:115-136` (loop) + `22-23` (`sleep`):

```ts
while (!signal?.aborted) {
  ...
  if (signal?.aborted) break;
  await sleep(bot.intervalSec * 1000);   // <-- not abortable
}
```

`sleep` is a bare `setTimeout` promise that ignores `signal`. On SIGINT/SIGTERM
(`packages/traders/src/bin/run-bot.ts:34-37`), `controller.abort()` fires but a
bot mid-sleep keeps sleeping for up to a full `intervalSec` (commonly 30–60s)
before the loop re-checks `signal?.aborted`. The same applies to the startup
jitter sleep (`runner.ts:108-112`), which can be the full `intervalSec`.

Why it's wrong: the bin advertises "runs its loop until the process receives
SIGINT/SIGTERM"; in practice shutdown is delayed by up to the tick interval. If
the supervisor (the Makefile) follows SIGTERM with a SIGKILL on a short timeout,
the bot is hard-killed mid-interval rather than shutting down cleanly. The
in-tick `agent.runTick` is also not cancelled by the signal — but that's an LLM
round-trip with its own cost, less critical than the idle sleep. Severity is
medium because it's a graceful-shutdown/responsiveness defect, not a data bug.

### 3. `settlementJob` test's concurrency proof relies on a shared-mutable virtual clock — MEDIUM (test correctness)

`packages/automation/tests/settlementJob.test.ts:41-49` (`virtualClock`) and the
"does not let one wide-confidence market block a ready market (concurrent)" test
at `278-313`.

`virtualClock.sleep` does `nowMs += ms` on a single shared variable, and the test
asserts `readySettledAtClock === 0`. This passes only because the mock `settler`
resolves synchronously (microtask), so phase-1's `Promise.all` settles the
"ready" market before any virtual time advances. With a settler that actually
yielded to the event loop between markets (as the real `settleWithPyth` does at
every `await`), the two phase-2 retry loops would interleave their
`nowMs += intervalMs` mutations and the shared clock would advance
non-deterministically — the "settled at t=0" guarantee is an artifact of the mock,
not a property the real job has. The test is **green but not actually proving the
anti-blocking claim** for the real (interleaving) settler.

Why it matters: the anti-blocking design (phase 1 vs phase 2) is sound, but the
test gives false confidence about behavior under real async interleaving. This is
a test-quality finding, not a production bug — flagging it because the audit's
remit includes "race conditions in the jobs" and this is where one would hide.

### 4. `runSettlementJob` calls `opts.nowSeconds()` once per market in the partition loop — LOW

`packages/automation/src/settlementJob.ts:110`: `opts.nowSeconds()` is invoked
inside the `for (const m of markets)` loop. In production it's
`() => Math.floor(Date.now()/1000)` (`bin/run-settlement.ts:24`), so a long
`listMarkets` + loop could read two different "now" values across markets. Not a
real bug today (the values can only differ by ~1s and the program re-checks
timing on-chain anyway), but it's a latent inconsistency — the partition should
snapshot `const now = opts.nowSeconds()` once before the loop. LOW.

### 5. `bin/run-settlement.ts` can run for the full retry window in one foreground process — LOW

`packages/automation/src/bin/run-settlement.ts:19-27` + the doc at top: a single
invocation may block up to the wide-confidence window (default **15 min**)
because the retry loops are awaited inline. That's by design ("No resident
scheduler"), but combined with Finding 1's unbounded fan-out, a scheduler that
times out the cron at <15min would `SIGKILL` the job mid-retry-window, abandoning
in-flight settles. There's no signal handling in `run-settlement.ts` (unlike the
bot bin) to drain gracefully. LOW (operational, depends on the cron timeout).

### 6. `void sym` is a confusing no-op that signals an incomplete refactor — LOW (not async, adjacent)

`packages/traders/src/tools/priceHistory.ts:60-61`:

```ts
const sym = resolveSymbol(symbol); // validates the symbol; throws if unsupported
void sym;
```

`resolveSymbol` is kept only for its throwing side-effect, then the result is
discarded and the raw `symbol.toUpperCase()` is used everywhere after. Not an
async bug, but it's the kind of dead-binding that hides intent (a reader can't
tell if dropping `sym` was deliberate). Either inline `resolveSymbol(symbol)`
as a bare validation statement or actually use `sym`. LOW; overlaps with the
naming/slop audits.

## Things I checked and found CORRECT (no action)

- **`morningJob` ordering** (`morningJob.ts:84-136`): per-ticker, per-strike
  **serial** `for` loop with `await`. Each `provisionMarket`
  (`markets.ts:55-94`) runs `create → init_order_book → grow_order_book` strictly
  in sequence, each awaited through `chain.send` which `sendAndConfirmTransaction`
  *confirms* before returning, so the next step sees the prior account. This is
  the one place serial ordering is required, and it is serial. Correct.
- **Web hooks** (`useCurrentPrice`, `useChain`, `usePortfolio`, `useHistory`,
  `usePriceHistory`, `useIntradaySession`): every async effect guards with a
  `cancelled` flag set in the cleanup function before touching state, and clears
  its interval. No stale-closure setState-after-unmount. Correct.
- **Web write paths** (`useSendIx.ts`, `TradePanel.confirm/prepare`,
  `portfolio/page.tsx onRedeem`): async onClick handlers each try/catch
  internally, so React ignoring the returned promise causes no unhandled
  rejection. `useSendIx` correctly checks `confirmation.value.err` to avoid
  reporting a reverted tx as success. Correct.
- **`discoverOpenMarkets` cache** (`traders/context.ts:98-118`): in-flight
  coalescing, deletes the entry on failure (no caching of errors), per-program
  `WeakMap`. Textbook. Correct.
- **`BotChain.send`** (`traders/chain.ts:101-137`): retries only the *pre-signature*
  send phase on 429 (safe — nothing landed), never re-sends during confirm.
  Correct ordering reasoning.
- **`fetchRedeemHistory`** (`sdk/reads.ts:515-536`): batched `Promise.all`
  (BATCH=25) with per-tx `.catch(() => null)` so one bad tx doesn't sink the
  batch. Correct.
- **`fetchLiveCloses`** (`ops/liveCloses.ts:81-92`): `map(async)` into
  `Promise.all` where each entry is independent and failures degrade to a missing
  key. Correct use of parallelism (no ordering constraint).
- **`localValidator` Promise constructors** (`e2e/localValidator.ts:323-326,
  340`): the `exited` promise resolves on both `exit` and `error`, and the kill
  path `Promise.race([exited, delay(10_000)])` can't hang. Correct.
- **`retry.ts`** (`withBackoff`, `retryEvery`): both bounded, rethrow the last
  error, `retryEvery` rejects a non-positive interval instead of busy-looping.
  Correct.
- **CLI `.then/.catch`** (`run-settlement.ts`, `run-morning.ts`, ops bins): all
  top-level `main()` promises are `.catch`ed and `process.exit`. No floating
  top-level promise. Correct.

## Recommendations (severity, the fix + blast radius)

- **high — bound the settlement fan-out + give the post/settle path 429 backoff.**
  Replace the two bare `Promise.all` in `settlementJob.ts:119` and `143` with a
  small concurrency pool (e.g. cap at 3–5 concurrent settles), so the burst is
  spread instead of all-at-once. Independently, route `settleWithPyth`'s sends
  through a 429-aware retry like `BotChain.send` already has, or add a jittered
  retry to `PythSettler.settle` for transient/rate-limit errors *before* it
  classifies as `SettleStatus.Error` (so a 429 doesn't page the operator).
  Blast radius: changes the job's RPC concurrency and timing — see Risky calls.
  The unit tests mock the settler entirely, so the pool would need a new test;
  the LiteSVM integration test exercises the real settler but single-market.

- **medium — make the bot loop's sleep abortable.** Have `sleep` race against the
  abort signal (resolve early on `signal.aborted` / an `'abort'` listener) in
  `runner.ts`. Blast radius: `runner.ts` only; improves shutdown latency, no
  behavior change while running. Low risk.

- **medium — fix the concurrency test's clock.** Give each retry loop its own
  view or assert on call-ordering rather than a shared mutable `nowMs`, so the
  anti-blocking guarantee is proven under real interleaving. Blast radius:
  test-only.

- **low — snapshot `now` once** in `runSettlementJob`'s partition loop
  (`settlementJob.ts:110`). One-line change, no behavior change in practice.

- **low — add SIGTERM draining to `run-settlement.ts`** (mirror the bot bin) so a
  cron timeout doesn't abandon in-flight settles. Blast radius: the bin only.

- **low — drop the `void sym` dead binding** in `priceHistory.ts`. Cosmetic.

## Risky calls (fixes that change concurrency/ordering behavior — need care on-chain)

- **Bounding the settlement concurrency (Finding 1 fix) changes timing.** Today
  every market is attempted simultaneously; a pool serializes some of them. This
  is *safe* on-chain — settles are independent per market, idempotent, and the
  program re-checks `now >= trading_day` and confidence itself — but it **slows
  the tail**: with a pool of 5 and ~42 markets, the last batch starts later, so
  worst-case settlement latency for some markets grows. That's an acceptable
  trade (correct-but-slower beats fast-but-429-and-paging), but the pool size is
  a real tuning knob, not a free win. Do **not** serialize fully (pool of 1) —
  that reintroduces the "one stuck market blocks a ready one" problem the
  two-phase design was built to avoid (and which test 278-313 guards).

- **Adding 429 retry inside `PythSettler.settle` interacts with the
  wide-confidence retry loop.** The loop (`retryWideConfidence`) already retries
  the *whole* settle on WideConfidence; a new inner retry must only catch
  transient/429 errors and must **not** retry a real WideConfidence or
  MarketSettled (those are already handled by classification). Get the
  error-marker matching right or you'll either double-retry or mask a genuine
  wide-confidence escalation.

- **Closing Receiver update accounts** (`closeUpdateAccounts`) would change the
  on-chain footprint and the signatures returned; out of scope for an async fix,
  but noted since the burst makes orphaned-account rent visible.

## Conflicts/dependencies with other concerns (esp. defensive-programming)

- **Defensive-programming (06):** that audit rated the error handling here as
  well-disciplined (43 KEEP / 2 REMOVE) and specifically blessed `retry.ts`,
  `BotChain.send`'s 429 backoff, and the jobs' "never reject on one market"
  boundaries. My Finding 1 does **not** contradict that — the handling is
  correct; the gap is that the *settlement* path lacks the very 429 backoff that
  audit praised on the *trader* path. The fix (add backoff to the settle path)
  *extends* the pattern 06 endorsed rather than removing any KEEP block. The
  proposed inner-retry must be added carefully so it doesn't become a new
  "swallow + misclassify" that 06 would flag.
- **Naming/boundaries (10) & dedup (01):** the `void sym` (Finding 6) and the
  fact that `settleWithPyth` reimplements send/confirm with no shared 429 logic
  (while `BotChain` and `RpcChainClient` both have their own variants) overlap
  with those audits — there are now *three* tx-send implementations
  (`pyth.ts` via `sendAndConfirmTransaction`, `automation/chain.ts`,
  `traders/chain.ts`) with divergent rate-limit behavior. Consolidating them
  would fix Finding 1's missing-backoff at the root; coordinate the concurrency
  fix with any send-path dedup so they don't conflict.
- **No conflict** with the type-consolidation or circular-deps audits.
