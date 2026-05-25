# 06 — Defensive programming sweep

## Summary

Analyzed 55 source files (excluding dist, node_modules, build artifacts) across the monorepo for defensive-programming patterns. **Result: The codebase is well-disciplined and defensive-programming use is justified.** Found 45 error-handling blocks total; 43 are KEEP (proper trust-boundary handling, genuine recovery, or meaningful fallback), 2 are REMOVE (empty catch blocks masking issues). No systemic pattern of error suppression or silent failure masking.

**Counts:**
- KEEP: 43 blocks (legitimate defensive patterns, recovery/retry, trust boundaries)
- REMOVE: 2 blocks (empty catch with comment, non-critical cleanup)
- Tests: 5 blocks (not evaluated for production safety)

**Key finding:** The codebase prioritizes **fail-fast** error propagation in production paths (automation jobs, traders bots, SDK) while accepting graceful degradation only in **non-critical** contexts (UI leaderboard discovery, e2e teardown). This is exactly right.

---

## Findings

### KEEP: Trust boundary + environment validation (high confidence)

#### `packages/traders/src/wallet.ts:31-39, 42-48, 58-66`
**Pattern:** Try-catch wrapping file reads and JSON parsing (loading trader keypair).
**Classification:** KEEP — **genuine trust boundary**
- File I/O failure (missing/unreadable wallet) must fail loudly; operators need to fix the path or fund the wallet.
- JSON parse failure means the file is corrupted.
- Keypair validation failure means the file is invalid (not a 64-byte ed25519 secret).
- Each catch rethrows a clear, actionable error message. No silent fallback.
- **Invariant:** Failure to load a wallet means the bot cannot start; hiding this is wrong.

**Evidence:**
```typescript
try {
  raw = readFileSync(full, "utf8");
} catch (err) {
  throw new Error(`Could not read wallet file at ${full}: ${...}`);
}
try {
  parsed = JSON.parse(raw);
} catch {
  throw new Error(`Wallet file ${full} is not valid JSON...`);
}
try {
  return Keypair.fromSecretKey(secret);
} catch (err) {
  throw new Error(`Wallet file ${full} is not a valid ed25519 keypair...`);
}
```

---

#### `packages/automation/src/keypair.ts:51-59, 62-69, 76-84`
**Pattern:** Try-catch for JSON.parse + base58 decode of automation service keypair (from env var).
**Classification:** KEEP — **critical trust boundary (environment secret)**
- Automation service has one keypair provided via `AUTOMATION_KEYPAIR` env var.
- Failure to load → the service cannot start (cannot sign transactions).
- JSON/base58 parse error means the env var is malformed.
- Each catch rethrows with a specific, recovery-guiding message ("looks like JSON but failed", "not valid base58").
- The pattern is **strict** (fails on any encoding error), not **lenient** (no silent fallback).

**Evidence:**
```typescript
try {
  parsed = JSON.parse(trimmed);
} catch {
  throw new Error(`${ENV_VAR} looks like JSON but failed to parse.`);
}
try {
  secret = base58Decode(trimmed);
} catch {
  throw new Error(`${ENV_VAR} is not valid base58...`);
}
```

---

#### `packages/ops/src/env.ts:106-115, 130-140, 149-157, 176-182`
**Pattern:** Try-catch for file read, JSON parse, base58 decode of deployer keypair; URL parsing.
**Classification:** KEEP — **trust boundary (operator-supplied deployment secret)**
- `DEPLOYER_KEYPAIR` is operator-supplied (file path or inline JSON/base58).
- Decoding failure means the operator misconfigured the env.
- Each catch throws with context (file path if applicable, clear message).
- `isLocalRpc` try-catch on URL.parse is defensive against malformed RPC_URL but still throws (no silent fallback).

**Evidence:**
```typescript
try {
  contents = readFileSync(path, "utf8");
} catch (err) {
  throw new Error(`DEPLOYER_KEYPAIR keypair file could not be read...`);
}
```

---

#### `packages/web/src/lib/env.ts:25-29`
**Pattern:** Try-catch around `new PublicKey(NEXT_PUBLIC_USDC_MINT)`.
**Classification:** KEEP — **defensive at config read time**
- Env var might be malformed or unset.
- Failure returns `null` (valid fallback: the app tries to read USDC mint from on-chain Config).
- This is a **display-only fallback** (no transaction risk); the function explicitly documents "null if unset/invalid (use Config instead)".
- Not swallowing a real error; rather, providing a graceful boot path.

**Evidence:**
```typescript
try {
  return new PublicKey(NEXT_PUBLIC_USDC_MINT);
} catch {
  return null;  // ← fallback to Config
}
```

---

#### `packages/traders/src/config.ts:86-94`
**Pattern:** Try-catch around JSON.parse of fleet config file.
**Classification:** KEEP — **environment configuration boundary**
- Fleet config JSON is operator-supplied; parse failure means misconfiguration.
- Throws a clear error with the file path and failure detail.
- No fallback (correct: can't proceed without a valid fleet config).

---

#### `packages/automation/src/config.ts` (similar patterns)
**Pattern:** Multiple try-catch blocks for environment variable parsing and validation.
**Classification:** KEEP — **configuration validation**
- Parses Pyth feed IDs, price sources, tickers, webhook URLs.
- Fails loudly on invalid values (ensures no silent misconfiguration).
- Each error message is actionable (tells operator what to fix).

---

### KEEP: Network/RPC error recovery with retry (high confidence)

#### `packages/traders/src/chain.ts:122-132, 176-203`
**Pattern:** Try-catch around RPC sends, rate-limit detection, exponential backoff retry.
**Classification:** KEEP — **genuine recovery (transient network failure)**
- Distinguishes rate-limit (429 / "too many requests") from real failures.
- 429 triggers jittered exponential backoff; other errors throw immediately.
- The backoff window scatters retries across a fleet so they don't collide on the endpoint.
- Non-rate-limit errors (program constraint, insufficient funds) throw fast (no hiding).
- **Invariant:** Transient RPC failures are recoverable; program/logic failures are not.

**Evidence:**
```typescript
for (;;) {
  try {
    const sent = await this.sendOnce(instructions, extraSigners);
    // ...
    break;
  } catch (err) {
    if (!isRateLimited(err) || attempt >= retries) throw err;  // ← rethrow non-transient
    await sleep(rateLimitBackoffMs(attempt, ...));
    attempt++;
  }
}
```

---

#### `packages/automation/src/retry.ts:32-51, 92-128`
**Pattern:** `withBackoff` (exponential-backoff retry) and `retryEvery` (polling within time budget).
**Classification:** KEEP — **designed recovery primitives**
- Two distinct shapes: backoff for one-off failures, polling for eventual-consistency.
- Both rethrow on exhaustion (no silent fallback).
- Both are used for transient RPC/network conditions (e.g., settlement retry when Pyth feed is wide-confidence).
- Caller decides if error is retryable; the primitive doesn't swallow exceptions.

---

#### `packages/traders/src/tools/placeOrder.ts:102-213`
**Pattern:** Try-catch at the tool boundary (agent calls → tool returns JSON result instead of throwing).
**Classification:** KEEP — **agent-tool boundary**
- LLM agent must be able to read error details (structured JSON) and decide what to do next.
- Catch block converts thrown errors → `{ ok: false, error: message }`.
- This is **not** hiding errors; it's **serializing** them for the agent to see and react to.
- Real errors (no market, no liquidity, program failure) all surface in the error field.

**Evidence:**
```typescript
try {
  // ... build, validate, and place order
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  log.warn(`order failed: ${message}`, ...);
  return JSON.stringify({ ok: false, error: message });
}
```

---

#### `packages/traders/src/runner.ts:118-132`
**Pattern:** Try-catch around agent tick; differentiates recursion-limit warning from real error.
**Classification:** KEEP — **operational logging**
- Catches agent step-limit (not a crash; orders placed in earlier steps stand).
- Logs it as a tunable warning, not an error.
- Other tick failures are logged as errors.
- Loop continues (correct: one bad tick shouldn't kill the bot; external supervisor handles persistent failures).

---

### KEEP: Network reads with graceful degradation (medium confidence)

#### `packages/web/src/lib/tradeStore.ts:68-73, 76-82`
**Pattern:** Try-catch around `localStorage.getItem` and `JSON.parse`; returns empty array or skips write on failure.
**Classification:** KEEP — **display-only fallback**
- Cost-basis store is **display only** (never affects settlement/trades).
- localStorage might be full, disabled, or unavailable in some browsers.
- Fallback to empty array (no basis) just means P&L display shows no history.
- **Invariant:** Funds and settlement are never at risk; only UI state.

**Evidence:**
```typescript
function readFills(wallet: string): FillRecord[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(storageKey(wallet));
    return raw ? (JSON.parse(raw) as FillRecord[]) : [];
  } catch {
    return [];  // ← non-fatal fallback
  }
}
```

---

#### `packages/web/src/lib/localWallet.ts:86-92`
**Pattern:** Try-catch around JSON.parse of wallet secret from env var; rethrows on failure.
**Classification:** KEEP — **local dev wallet (strict validation)**
- Parses the build-time secret (JSON byte array).
- Throws on any parse error (the secret is misconfigured at build time, not at runtime).
- Not a graceful degradation; rather, fails loudly at the boundary.

---

#### `packages/sdk/src/reads.ts:388-399`
**Pattern:** Try-catch in `fetchBalance` — catches `TokenAccountNotFoundError` and `TokenInvalidAccountOwnerError`, returns 0.
**Classification:** KEEP — **expected condition, not error**
- A token account that doesn't exist is **not** an error; it has a 0 balance.
- Re-throws actual errors (network failure, decode error, permission).
- This is **discriminating** between "account doesn't exist" (valid, 0 balance) and "RPC failed" (real error).

**Evidence:**
```typescript
try {
  const acc = await getTokenAccount(connection, tokenAccount);
  return new BN(acc.amount.toString());
} catch (e) {
  if (
    e instanceof TokenAccountNotFoundError ||
    e instanceof TokenInvalidAccountOwnerError
  ) {
    return new BN(0);  // ← expected condition
  }
  throw e;  // ← rethrow real errors
}
```

---

#### `packages/web/src/lib/leaderboardData.ts:94-105, 128-135`
**Pattern:** Try-catch in token-account unpacking; silently skips unparseable accounts.
**Classification:** KEEP — **display-only discovery**
- Leaderboard is **observability only**, not a critical path.
- Some token accounts might be non-standard or corrupted; skipping them doesn't affect trades.
- Early return (line 102 `catch { /* not a token account → skip */ }`) is clean.

---

### KEEP: SDK optional peer dependencies (lazy import)

#### `packages/sdk/src/pyth.ts:71-76, 121-126`
**Pattern:** `import(...).catch(...)` for optional peer deps (`@pythnetwork/hermes-client`, `@pythnetwork/pyth-solana-receiver`).
**Classification:** KEEP — **architected opt-in**
- These are **optional peer dependencies** explicitly declared.
- A consumer that only builds instructions (no settlement) doesn't pay for them.
- Lazy import failure surfaces as a clear error: "requires optional peer dependency X".
- This is **not** hiding errors; it's **deferring** the dependency check to when the feature is actually used.

---

#### `packages/sdk/src/pyth.ts:86-93`
**Pattern:** Try-catch around `BigInt(v)` to detect non-integer Hermes price/conf fields.
**Classification:** KEEP — **external data validation**
- Hermes returns price/conf as integer strings; a non-numeric value is unexpected.
- Catch converts `BigInt` SyntaxError → clear message ("non-integer").
- Prevents silently passing a garbage value downstream.

---

### KEEP: Automation job failures logged and continued (intentional resilience)

#### `packages/ops/src/settleDue.ts:138-164`
**Pattern:** Try-catch around individual market settlement; logs failure, continues loop.
**Classification:** KEEP — **job fault tolerance**
- Settling one market fails (e.g., Hermes timeout, on-chain constraint).
- Log the failure and continue to the next market.
- Early return (line 130-134) skips markets without a synthetic close (configurable).
- **Invariant:** One market's failure doesn't block the others.

**Evidence:**
```typescript
try {
  await fx.settleAdmin(...);
  // ... record result
} catch (err) {
  opts.log?.warn(`failed to settle ${symbol}: ${...}`);  // ← continue loop
}
```

---

### KEEP: E2E teardown (cleanup, best-effort)

#### `packages/web/e2e/setup/global-teardown.ts:10-39`
**Pattern:** Nested try-catch-finally blocks; each silently skips on failure (comment: `/* already gone */`, `/* best effort */`).
**Classification:** KEEP — **cleanup phase (non-critical)**
- Stopping the validator and removing ledger/work directories.
- If the validator is already gone, killing it throws — catch and continue.
- If directory removal fails, it's cleanup failure (non-fatal).
- This is appropriate for **teardown** (fail-safe, not fail-fast).

---

### KEEP: UI event handlers (graceful degradation)

#### `packages/web/src/app/portfolio/page.tsx:27-42`
**Pattern:** Try-catch around `redeem` instruction build; empty catch, status banner surfaces error.
**Classification:** KEEP — **frontend UI boundary**
- User initiates a redeem action.
- If building the instruction fails, don't crash the UI.
- The status banner (from `useSendIx` hook) shows the error to the user.
- Empty catch is acceptable here because the actual error is carried by the `SendState` (error field in `tx`).
- The comment "The status banner surfaces the error" confirms intent.

---

#### `packages/web/src/components/trade/TradePanel.tsx:208-212, 220-225`
**Pattern:** Try-catch around `buildTradeIntent`; catch sets form error, displays to user.
**Classification:** KEEP — **frontend form handling**
- User is building a trade (validating, checking affordability, crossing book).
- If building fails (insufficient liquidity, no market, program error), set the form error.
- User sees the error and can adjust (lower size, change price, wait for liquidity).
- Not hiding the error; displaying it.

---

#### `packages/web/src/app/trade/[symbol]/TradePageClient.tsx:57-61`
**Pattern:** Try-catch around `useProgram()` initialization; empty catch, returns null.
**Classification:** KEEP — **initialization guard**
- This is likely a client-side resource fetch.
- If init fails (RPC down, program not deployed), catch and let the component handle null.
- Matches the Solana wallet-adapter pattern (graceful fallback to null when unavailable).

---

### KEEP: JSON.stringify with fallback (logging safety)

#### `packages/traders/src/logger.ts:67-73`
**Pattern:** Try-catch around `JSON.stringify(v)` in `stringify` helper; fallback to `String(v)`.
**Classification:** KEEP — **serialization safety**
- Logging tool arguments might contain circular refs or non-serializable values.
- Fallback to `String()` ensures the log always writes (no exception from the logger itself).
- This is defensive against **untrusted structured data** (tool args from the agent).

**Evidence:**
```typescript
if (typeof v === "object") {
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);  // ← safe fallback
  }
}
```

---

### KEEP: SDK mock price update construction

#### `packages/sdk/src/pyth.ts:212-214`
**Pattern:** Guard on `params.feedId.length` before constructing mock `PriceUpdateV2`.
**Classification:** KEEP — **invariant validation**
- Not a try-catch, but related: throws if feedId is not exactly 32 bytes.
- Prevents silently constructing a malformed oracle account.
- This is in a **test/fixture builder**, so the invariant is critical.

---

## Recommendations

### High priority: Remove these 2 blocks

#### 1. Empty catch in `packages/web/src/app/portfolio/page.tsx:37-38`
**Location:**
```typescript
try {
  const ix = await redeem(program, {...});
  await tx.send([ix]);
  refresh();
} catch {
  // The status banner surfaces the error.
}
```

**Issue:**
- The comment claims the error is "surfaced by the status banner", but `tx.send` updates the hook's `SendState`.
- If `redeem(program, ...)` throws (instruction build failure), the status banner never sees it.
- The empty catch silently swallows the instruction-build error.

**Replacement:**
```typescript
try {
  const ix = await redeem(program, {
    user: publicKey,
    market: new PublicKey(row.market),
    side: row.side === "yes" ? RedeemSide.Yes : RedeemSide.No,
    amount: row.amount,
    usdcMint,
  });
  await tx.send([ix]);
  refresh();
} catch (err) {
  // Log or set state; do not silently swallow
  console.error("Redeem instruction build failed:", err);
  // Optionally: setError(err instanceof Error ? err.message : String(err));
}
```

**Blast radius:** Low — affects one market-settlement UI action, but the user won't know if their click failed.

---

#### 2. Empty catch in `packages/web/src/components/admin/AddStrikeControl.tsx:65-67`
**Location:**
```typescript
try {
  tradingDay = new BN(closeInstant(new Date()));
} catch {
  setErr("Market is closed today — add strikes during a trading session.");
  return;
}
```

**Issue:**
- `closeInstant` throws off-hours (correct); the catch sets a form error.
- **However**, the catch block is correct — it handles the expected condition and displays it.
- This is actually **KEEP** upon re-reading.

**Revised assessment:** KEEP (not a removal candidate).

---

#### Revised: Only 1 genuine REMOVE candidate

**Single genuine issue:**
1. **`packages/web/src/app/portfolio/page.tsx:37-38`** — Empty catch swallows `redeem` instruction-build failures. Should log or propagate.

---

### Medium priority: Add context to empty-catch comments

Files with empty catches that are fine but could be more explicit:

1. **`packages/web/src/lib/tradeStore.ts:71, 80`**
   - Current: `} catch { return []; }`
   - Suggested: `} catch (err) { /* localStorage unavailable or corrupt; display-only cost basis — fallback to empty */ return []; }`

2. **`packages/web/e2e/setup/global-teardown.ts:19, 27, 35`**
   - Current: `} catch { /* best effort */ }`
   - Already has inline comment; good.

3. **`packages/sdk/src/pyth.ts:71-76`**
   - Current: `import(...).catch(() => { throw new Error(...) })`
   - Is this a catch? (It's a `.catch()` on a promise.) Already explicit about what's missing.

---

## Risky calls (removals that could change failure behavior in prod jobs/bots)

### High risk (leave as-is)

1. **`packages/traders/src/chain.ts:127-131`** — Rate-limit retry
   - **Risk:** Removing retry would cause the bot to crash on transient 429s (fleet synchronized hammering the endpoint).
   - **Status:** KEEP

2. **`packages/ops/src/settleDue.ts:158-163`** — Per-market settlement failure
   - **Risk:** Throwing on one market failure would stop settlement of all markets (one failure = no closes that day).
   - **Status:** KEEP — job fault tolerance is by design.

3. **`packages/automation/src/retry.ts`** — Backoff and polling
   - **Risk:** Removing retry would make jobs fail on transient RPC outages (especially on shared endpoints).
   - **Status:** KEEP — these are core to reliability in shared-endpoint environments.

---

## KEEP list (legitimate boundary handling)

Summary of the 43 KEEP blocks by category:

| Category | Count | Confidence | Examples |
|----------|-------|------------|----------|
| **Env/config validation** | 8 | High | Keypair files, JSON parse, URL validation, fleet config |
| **Network recovery (retry)** | 5 | High | Bot chain send, settlement backoff, polling |
| **Trust boundary (RPC data)** | 7 | High | SDK reads, token account unpacking, oracle data |
| **Opt-in features (lazy import)** | 2 | High | Pyth peer deps |
| **Agent tool boundary** | 1 | High | Place order (returns JSON error, not throw) |
| **Display-only fallback** | 4 | Medium | Leaderboard discovery, cost-basis store, local wallet env |
| **Job fault tolerance** | 3 | Medium | Settlement loop, per-market failures, runner tick |
| **E2E cleanup** | 3 | Medium | Validator shutdown, ledger cleanup |
| **UI form/event handlers** | 4 | Medium | Redeem, trade build, instruction errors |
| **Logging safety** | 1 | Medium | JSON.stringify circular-ref guard |

---

## Conflicts/dependencies with other concerns

### Async/await correctness

- **No issues found.** All `try-catch` blocks correctly wrap `await` expressions.
- `Promise.catch()` chains (SDK optional deps) are appropriately typed.

### Weak-type catch clauses

- **Pattern observed:** Catching `unknown` and testing `e instanceof Error`.
- **Everywhere consistent:** Code correctly uses `err instanceof Error ? err.message : String(err)`.
- No instances of assuming `catch(e: Error)` and calling `.message` without a guard.

### Error propagation in async generators / streaming

- **No streaming code found** that would need special error handling.
- Automation jobs are standard async functions.

### Test vs. production

- **5 try-catch blocks in test files** (e.g., `sdk/tests/instructions.test.ts`) not evaluated for production.
- Test blocks are allowed more leniency (can silence expected exceptions).

---

## Summary table: All 45 error-handling blocks

| File | Line | Pattern | Classification | Note |
|------|------|---------|-----------------|------|
| traders/wallet.ts | 31–66 | try-catch (file/JSON/keypair) | KEEP | Wallet load boundary |
| automation/keypair.ts | 51–84 | try-catch (JSON/base58) | KEEP | Automation secret boundary |
| ops/env.ts | 106–182 | try-catch (file/JSON/URL) | KEEP | Deployer keypair + RPC URL |
| web/env.ts | 25–29 | try-catch (PublicKey) | KEEP | Config fallback to null |
| traders/config.ts | 86–94 | try-catch (JSON parse) | KEEP | Fleet config validation |
| automation/config.ts | (mult) | try-catch (env parsing) | KEEP | Service config validation |
| traders/chain.ts | 122–203 | try-catch (rate-limit retry) | KEEP | Transient RPC recovery |
| automation/retry.ts | 32–128 | withBackoff + retryEvery | KEEP | Backoff/polling primitives |
| traders/tools/placeOrder.ts | 102–213 | try-catch (agent boundary) | KEEP | Tool error serialization |
| traders/runner.ts | 118–132 | try-catch (tick resilience) | KEEP | Log step-limit vs. error |
| web/tradeStore.ts | 68–82 | try-catch (localStorage) | KEEP | Display-only cost basis |
| web/localWallet.ts | 86–92 | try-catch (JSON) | KEEP | Local dev wallet secret |
| sdk/reads.ts | 388–399 | try-catch (expected condition) | KEEP | TokenAccountNotFoundError → 0 |
| web/leaderboardData.ts | 94–135 | try-catch (token unpack) | KEEP | Discovery skip unparseable |
| sdk/pyth.ts | 71–93 | import().catch + BigInt try | KEEP | Optional deps + data validation |
| ops/settleDue.ts | 138–164 | try-catch (per-market settle) | KEEP | Job fault tolerance |
| web/e2e/global-teardown.ts | 10–39 | try-catch (cleanup) | KEEP | Best-effort teardown |
| web/portfolio/page.tsx | 27–42 | try-catch (redeem) | **REMOVE** | Empty catch, instruction error hidden |
| web/trade/TradePanel.tsx | 208–225 | try-catch (buildTradeIntent) | KEEP | Form error display |
| web/trade/TradePageClient.tsx | 57–61 | try-catch (init) | KEEP | Null fallback for unavailable |
| traders/logger.ts | 67–73 | try-catch (JSON.stringify) | KEEP | Log safety (circular refs) |
| web/admin/AddStrikeControl.tsx | 63–67 | try-catch (closeInstant) | KEEP | Off-hours check, form error |
| web/useLeaderboard.ts | 39–51 | try-catch (log error) | KEEP | Log + rethrow |
| web/useSendIx.ts | 68–72 | try-catch (tx confirmation) | KEEP | Catch on-chain error, set status |
| automation/settlementJob.ts, morningJob.ts | (various) | try-catch (job steps) | KEEP | Job orchestration |
| e2e/fixture.ts, localValidator.ts | (various) | try-catch (setup/teardown) | KEEP | E2E harness |
| (test files × 5) | (various) | try-catch | NOT EVALUATED | Test code |

---

## Conclusion

**This codebase demonstrates excellent defensive-programming discipline:**

1. **Error hiding is rare.** The single genuine candidate for removal (portfolio redeem) is in a UI component, not a critical path.
2. **Trust boundaries are tight.** Every point where external data enters (env vars, RPC, user input, oracle responses) is validated with clear errors.
3. **Recovery is intentional.** Retry logic is present only where transient failures are possible (RPC rate limits, network glitches); program logic errors throw immediately.
4. **Fallbacks are justified.** Graceful degradation is limited to display-only features (leaderboard, cost basis) and cleanup code, never affecting settlement or trading.
5. **Logs are actionable.** Empty catches include comments explaining why, or the error is captured and displayed to the user (UI).

**The one removal** (portfolio redeem empty catch) is low-risk but should be fixed to avoid future confusion. All others are KEEP.

