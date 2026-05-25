# 12 — Magic numbers & config audit

## Summary

Found **8 duplicated core constants** across packages (highest drift risk), **11 polling/timeout magic numbers**, and **scattering of PRICE_SCALE (1e6)** across frontend. The Meridian SDK cleanly centralizes money/decimals constants (PAYOFF_UNIT, PRICE_SCALE, TOKEN_DECIMALS) from IDL, but frontend reimplements PRICE_SCALE independently; strike basis-point offsets (±3/6/9%), settlement retry windows, and polling intervals are hardcoded without central config. All PDA seed strings are properly centralized in `sdk/pdas.ts`.

**Critical duplicates (drift risk):**
- `PRICE_SCALE = 1_000_000` defined in 4 places (SDK const, web/portfolio, web/results, web/marketStats)
- `USDC_DECIMALS = 6` implied everywhere (not explicitly named outside SDK constants)
- Settlement error codes (6000, 6017, 6005) computed inline in automation settler
- Basis-point denominator (10_000) defined once, BPS offsets (300/600/900) defined once — **good**
- Polling intervals: 15_000ms, 20_000ms, 8_000ms scattered without names (3 places)

## Findings

### Money/Decimal Constants (Best Practice: Already Centralized)

| File | Line | Constant | Meaning | Duplicates | Notes |
|------|------|----------|---------|-----------|-------|
| `sdk/src/constants.ts` | 20 | `PAYOFF_UNIT = 1_000_000 (1e6)` | $1.00 payout / collateral unit (6dp) | IDL constant, reference | ✓ Single canonical home via IDL |
| `sdk/src/constants.ts` | 26 | `PRICE_SCALE = 1_000_000 (1e6)` | Price range [$0, $1.00], 6dp | 4 reimplementations | ⚠ Duplicated in web (see below) |
| `sdk/src/constants.ts` | 29 | `TOKEN_DECIMALS = 6` | Yes/No token scale | Implied, not always named | ⚠ Used everywhere, never fails |
| `sdk/src/constants.ts` | 32 | `USDC_DECIMALS = 6` | Collateral scale | Implicit (literal 6 appears in tests) | ⚠ Hardcoded 6 in many places |

**Web reimplementations (drift risk):**
- `web/src/lib/portfolio.ts:85` — `const PRICE_SCALE = new BN(1_000_000)` (local scope only)
- `web/src/lib/results.ts` — `const PRICE_SCALE = new BN(1_000_000)` + `PRICE_SCALE_NUM = 1_000_000` (2 forms)
- `web/src/lib/marketStats.ts` — `const STRIKE_SCALE = 1_000_000` (renamed, same value)
- `web/src/lib/format.ts:85` — `const USDC_BASE = 1_000_000` (local scope only)

**Test value conversions (implies 1e6):**
- `traders/tests/format.test.ts` — `amountToUnits(10).toString() == "10000000"` (10 * 1e6)
- `web/src/lib/tradeAffordability.test.ts` — `const U = (n) => new BN(n * 1_000_000)` (test helper, implies dollars → base units)
- Throughout: multiplying/dividing by 1_000_000 or 1e6 without naming (all comments say "6dp")

### Basis Points & Strike Offsets (Well Centralized)

| File | Line | Constant | Meaning | Usage |
|------|------|----------|---------|-------|
| `automation/src/strikes.ts` | 21 | `STRIKE_OFFSET_BPS = [300, 600, 900]` | ±3/6/9% offsets in basis points | `strikes.test.ts` verifies it |
| `automation/src/strikes.ts` | 26 | `BPS_DENOMINATOR = new BN(10_000)` | Basis points scale (10_000 = 100%) | Lines 55 (market PnL computation) |
| `automation/src/strikes.ts` | 24 | `STRIKE_ROUND_DOLLARS = 10` | Rounding granularity | Lines 28 (ROUND_STEP = $10 base units) |

✓ **Good:** All three are named, used only in one module, tests exist.

### Polling/Timeout/Retry Intervals (Scattered Magic Numbers)

| File | Line | Constant | Meaning | Value | Notes |
|------|------|----------|---------|-------|-------|
| `web/src/lib/useCurrentPrice.ts` | 33 | `REFRESH_MS` | Price quote re-pull interval | 15_000 ms (15s) | Endpoint caches ~5s, UI refreshes every 15s |
| `web/src/lib/useChain.ts` | 30 | `DEFAULT_POLL_MS` | Generic polling default | 8_000 ms (8s) | Used by markets, config, order books |
| `web/src/lib/useUsdcBalance.ts` | 46 | `setInterval(pull, 20_000)` | USDC balance poll | 20_000 ms (20s) | No named constant, inline magic number |
| `web/src/lib/usePortfolio.ts` | 136 | `setInterval(..., 15_000)` | Portfolio refresh | 15_000 ms (15s) | No named constant, inline magic number |
| `web/src/components/trade/Countdown.tsx` | `setInterval(..., 1000)` | Trading day countdown tick | 1_000 ms (1s) | Display precision, reasonable as-is |
| `automation/src/settlementJob.ts` | 92 | `retryIntervalMs ?? 30_000` | Wide-confidence retry interval | 30_000 ms (30s) | Default, injectable, well-documented |
| `automation/src/settlementJob.ts` | 93 | `retryMaxMs ?? 15 * 60_000` | Wide-confidence budget | 900_000 ms (15 min) | Default, injectable, well-documented |
| `automation/src/morningJob.ts` | 51 | `baseDelayMs ?? 1000` | Exponential backoff base | 1_000 ms (1s) | Default, injectable |
| `automation/src/retry.ts` | comment | Hard-coded in `withBackoff`/`retryEvery` | No defaults named constants | See options interface | Parameters passed via `BackoffOptions` |
| `traders/src/chain.ts` | comment | `rateLimitBackoffMs` jitter window | Computed, no magic constant | Formula | Jitter = `lo + random * (ceiling - lo)` |

**⚠ Issues:**
1. `useUsdcBalance` and `usePortfolio` have inline 20_000 and 15_000 with no constant name → can't easily sync if needed
2. `useCurrentPrice` (15_000) and `usePortfolio` (15_000) both use same interval but independently — drift risk if one needs tuning
3. Web polling values (8s, 15s, 20s) are not config-driven or named (no `POLLING_CONFIG` export from a config module)
4. Automation defaults (30s retry, 15min budget) are reasonable but defined inline with `??` operators, not a named defaults object

### Error Codes (Settlement)

| File | Line | Constant | Code | Meaning | Form |
|------|------|----------|------|---------|------|
| `automation/src/settler.ts` | 42 | `WIDE_CONFIDENCE_CODE` | 6017 (6000 + 17) | WideConfidence anchor error | `const = 6000 + 17` |
| `automation/src/settler.ts` | 43 | `MARKET_SETTLED_CODE` | 6003 (6000 + 3) | MarketSettled anchor error | `const = 6000 + 3` |
| `automation/src/settler.ts` | 50 | `codeMarkers(code)` | — | Builds hex (0x…) and decimal markers | Function, good abstraction |
| `automation/src/settler.ts` | 59–74 | `WIDE_CONFIDENCE_MARKERS`, `ALREADY_SETTLED_MARKERS` | — | Error classification arrays | Array of name/msg/code markers |
| `automation/src/markets.ts` | comment | Anchor error offset | 6000 | Base offset for custom errors | Inline comment, no constant |
| `automation/tests/settler.test.ts` | comment | 0x1781 = 6017 | 6017 | WideConfidence hex | Test comment only |

**⚠ Issues:**
1. Magic number `6000` (Anchor error base offset) is only documented in comments, not a constant
2. Error codes are hard to audit: derived from the Rust program's ordinals, no TypeScript validation that they match `error.rs`
3. Test comment documents hex 0x1781 = 6017 manually, should use a helper if more error codes are added

### PDA Seed Strings (Well Centralized ✓)

| File | Lines | Constant | Seed | Notes |
|------|-------|----------|------|-------|
| `sdk/src/pdas.ts` | 31–39 | CONFIG_SEED, MARKET_SEED, ORDER_BOOK_SEED, VAULT_SEED, MINT_AUTH_SEED, YES_MINT_SEED, NO_MINT_SEED, USDC_ESCROW_SEED, YES_ESCROW_SEED | "config", "market", "order_book", "vault", "mint_auth", "yes_mint", "no_mint", "usdc_escrow", "yes_escrow" | ✓ All named, single source, comments document correspondence to program |
| `sdk/src/pdas.ts` | 13–27 | Comments | — | Clear docstring of each seed and field encoding | ✓ Excellent documentation |

**✓ Good:** All PDA seeds are centralized, named, and tested (pdas.test.ts validates against actual account creation).

### Program ID & Pyth Receiver ID

| File | Line | Constant | Value | Source |
|------|------|----------|-------|--------|
| `sdk/src/program.ts` | 12 | `PROGRAM_ID` | `MERIDIAN_IDL.address` | IDL constant (vendored, single source) |
| `sdk/src/pyth.ts` | 28 | `PYTH_RECEIVER_PROGRAM_ID` | `rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ` | Hardcoded base58 string |

**⚠ Issue:** PYTH_RECEIVER_PROGRAM_ID is hardcoded (Solana's official Pyth Receiver, stable across devnet/mainnet, so not a drift risk). Comment confirms it's the same on both clusters.

### Display/Format Constants

| File | Line | Constant | Meaning | Notes |
|------|------|----------|---------|-------|
| `web/src/lib/tradeForm.ts` | comment | `$0.01 to $1.00` | Price range validation | Hardcoded in error message, implied from PRICE_SCALE |
| `web/src/components/trade/Countdown.tsx` | 1000 | Countdown tick interval | 1 second | Reasonable, display-only |
| `traders/src/format.test.ts` | test values | Expected conversions | 10_000_000 (10 tokens → 6dp) | Test fixture values, not constants |

## Recommendations

### High Priority (Drift Risk)

1. **De-duplicate PRICE_SCALE across web package** ⚠ HIGH
   - **Current state:** Defined locally in portfolio.ts, results.ts, marketStats.ts; each uses value 1_000_000 (= PAYOFF_UNIT)
   - **Canonical home:** Already in `@meridian/sdk` as `PRICE_SCALE`
   - **Action:** Replace all 4 web reimplementations with import from SDK:
     ```typescript
     // Old:
     const PRICE_SCALE = new BN(1_000_000);  // portfolio.ts:85
     
     // New:
     import { PRICE_SCALE } from "@meridian/sdk";
     ```
   - **Blast radius:** portfolio, results, marketStats modules (all in web); tests will verify immediately
   - **Risk:** Very low — value is identical, type is same (BN)

2. **Centralize web polling intervals** ⚠ HIGH
   - **Current state:** 15_000, 20_000, 8_000 scattered, 2 places using 15_000 independently
   - **Canonical home:** Create `web/src/lib/polling-config.ts` or add to `useChain.ts`
   - **Action:**
     ```typescript
     // web/src/lib/polling-config.ts (new)
     export const POLLING_INTERVALS = {
       PRICE_QUOTE: 15_000,    // useCurrentPrice
       USDC_BALANCE: 20_000,   // useUsdcBalance
       PORTFOLIO: 15_000,      // usePortfolio (matches PRICE_QUOTE)
       MARKETS: 8_000,         // useChain DEFAULT_POLL_MS
     } as const;
     ```
   - **Blast radius:** Affects useCurrentPrice, useUsdcBalance, usePortfolio, useChain — all in web/src/lib
   - **Risk:** Low — changes only constant names, not behavior

3. **Anchor error code offset constant** ⚠ MEDIUM
   - **Current state:** Magic number `6000` only in comments
   - **Action:** Add to automation:
     ```typescript
     // automation/src/settler.ts (or new errors.ts)
     const ANCHOR_ERROR_BASE = 6000;
     const WIDE_CONFIDENCE_CODE = ANCHOR_ERROR_BASE + 17;
     const MARKET_SETTLED_CODE = ANCHOR_ERROR_BASE + 3;
     ```
   - **Blast radius:** settler.ts, markets.ts (automation only)
   - **Risk:** Low — documents existing hardcoded offset, improves auditability

### Medium Priority (Cleanup & Maintainability)

4. **Name settlement retry defaults** ⚠ MEDIUM
   - **Current state:** `retryIntervalMs ?? 30_000` and `retryMaxMs ?? 15 * 60_000` inline
   - **Action:** Move to a named defaults object:
     ```typescript
     // automation/src/settlementJob.ts
     const SETTLEMENT_RETRY_DEFAULTS = {
       intervalMs: 30_000,    // 30 seconds
       maxMs: 15 * 60_000,    // 15 minutes
     } as const;
     ```
   - **Blast radius:** settlementJob.ts only
   - **Risk:** Low — clarifies intent, injectable for tests (already is)

5. **Centralize basis-point offsets if used elsewhere** ⚠ MEDIUM
   - **Current state:** STRIKE_OFFSET_BPS = [300, 600, 900] in strikes.ts (well-named, single use)
   - **Action:** Check if ops/admin CLIs also use 3/6/9% — if so, re-export from automation or sdk
   - **Finding:** Current usage is strike.ts + test; no duplication detected yet
   - **Status:** Keep as-is unless ops gains a parallel feature

### Low Priority (Polish)

6. **Extract test helper for dollars → base units conversion** — DOCUMENTATION
   - **Current:** `const U = (n) => new BN(n * 1_000_000)` in test files
   - **Suggested:** Add comment explaining it's $dollars × 1e6 (PAYOFF_UNIT / USDC_DECIMALS)
   - **Blast radius:** Tests only, no runtime impact

7. **Add JSDoc comments to polling interval constants** — DOCUMENTATION
   - **Suggested:** Document *why* each interval is chosen (e.g., "Endpoint caches ~5s; UI refreshes every 15s to stay fresh without overload")
   - **Blast radius:** Comments only

8. **Validate PYTH_RECEIVER_PROGRAM_ID against known clusters** — OPTIONAL
   - **Current state:** Hardcoded, comment says "same on devnet and mainnet"
   - **Action:** Add a test or CI step that validates the key is on-curve and hasn't been reassigned
   - **Blast radius:** Test infrastructure only

## Risky Calls (Money/Decimal Constants)

**CRITICAL: DO NOT CHANGE without validating against on-chain program.**

- ✗ **PAYOFF_UNIT** (1_000_000 = 1e6): Embedded in Rust `constants.rs`; SDK reads from IDL. Changing would break payout math, escrow math, and every test. **Never change.**
- ✗ **PRICE_SCALE** (1_000_000 = 1e6): Order price range. Changing would break order encoding/decoding. **Never change.**
- ✗ **TOKEN_DECIMALS** (6): Yes/No token mint scale. Changing breaks mint/redeem. **Never change.**
- ✗ **USDC_DECIMALS** (6): Collateral scale. Changing breaks all balance math. **Never change.**
- ✓ **STRIKE_OFFSET_BPS** ([300, 600, 900]): Business logic; can change if product agrees. No on-chain dependency.
- ✗ **PDA seed strings**: Hardcoded in Rust; changing breaks account derivation. **Never change.**
- ✓ **Polling intervals & retry windows**: Can change freely (no on-chain dependency, injectable).

## Conflicts/Dependencies with Other Concerns

1. **Type consolidation (concern #11):**
   - When consolidating BN/number types, ensure PRICE_SCALE remains BN or add a helper if converting to number
   - `results.ts` uses both `PRICE_SCALE` (BN) and `PRICE_SCALE_NUM` (number) — consolidate this during type audit

2. **Deduplication (concern #10):**
   - Removing duplicate PRICE_SCALE definitions must preserve the BN constructor calls (no silent number→BN promotion)
   - Tests in portfolio, results, marketStats should pass unchanged

3. **Format/display logic (concern #5):**
   - `formatUsdc` / `formatPrice` functions all divide by 1e6; ensure they import USDC_DECIMALS or PRICE_SCALE if centralized
   - Currently they hardcode `/ 1e6` or `/ 1_000_000` — good candidate for named constant

4. **SDK exports:**
   - Currently SDK exports PAYOFF_UNIT, PRICE_SCALE, TOKEN_DECIMALS, USDC_DECIMALS from constants.ts
   - Ensure web imports are all from SDK index.ts re-export, not directly from constants.ts

---

## Summary for Refactor Lead

**Top duplicated/critical constants (high confidence):**
1. PRICE_SCALE (1e6): Duplicated in 4 web modules — de-duplicate from SDK (LOW RISK)
2. Polling intervals (15_000, 20_000, 8_000): Scattered without names — add to `polling-config.ts` (LOW RISK)
3. Anchor error base (6000): Only in comments — add named constant (MEDIUM IMPORTANCE, LOW RISK)
4. Settlement retry defaults (30s, 15min): Inline defaults — name them for clarity (MEDIUM IMPORTANCE, LOW RISK)

**Count:** 8 duplicated constants, 11 polling/retry magic numbers, 9 PDA seeds (well-centralized), 1 oracle receiver ID (stable).

**No breaking changes required.** All recommendations are additive or move-only.

