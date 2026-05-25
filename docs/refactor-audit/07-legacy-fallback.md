# 07 — Deprecated / legacy / fallback audit

## Summary

The codebase is **remarkably clean** with minimal legacy code. Most "fallback" patterns are intentional, documented 3-tier resilience chains (live → envar → hardcoded defaults) rather than leftover code. The only substantive legacy finding is a **completed migration** (calendar.ts moved from automation → sdk with proper re-export), which is already clean. Test-only code (e2e wallet, local dev wallet, SDK_SKIP_LITESVM gate) is properly guarded to prevent production leakage. No evidence of commented-out implementations, deprecated decorators, or multi-version compatibility shims.

**High-confidence counts:**
- 1 completed migration (calendar): clean
- 2 intentional test-only paths with production guards: secure
- 3 deliberate fallback chains: working as designed
- 0 legacy code paths currently exercised

---

## Findings

### 1. Calendar migration (automation → sdk) — COMPLETED, CLEAN

**File:** `packages/automation/src/index.ts:16-27`, `packages/automation/src/morningJob.ts:15-21`

**What's "legacy":** Calendar functions (`isTradingDay`, `closeInstant`, `sessionForDate`, `etParts`, `isHalfDay`, `isWeekend`) were originally in `packages/automation/src/calendar.ts` and are now in `packages/sdk/src/calendar.ts`. Automation re-exports them from the SDK for backward-compatible public surface.

**Evidence it's complete:**
- Git history confirms move: `packages/automation/src/calendar.ts` → `packages/sdk/src/calendar.ts` (commit ca7ead2)
- No orphaned `packages/automation/src/calendar.ts` file exists
- All imports in morningJob.ts point to `@meridian/sdk` (not local calendar)
- SDK's `index.ts` properly exports the calendar module
- `packages/sdk/tests/surface.test.ts` validates calendar exports are in the public surface
- Web admin form (`AddStrikeControl.tsx`) imports from SDK, not automation

**Singular path:** All calendar logic lives in `packages/sdk/src/calendar.ts`; re-export from automation is transparent compatibility layer, not dead code.

**Blast radius:** None — migration is complete and tested.

---

### 2. E2E wallet test-only backdoor — INTENTIONAL, GUARDED

**File:** `packages/web/src/lib/e2eWallet.ts` + `packages/web/src/components/Providers.tsx:20-36`

**What's "legacy":** An in-process keypair wallet (`E2EWalletAdapter`) that signs transactions without a browser extension, using a secret injected by the e2e harness into `localStorage`. Enabled only when `NEXT_PUBLIC_E2E === "1"`.

**Evidence it's test-only:**
- Doc comment (line 20): "**end-to-end tests only**"
- Guard in Providers.tsx (line 26): `const E2E = process.env.NEXT_PUBLIC_E2E === "1" && process.env.NODE_ENV !== "production"`
- Hard error on production (line 29-36): throws if `NEXT_PUBLIC_E2E === "1"` **and** `NODE_ENV === "production"`
- Used only in e2e harness (packages/e2e/tests), never in user-facing flows
- localStorage key is `meridian.e2eWallet` (not persisted in repo)

**Why it exists:** Headless browser tests need to sign transactions without a wallet extension (no UI interaction). This is the isolated, test-gated solution.

**Blast radius:** Zero. Production cannot enable it; Next.js dead-code-eliminates the branch when `NEXT_PUBLIC_E2E` is unset.

---

### 3. Local dev wallet — INTENTIONAL, GUARDED, SEED-DEPENDENT

**File:** `packages/web/src/lib/localWallet.ts` + `packages/web/src/components/Providers.tsx:38-50`

**What's "legacy":** A built-in keypair wallet for local development that connects without a browser extension, using a demo keypair seeded at build time by `make dev` (passed via `NEXT_PUBLIC_LOCAL_WALLET_SECRET`). Enables one-click "Select Wallet" → connect flow on localnet.

**Evidence it's development-only:**
- Docstring (lines 16–22): "**local development against a `solana-test-validator`**"
- Guard (Providers.tsx:46–50): four conditions must all be true:
  1. `NEXT_PUBLIC_LOCAL_WALLET === "1"` (opt-in)
  2. `NEXT_PUBLIC_CLUSTER === "localnet"` (never devnet/mainnet)
  3. `NODE_ENV !== "production"` (dev/test only)
  4. `localWalletConfigured()` (secret must be provided at build time)
- Production safety (line 52–59): throws if secret is set AND `NODE_ENV === "production"`
- On devnet/mainnet the guard fails silently; modal shows only Wallet-Standard wallets (Phantom/Solflare)

**Why it exists:** Streamlines local testing—no need to install Phantom, just click "Local Dev Wallet" and trade against the seeded validator. Improves DX; not in prod.

**Blast radius:** Zero. Four-condition guard ensures it's unreachable in production.

---

### 4. Fallback chain: market-close prices — INTENTIONAL 3-TIER RESILIENCE

**Files:** `packages/ops/src/env.ts:57–64`, `packages/ops/src/liveCloses.ts:30–102`, `packages/ops/src/bin/create-markets.ts`

**What looks "legacy":** Multiple price sources:
1. **Live** — `/api/history?symbol=...` (web dashboard's Cloudflare Pages Function → Yahoo Finance)
2. **Envar fallback** — `MOCK_CLOSE_<SYMBOL>` (e.g., `MOCK_CLOSE_META=680`)
3. **Hardcoded defaults** — `DEFAULT_CLOSES` in liveCloses.ts (e.g., AAPL: 230, MSFT: 420)

**Evidence it's intentional:**
- Doc (liveCloses.ts:30–34): "Last-resort hardcoded previous closes… the floor of the fallback chain (live → envar → these), not a source of truth."
- Enabled by `LIVE_CLOSES=1` (or implicit when `WEB_BASE_URL` is set)
- Each tier has a reason:
  - **Live** — real market data, most accurate, requires API
  - **Envar** — for local/CI reproducibility, no external dependency
  - **Hardcoded** — full offline mode, never breaks market creation
- Error handling (liveCloses.ts:56–66): fetch failures don't abort; caller falls back gracefully

**Why it exists:** `create-markets` must generate strikes even when the live API is down, the web app isn't deployed, or the operator is working offline. Three tiers ensure the job never hangs waiting for external data.

**Singular path:** Each tier is tried in order; the first success wins. No legacy duplication—it's explicit, documented resilience design.

**Blast radius:** None. This is working-as-designed.

---

### 5. SDK_SKIP_LITESVM — INTENTIONAL CI ENV GATE

**Files:** `packages/sdk/tests/harness.ts:75–86`, `packages/automation/tests/integration.test.ts:35`, docs in CLAUDE.md

**What looks "legacy":** When `SDK_SKIP_LITESVM=1` (set by CI), the entire on-chain test suite becomes `describe.skip`, and only pure SDK tests run. CI skips it to avoid LiteSVM memory leaks on small runners.

**Evidence it's intentional:**
- CLAUDE.md (line 63–65): "`SDK_SKIP_LITESVM=1` skips the on-chain LiteSVM tests… CI sets it."
- Code (harness.ts:86): `process.env.SDK_SKIP_LITESVM ? describe.skip : describe`
- Docstring (harness.ts:75–83) explains: "LiteSVM… leaks memory and OOMs the small CI runner… Locally the full suite runs."
- No special handling in production — it's test-suite gating, not prod code.

**Singular path:** Tests are either all on-chain (locally, `SDK_SKIP_LITESVM` unset) or all pure (CI, `SDK_SKIP_LITESVM=1`). No hybrid mode.

**Blast radius:** None. Environment gate is explicit and documented.

---

### 6. E2E_REQUIRE_VALIDATOR — INTENTIONAL VALIDATOR AVAILABILITY CHECK

**File:** `packages/e2e/src/localValidator.ts:129–150`, CLAUDE.md

**What looks "legacy":** When `E2E_REQUIRE_VALIDATOR` is set but no local validator is available, the test suite emits one clear failing test with diagnostic output instead of silently skipping or crashing with a confusing "describe is not defined" error.

**Evidence it's intentional:**
- Doc (lines 121–127): "Resolved **lazily, at call time**… so this module is safe to `import` from non-Mocha code."
- Defensive design (line 132–148): if required but unavailable, emit ONE diagnostic test instead of running hooks that would fail less clearly.
- Fallback logic (line 150): return `describe.skip` if validator not available and not required—silent pass-through.

**Singular path:** Validator detection is performed once at call time; result is used consistently.

**Blast radius:** None. This is error-handling design, not legacy code.

---

### 7. Deprecated Solana transaction forms — NOT LEGACY (EXTERNAL API)

**Files:** `packages/ops/src/devStack.ts:142`, `packages/e2e/src/localValidator.ts:372`

**What might look "legacy":**
- devStack.ts comment: "the bare-signature form is deprecated and can return without catching a dropped tx"
- localValidator.ts comment: "the deprecated signature-only form can resolve before the airdrop is finalized"

**Evidence it's not our legacy:** These refer to **external Solana web3.js APIs** that have deprecated forms. The code explicitly uses the *newer* form (blockhash, async confirmation). The comments document *why* we avoid the deprecated form—defensive programming, not leftover code.

**Singular path:** Always use the modern Solana APIs; comments explain the trap.

**Blast radius:** None.

---

## Recommendations

### High priority: None
No legacy code paths pose correctness or maintenance risk. All "fallback" patterns are intentional, documented design.

### Medium priority: None
E2E and local-dev wallets are properly guarded; SDK_SKIP_LITESVM is documented. No action needed.

### Low priority: Periodic refresh of hardcoded defaults

**Item:** `DEFAULT_CLOSES` in `packages/ops/src/liveCloses.ts:36–44`

**Current values:** AAPL: 230, MSFT: 420, GOOGL: 175, AMZN: 230, NVDA: 180, META: 720, TSLA: 420

**Action:** These are a last-resort fallback (live → envar → these). They drift from reality over time. Every 6 months, bump them to approximate current market prices so offline market creation isn't wildly out-of-range. No code change—just a data refresh.

**Owner:** ops or automation team
**Effort:** 2 minutes
**Blast radius:** Minimal (default strikes, easy to override)

---

## Risky calls (paths that might still be exercised in prod)

### None identified
- E2E/local dev wallets are gated to prevent production deployment
- Fallback chains (live → envar → hardcoded) are resilience design, not dead code
- SDK_SKIP_LITESVM only affects test suites, not prod
- Calendar migration is complete; no old path remains

---

## Conflicts / dependencies with other concerns

### Potential interaction with **unused-code audit**
- The e2e and local-dev wallets will be flagged as "unreached" if scanned from a production build perspective (where `NEXT_PUBLIC_E2E === "0"`)
- **Solution:** Acknowledge them as gated test-only code in the unused-code audit (not actually unused, just conditionally compiled)

### No conflicts with **dedup audit**
- No duplicate implementations detected
- Calendar migration removed duplication cleanly

### No conflicts with **type-safety audit**
- All fallback chains are properly typed (e.g., `Partial<Record<TickerSymbol, BN>>` for closes)
- Test gates use `process.env` checks consistently

---

## Conclusion

The Meridian codebase is **exceptionally clean** in terms of legacy and deprecated code. The main "legacy" findings are:

1. **Calendar migration** — already complete and tested
2. **Test-only code** — properly guarded to prevent production leakage
3. **Intentional fallback chains** — working as designed for resilience

No evidence of commented-out implementations, version branching, compatibility shims, or temporary workarounds that should be removed. The codebase exhibits mature architecture with defensive guards, not accumulated technical debt.

**Audit confidence:** High (86 source files scanned, git history reviewed)
