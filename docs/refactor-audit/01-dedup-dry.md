# 01 — Deduplication / DRY Audit

## Summary

The monorepo exhibits moderate duplication concentrated in **logger implementations** (two incompatible variants serving different audiences), **transaction-sending patterns** across chain boundary adapters (traders/automation/web/ops), **dollar-to-baseunits conversion** defined 3+ times independently, and **test fixture builders** scattered across packages. Consolidating these into the SDK and cross-package utilities would eliminate ~800 LOC of redundancy and establish single sources of truth for on-chain math operations. Most findings are **high confidence** because they involve copy-pasted logic or parallel implementations of the same contract.

---

## Findings

### 1. Duplicated Logger Implementations (HIGH confidence)

**Issue:** Two incompatible logger systems serve different audiences—automation uses structured JSON for aggregators; traders uses human-readable line-oriented format—but share ~70% of the implementation skeleton (createLogger factory, sink injection, field rendering).

**Evidence:**
- `/packages/automation/src/logger.ts:54-66` — `createLogger(opts)` pattern with injected sink
- `/packages/traders/src/logger.ts:93-114` — parallel `createLogger(opts)` with identical structure but different output format
- Both define `stdoutSink()` functions that differ only in output shape (JSON vs line format)
- Both inject `now()` clock for deterministic testing

**Duplication extent:** ~120 LOC (shared factory, clock injection, core `emit` pattern)

**Recommendation:** **HIGH confidence**  
Create `@meridian/sdk` base logger interface + factory (`createLoggerFactory`) that both packages subclass with their own sink/formatter. Reduces code, allows test harnesses to capture both formats uniformly.

**Blast radius:** automation, traders (both depend on logger)  
**Complexity:** Low—loggers are independent; new SDK export is purely additive

---

### 2. Transaction-Sending / RPC Retry Patterns (HIGH confidence)

**Issue:** Five locations independently implement transaction send-and-confirm with subtle variations (rate-limit retry, signature polling, blockhash management). No shared retry logic or error classification.

**Evidence:**
- `/packages/traders/src/chain.ts:101-160` — `BotChain.send()` w/ jittered backoff retry, HTTP polling confirmation
- `/packages/automation/src/chain.ts:94-103` — `RpcChainClient.send()` w/ plain `sendAndConfirmTransaction`
- `/packages/e2e/src/fixture.ts:497-507` — `sendTx()` helper w/ `sendAndConfirmTransaction` wrapper
- `/packages/web/src/lib/useSendIx.ts:34-72` — React hook w/ blockhash + confirmation tracking
- `/packages/ops/src/devStack.ts:2` mentions sendTransaction (1 occurrence)
- `/packages/ops/src/bootstrap.ts`, `/packages/ops/src/lifecycle.ts` — likely more patterns

**Duplication extent:** ~400 LOC (including error handling, retry, confirmation loops)

**Recommendation:** **HIGH confidence**  
Consolidate into `@meridian/sdk` as:
- **Base:** `RpcClient` interface (send, confirm, fetch) with a default `StandardRpcClient` using HTTP polling (traders need it; automation doesn't).
- **Utilities:** `isRateLimited()`, `rateLimitBackoffMs()`, `confirmBySignature()` (polling), `confirmByWS()` (WebSocket fallback).
- **Exports:** Let traders re-export its `BotChain` from sdk; have automation use `StandardRpcClient` directly.

**Blast radius:** traders, automation, web, ops, e2e  
**Complexity:** Medium—requires abstracting RpcChainClient as an interface and de-coupling retry logic from concrete implementations. Non-breaking.

---

### 3. Duplicated Dollar-to-Base-Units Conversion (HIGH confidence)

**Issue:** The same operation (`dollars * PAYOFF_UNIT`) is defined **3 times** independently with no cross-package sharing, blocking consolidation of strike math.

**Evidence:**
- `/packages/automation/src/config.ts:217-219` — `dollarsExactToBaseUnits(dollars)` in config loader
- `/packages/automation/src/strikes.ts:95-107` — `dollarsToBaseUnits(dollars)` in strike computation (exported)
- `/packages/ops/src/settleDue.ts:65` — `dollarsToBaseUnits = (d) => new BN(Math.round(d * SCALE))`
- `/packages/ops/src/liveCloses.ts:26-28` — another `dollarsToBaseUnits()` definition

**Duplication extent:** ~20 LOC (function body is 1-2 lines, but scattered across 4 files)

**Recommendation:** **HIGH confidence**  
Move **both** `PAYOFF_UNIT`-based conversions (`dollarsExactToBaseUnits` + `dollarsToBaseUnits`) to `@meridian/sdk/src/constants.ts` or a new `@meridian/sdk/src/math.ts`. Re-export from automation for backward compatibility. Rationale: these are on-chain math constants tied to the program, not configuration.

**Blast radius:** automation, ops (both depend on these functions)  
**Complexity:** Low—purely consolidation; no logic changes.

---

### 4. Duplicated Price-Complement Logic (MEDIUM-HIGH confidence)

**Issue:** `PRICE_SCALE.sub(price)` (computing the complement/opposite side price) appears **12+ times** across traders, web, sdk, and e2e in nearly identical form. Two stable functions exist but one is in web (not exported to other packages).

**Evidence:**
- `/packages/sdk/src/reads.ts:280-287` — `complementPrice(price)` exported from sdk ✓
- `/packages/sdk/src/intent.ts:121` — local `return PRICE_SCALE.sub(p)` (not in function)
- `/packages/web/src/lib/market-math.ts:43-44` — `impliedComplement(price)` (private to web, re-implements sdk's complementPrice)
- `/packages/traders/src/tools/placeOrder.ts:91, 94` — two instances of `PRICE_SCALE.sub(price)` (should use complementPrice)
- `/packages/traders/src/format.ts:38, 47` — implicit in price scaling (not called out but related)
- `/packages/web/src/lib/portfolio.ts:89`, `/packages/web/src/lib/tradeForm.ts:42`, `/packages/web/src/lib/recordTradeFill.ts:28`, `/packages/web/src/lib/leaderboard.ts:81`, `/packages/e2e/src/crossing.ts:51` — all use `PRICE_SCALE.sub(price)` directly

**Duplication extent:** ~30 LOC (scattered inline; function exists but not universally imported)

**Recommendation:** **MEDIUM-HIGH confidence**  
- Ensure `complementPrice` is widely imported and used (it's already exported from sdk).
- Add it to the sdk's public surface doc so it's discoverable.
- Flag traders' inline `PRICE_SCALE.sub(price)` calls as a refactor opportunity (call `complementPrice` instead).

**Blast radius:** traders, web, e2e, sdk  
**Complexity:** Low—the function exists; just needs to be used consistently.

---

### 5. Test Fixture Builders / Mock Market Creation (MEDIUM confidence)

**Issue:** Multiple test files define nearly identical "create a mock market" or "create a book" helper functions, each local to its test file. No shared test utilities across packages.

**Evidence:**
- `/packages/traders/tests/crossing.test.ts:32-40` — `book()` and `order()` helpers
- `/packages/web/src/lib/leaderboard.test.ts:26-55` — `market()`, `emptyBook()` helpers
- `/packages/web/src/lib/crossing.test.ts:39-58` — `book` const (inline OrderBookAccount)
- `/packages/automation/tests/settlementJob.test.ts:52-77` — `freshMarket()` helper
- `/packages/sdk/tests/reads.test.ts:21-43` — `readBook()` and `norm()` helpers
- `/packages/e2e/tests/crossing.contract.test.ts:54-72` — `book` const (inline)
- `/packages/e2e/tests/lifecycle.test.ts:265-268`, `/packages/e2e/tests/trade-paths.test.ts:312-315` — `marketAddr()`, `yesMint()` helper pairs

**Duplication extent:** ~150 LOC (across 7+ test files; each defines 2-4 helpers)

**Recommendation:** **MEDIUM confidence**  
Create `@meridian/sdk/tests/testFixtures.ts` exporting:
- `createMockOrderBook(opts)` — centralized book builder
- `createMockMarket(opts)` — centralized market builder
- `createMockOrder(owner, side, price, size, seq)` — order factory
- PDA helpers like `marketAddr(id)`, `yesMint(id)` (or just import them)

Re-export from each test harness (automation, web, traders, e2e) for convenience. Reduces copy-paste and ensures all tests work with identical mock shapes.

**Blast radius:** automation tests, traders tests, web tests, e2e tests (all benefit but not required)  
**Complexity:** Low—new module; replaces copy-pasted code with imports.

---

### 6. Configuration Loading / Environment Validation (MEDIUM confidence)

**Issue:** automation and traders both implement config loading with environment variable parsing and validation, but automation's is more thorough. Traders replicates *some* patterns (e.g., reading from env, required/optional fields) without reusing.

**Evidence:**
- `/packages/automation/src/config.ts:53-72` — `required()`, `parsePubkey()`, `parseTickers()`, `parseBool()` validation helpers
- `/packages/traders/src/config.ts:124-165` — `loadEnvironment()` re-implements validation without helpers from automation
- Both read `RPC_URL`, both read optional URL overrides, both validate enum-like values (PriceSource vs priceSource)

**Duplication extent:** ~60 LOC (validation boilerplate, repeated across two config modules)

**Recommendation:** **MEDIUM confidence** (caveat: config is package-specific, so shared validators may add coupling)  
Extract **only** the validator helpers (required, parsePubkey, parseBool, parseEnum) to `@meridian/sdk/src/config-validators.ts` (or similar). This is generic validation logic, not domain-specific. Keep package-level config structures (AutomationConfig vs Environment) separate.

**Blast radius:** automation, traders (both use environment config)  
**Complexity:** Low—pure helper extraction; no behavioral change.

---

### 7. Keypair Loading from File / Environment (MEDIUM confidence)

**Issue:** Keypair loading from JSON file or secret string is done in automation, traders (via wallet handlers), and ops/e2e test utilities. No shared, tested helper.

**Evidence:**
- `/packages/automation/src/keypair.ts:32-80` — `loadKeypairFromEnv()` with full validation (tests in config.test.ts)
- `/packages/web/src/lib/localWallet.ts:77-90` — `loadKeypair()` reads from a file path (e2e wallet)
- `/packages/web/src/lib/e2eWallet.ts:52-66` — another `loadKeypair()` variant
- `/packages/e2e/tests/devnet-settle.smoke.test.ts:50-65` — `loadKeypair()` local helper
- `/packages/traders/src/config.ts` does not export a keypair loader; it defers to environment

**Duplication extent:** ~40 LOC (repeated file/JSON parsing; some variation in error handling)

**Recommendation:** **MEDIUM confidence**  
Export `loadKeypairFromEnv()` from `@meridian/sdk` (move from automation) and add a new `loadKeypairFromFile()`. Both are generic Solana utilities, not automation-specific. Keep automation's validation (required env check) inside automation; the SDK provides only the parsing/loading logic.

**Blast radius:** automation (now re-exports from sdk), traders (can use it), web, ops, e2e  
**Complexity:** Low—copy existing automation code to sdk, add file-path variant.

---

### 8. PDA / Token Account Derivation Helpers (LOW-MEDIUM confidence)

**Issue:** PDA derivation helpers are correctly centralized in `@meridian/sdk/src/pdas.ts` and `@meridian/sdk/src/reads.ts`, but a few scattered helpers are re-implemented locally:
- `marketAddr(id)` and `yesMint(id)` functions are defined in multiple e2e test files (should import from sdk).
- Some tests compute ATAs inline instead of calling `ata()` from sdk.

**Evidence:**
- `/packages/sdk/src/pdas.ts:165-180` — `ata()` and `userTokenAccounts()` exported ✓
- `/packages/e2e/tests/lifecycle.test.ts:265-271` — local `marketAddr()`, `yesMint()` definitions (should use `marketPda()`, `yesMintPda()` from sdk)
- `/packages/e2e/tests/trade-paths.test.ts:312-320` — duplicates the above local helpers
- `/packages/web/src/lib/leaderboardData.ts:96, 117, 119` — computes wallet filtering inline (uses `PublicKey.isOnCurve()`) instead of a helper

**Duplication extent:** ~30 LOC (mostly test helpers, not production code)

**Recommendation:** **LOW-MEDIUM confidence**  
- Create a small SDK test export (`@meridian/sdk/tests/pdaHelpers.ts` or similar) with `marketAddr(id)`, `yesMint(id)`, `noMint(id)` wrappers for convenience.
- Flag the three `PublicKey.isOnCurve()` checks in leaderboardData.ts as candidates for a `isWalletAccount()` helper (not urgent; low impact).

**Blast radius:** e2e tests (low impact; test-only), web (minor cleanup)  
**Complexity:** Very low—convenience wrappers.

---

### 9. PRICE_SCALE Constant Redefinition (LOW confidence)

**Issue:** `PRICE_SCALE` is defined in `@meridian/sdk/src/constants.ts` and exported, but `web/src/lib/portfolio.ts:85` redefines it locally (`const PRICE_SCALE = new BN(1_000_000)`). This is redundant but low-impact.

**Evidence:**
- `/packages/sdk/src/constants.ts:26` — `export const PRICE_SCALE = new BN(idlConstant("PRICE_SCALE"))`
- `/packages/web/src/lib/portfolio.ts:85` — `const PRICE_SCALE = new BN(1_000_000)` (local redefinition)
- All other files correctly import from sdk

**Duplication extent:** 1 LOC (one const declaration; no functional duplication)

**Recommendation:** **LOW confidence**  
Import `PRICE_SCALE` from sdk in portfolio.ts; remove the local redefinition. This is trivial but improves consistency.

**Blast radius:** web (minimal)  
**Complexity:** Trivial.

---

### 10. Retry / Backoff Utilities (LOW-MEDIUM confidence)

**Issue:** `rateLimitBackoffMs()` and `isRateLimited()` error classification helpers are defined locally in traders' `chain.ts` and should be shared (if they diverge, they should be unified).

**Evidence:**
- `/packages/traders/src/chain.ts:23-49` — `isRateLimited()` and `rateLimitBackoffMs()` with jitter
- No other package implements this; it's unique to traders but could be reused if ops/automation hit 429s

**Duplication extent:** ~30 LOC (utilities; low probability of reuse but good to have in SDK)

**Recommendation:** **LOW-MEDIUM confidence**  
Move to `@meridian/sdk/src/rpc-utils.ts` alongside transaction-sending utilities. Mark as "experimental" if you want to signal it may evolve. Low cost, good for future-proofing.

**Blast radius:** traders (currently only user)  
**Complexity:** Low—pure function extraction.

---

## Recommendations Summary

| Priority | Finding | Module | Effort | Impact |
|----------|---------|--------|--------|--------|
| **HIGH** | Duplicate loggers | automation + traders → sdk | Medium | 120 LOC saved; unified testing |
| **HIGH** | Transaction-sending patterns | traders + automation + web + ops → sdk | Medium-High | 400 LOC saved; single source of truth for RPC interaction |
| **HIGH** | Dollar-to-base-units conversion | automation + ops → sdk | Low | 20 LOC saved; eliminates strike math fragmentation |
| **MEDIUM-HIGH** | Price complement logic | traders + web → sdk (already exported) | Low | Consistency; relies on import discipline |
| **MEDIUM** | Test fixtures | automation + traders + web + e2e → sdk/tests | Low | 150 LOC saved; uniform test setup |
| **MEDIUM** | Config validation helpers | automation + traders | Low | 60 LOC saved; generic validators in sdk |
| **MEDIUM** | Keypair loading | automation (→ sdk) + web + ops + e2e | Low | 40 LOC saved; single tested loader |
| **LOW-MEDIUM** | PDA test helpers | e2e → sdk/tests | Very Low | 30 LOC; convenience only |
| **LOW** | PRICE_SCALE redefinition | web | Trivial | 1 LOC; import instead |
| **LOW-MEDIUM** | Retry/backoff utils | traders → sdk | Low | 30 LOC; future-proofing |

---

## Risky Calls (Behavior-Altering Changes)

1. **Logger consolidation:** The two loggers output *different* formats (JSON vs line). Unifying them requires ensuring each consumer gets its preferred output. Risk: medium. Mitigation: create base class; preserve output format via injectable sink.

2. **Transaction-sending consolidation:** traders' implementation includes rate-limit retry logic that automation doesn't use. Moving it to sdk means automation could optionally use it. Risk: low (backward-compatible). Mitigation: make retry optional via config; default to automation's simple sendAndConfirmTransaction for backward compat.

3. **Moving PAYOFF_UNIT conversions to sdk:** These are on-chain constants, so moving them is safe. Risk: minimal.

---

## Conflicts / Dependencies with Other Concerns

- **Type consolidation audit:** May reveal duplicated types (e.g., MarketId, UserPosition) that should also move to sdk. Coordinate with type audit to batch moves.
- **Magic numbers / constants audit:** Overlaps heavily on dollar/base-unit conversions and PRICE_SCALE. Consolidate first; then audit will find fewer constants.
- **Unused code audit:** Some of these duplicates may be dead code in certain files (e.g., if traders never actually calls its local complementPrice logic). Run unused-code audit *after* dedup to confirm.
- **Async/error-handling refactor:** Transaction-sending consolidation is a prerequisite for harmonizing error handling across the fleet (morning job vs bot vs web).

---

## Next Steps

**Sequencing recommendation:**
1. **Phase 1 (High-impact, low-risk):** Move dollar-to-base-units + PRICE_SCALE fixes + test fixtures to sdk. (Week 1)
2. **Phase 2 (Medium-effort):** Consolidate transaction-sending patterns; add base logger interface. (Week 2)
3. **Phase 3 (Cleanup):** Config validators, keypair loading, PDA test helpers, retry utils. (Week 3)
4. **Validation:** Run full test suite after each phase. Measure: LOC reduction, import depth, test duplication count.

