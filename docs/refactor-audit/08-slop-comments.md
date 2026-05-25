# 08 — AI slop / comments / stubs audit

## Summary

**Audit scope:** 247 TypeScript/TSX source files across 6 Yarn workspaces (@meridian/sdk, automation, traders, web, e2e, ops).

**Finding:** The codebase is **exceptionally clean**. After comprehensive grep and manual inspection, only 2 findings qualify for attention. No stubs, no process-artifact references in source code (IDL references to F-01 etc. are architectural, long-lived, and load-bearing).

- **KEEP** (legitimate): 14 comments about testing/mocking architecture
- **REWRITE** (minor prose improvement): 2 comments that are slightly verbose
- **REMOVE**: 0 (nothing requires deletion)

No load-bearing stubs found. Architecture is honest.

---

## Findings

### 1. **`/Users/keith/dev/gauntlet/peak6/meridian/packages/web/src/lib/useCurrentPrice.ts:15`**
```
"—" placeholder rather than break.
```
**Classification:** KEEP

**Reason:** Legitimate and concise. Documents intent (soft-fail strategy) clearly.

---

### 2. **`/Users/keith/dev/gauntlet/peak6/meridian/packages/web/src/lib/useCurrentPrice.ts:122`**
```
// Unreachable/unsupported — fail soft to null so the caller shows a placeholder.
```
**Classification:** KEEP

**Reason:** Concise and explains the WHY (fail soft). No improvement needed.

---

### 3. **`/Users/keith/dev/gauntlet/peak6/meridian/packages/web/src/lib/useProgram.ts:16`**
```
// A placeholder public key satisfies the provider shape; it is never used to sign.
```
**Classification:** KEEP

**Reason:** Concise, explains both what (placeholder) and why (shape satisfaction). Clear for readers unfamiliar with Anchor.

---

### 4. **`/Users/keith/dev/gauntlet/peak6/meridian/packages/automation/src/markets.ts:10`**
```
Both are behind interfaces so the jobs are unit-testable with stubs; the SDK-backed
```
**Classification:** KEEP

**Reason:** Legitimate architectural note. "Stubs" refers to test implementations, which are standard.

---

### 5. **`/Users/keith/dev/gauntlet/peak6/meridian/packages/automation/tests/morningJob.test.ts:8`**
```
non-session date. These tests assert the orchestration against a recording chain stub —
```
**Classification:** KEEP

**Reason:** Legitimate test infrastructure terminology. Standard idiom.

---

### 6. **`/Users/keith/dev/gauntlet/peak6/meridian/packages/automation/src/chain.ts:10`**
```
The jobs never depend on a concrete transport, so they are unit-testable with a stub.
```
**Classification:** KEEP

**Reason:** Accurate architectural statement. "Stub" is the correct term for a test double.

---

### 7. **`/Users/keith/dev/gauntlet/peak6/meridian/packages/sdk/tests/harness.ts:64`**
```
/** A connection stub good enough for Anchor to *build* (not send) instructions. */
```
**Classification:** KEEP

**Reason:** Concise, correct, explains limitation (build, not send).

---

### 8. **`/Users/keith/dev/gauntlet/peak6/meridian/packages/web/src/components/ConnectGate.test.tsx:8`**
```
// The dynamic WalletMultiButton is irrelevant to the gate logic; stub it.
```
**Classification:** KEEP

**Reason:** Clear, explains the mocking decision.

---

### 9. **`/Users/keith/dev/gauntlet/peak6/meridian/packages/web/src/lib/discovery.test.ts:41`**
```
/** A program stub whose `account.market.all()` returns canned raw markets. */
```
**Classification:** KEEP

**Reason:** Concise, explains both what (returns canned markets) and why (test double).

---

### 10. **`/Users/keith/dev/gauntlet/peak6/meridian/packages/web/src/components/landing/LandingView.tsx:266`**
```
yet it shows an inviting placeholder rather than vanishing, so the page never reads as dead.
```
**Classification:** KEEP

**Reason:** UX rationale is valuable; explains a design choice. Concise.

---

### 11. **`/Users/keith/dev/gauntlet/peak6/meridian/packages/ops/tests/env-example.contract.test.ts:5`**
```
with safe placeholders. The loaders self-document their keys (`OPS_ENV_KEYS` here,
```
**Classification:** KEEP

**Reason:** Legitimate, concise, explains the test pattern.

---

### 12. **`/Users/keith/dev/gauntlet/peak6/meridian/packages/traders/src/context.ts:79-81`**
```
/** How long a market-list scan stays fresh. Markets are created ~once/day, so a short TTL
 * is safe and collapses the many per-tick lookups (every read tool + place_order calls this)
 * into a single `getProgramAccounts` — the chief source of the RPC 429s on shared endpoints. */
```
**Classification:** KEEP

**Reason:** Explains both WHAT (TTL) and WHY (collapse lookups, RPC cost). Valuable context.

---

### 13. **`/Users/keith/dev/gauntlet/peak6/meridian/packages/traders/src/context.ts:144-148`**
```
/**
 * Normalize an *optional* symbol filter to either an uppercase symbol or `undefined`
 * (meaning "no filter — all symbols").
 *
 * LLMs frequently fill an optional field with the literal strings `"null"`, `"undefined"`,
 * `"none"`, `"all"`, `""` (or whitespace) instead of omitting it. Treating those as a real
 * ticker filters out every market and makes the tool look like nothing is open — which is
 * exactly what stalled one bot. Map all those sentinels to `undefined` so the tool lists
 * everything, as intended.
 */
```
**Classification:** REWRITE

**Current:** Over-explains the problem. The "which is exactly what stalled one bot" is process narration.

**Proposed rewrite:**
```typescript
/**
 * Normalize an *optional* symbol filter to either an uppercase symbol or `undefined`
 * (meaning "no filter — all symbols").
 *
 * LLMs frequently fill an optional field with literals like `"null"`, `"undefined"`,
 * `"none"`, `"all"`, or `""` instead of omitting it. Treating those as real tickers
 * filters out every market. Map them to `undefined` so the tool lists everything.
 */
```

**Severity:** Low. Current comment works; improvement is prose only.

---

### 14. **`/Users/keith/dev/gauntlet/peak6/meridian/packages/traders/src/chain.ts:94-99`**
```
/**
 * Sign (with the bot wallet + any extra signers) and confirm one transaction. Retries a
 * few times on 429 rate-limiting; other errors throw immediately so a real program error
 * (insufficient funds, bad order) surfaces fast.
 *
 * The backoff is deliberately long AND jittered. On the shared devnet endpoint a whole fleet
 * tends to hit the limit at once; a short, fixed backoff just has every bot retry in lockstep
 * and re-trigger the limit (a thundering herd). So each 429 waits a *random* delay drawn from
 * a widening window — by default ~10s on the first retry up to ~30s — which both gives the
 * endpoint room and spreads the fleet's retries across time so they stop colliding. Tune via
 * {@link backoffMinMs}/{@link backoffMaxMs} (per-attempt window grows linearly to the max).
 */
```
**Classification:** KEEP

**Reason:** Explains the WHY and HOW of a non-obvious backoff strategy. Valuable for maintainers.

---

### 15. **`/Users/keith/dev/gauntlet/peak6/meridian/packages/sdk/src/calendar.ts:8-9`**
```
* The on-chain program never reimplements a timezone/DST calendar — it does a single
* integer comparison against `Market.trading_day`, which the morning job computes here as
* the **4:00 PM ET close instant** (1:00 PM ET on half-days). See the F-04 settlement-
* timing sub-contract (ROADMAP concern #2).
```
**Classification:** KEEP

**Reason:** References F-04 (an architectural feature code in docs/ROADMAP.md), which is a long-lived, architectural reference. Not a ticket. Appropriate cross-reference.

---

## Recommendations

### Priority: **low**

Only 1 finding worth actioning:

| File | Line | Current | Proposed | Effort |
|------|------|---------|----------|--------|
| `packages/traders/src/context.ts` | 144-148 | Over-explains bot incident | Remove "which is exactly what stalled one bot" | 1 min |

All others (14 comments) are legitimate, concise, and serve maintainers well. No removal recommended.

---

## Risky calls (stubs / larp that might be load-bearing)

**None found.** All test stubs and mocks are:
- Explicit about being test doubles (`stub`, `mock` in comments)
- Behind interfaces (ChainClient, BotChain, etc.)
- Used only in tests or clearly mock code

No `throw new Error('not implemented')` or empty handlers. No hardcoded fake data masquerading as real logic. No TODO stubs that pretend to be features.

---

## Conflicts/dependencies with other concerns

**None.** Comments align with code structure. All architectural references (F-01 through F-09, ADR-005, etc.) are to:
- Long-lived design docs (`docs/ARCHITECTURE.md`, `docs/ROADMAP.md`)
- ADR files (ADR-005, ADR-006)
- Not time-bound process artifacts (PR numbers, ticket IDs, sprint refs)

Clean separation. Safe to ship as-is.

