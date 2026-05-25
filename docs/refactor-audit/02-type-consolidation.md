# 02 — Type consolidation audit

## Summary

The Meridian monorepo has **strong type hygiene** overall: the @meridian/sdk package correctly owns on-chain types (Ticker, OrderSide, Outcome, MarketAccount, etc.) and the public surface is guarded by surface.test.ts. However, there are **6 high-confidence consolidation opportunities** and **3 medium-confidence ones**. The primary issues are:

1. **Inline account-pair type `{ address: PublicKey; account: MarketAccount }` repeated 10+ times** across automation, e2e, and tests — should be a named type in SDK.
2. **RawMarketAll/RawMarketAccount — identical inline types for `getProgramAccounts` decoding**, duplicated in traders/context.ts, ops/settleDue.ts, and web/discovery.ts with slightly different field sets. The web version includes outcome/orderBook/pairsMinted; traders/ops versions omit them.
3. **Enums/constants are well-placed** — no duplicates found. TradeAction is in SDK intent; SettleStatus/PriceSourceKind/LogLevel are domain-specific and correctly isolated.
4. **Domain-specific loggers** (automation vs traders) are intentionally different shapes; no consolidation needed.
5. **Web's SettledMarketInfo vs ops's SettledMarket** share similar intent but serve different consumers (UI vs CLI); no merge needed.
6. **AsyncResource<T> generic** in web/useChain.ts is UI-only; not shared. No evidence of duplication.

**Actionable findings: 6 high confidence, 3 medium confidence. See below for specifics.**

---

## Findings (file:line evidence)

### HIGH CONFIDENCE

#### 1. Inline `{ address: PublicKey; account: MarketAccount }` type used 10+ times — should be SDK
- **automation/src/chain.ts:48** — ChainClient.listMarkets() return type
- **automation/src/chain.ts:111** — RpcChainClient.listMarkets() implementation
- **automation/src/chain.ts:115** — local variable type annotation
- **automation/src/markets.ts:40** — MarketDiscovery.listMarkets() return type
- **automation/src/markets.ts:136** — mock implementation of same
- **automation/src/settlementJob.ts:76** — inline type alias `type Market = { address: PublicKey; account: MarketAccount }`
- **automation/tests/integration.test.ts:87,89** — local variable annotations
- **automation/tests/settlementJob.test.ts:80** — test fixture type
- **e2e/tests/automation.test.ts:128** — Settler.settle parameter

**Recommendation: HIGH confidence** — Export `AccountWithAddress<T>` or `WithAddress<T>` from SDK. Use it in automation/chain.ts, automation/markets.ts, and all call sites. Blast radius: **low** — purely a type rename, no runtime change. Tests + CI must pass; two of the usages in the codebase already use the manual type alias (settlementJob.ts:76).

---

#### 2. RawMarketAll / RawMarketAccount — identical structure, duplicated across three packages
**RawMarketAll** (two copies):
- **traders/src/context.ts:44-52** — scans open markets; fields: publicKey, ticker, strike, tradingDay, state
- **ops/src/settleDue.ts:54-62** — settlement scanner; identical shape

**RawMarketAccount** (one copy):
- **web/src/lib/discovery.ts:36-49** — includes outcome + orderBook + pairsMinted + settlementPrice (extra fields web needs)

**Issue**: The traders + ops versions are *identical* and could share. The web version is a superset. Both scan patterns decode raw `getProgramAccounts` results and normalize them, but each package maintains its own type definition.

**Recommendation: HIGH confidence** — Create a shared `RawProgramAccount<T>` helper or move the base type (`{ publicKey, ticker, strike, tradingDay, state }`) to SDK as `RawMarketAccount`. Let web extend it. Or keep the three separate (accepted trade-off: small duplication avoids a cross-package import in a query path). If consolidating: define once in SDK or automation (the canonical scanner), re-export from ops, and web extends it. Blast radius: **medium** — touches discovery logic in three packages; integration tests must validate the account-decoding paths still work.

---

#### 3. Inline object type for market scan result: `{ publicKey: PublicKey; account: { ticker, strike, tradingDay, state } }`
- **automation/src/chain.ts:111** — anonymous in function return type
- **automation/src/settlementJob.ts:76** — wrapped as `type Market`
- **ops/src/settleDue.ts:54** — anonymous as `interface RawMarketAll`

**Recommendation: HIGH confidence** — Name this once. Either as SDK's `RawMarketAccount` (base version, before normalization) or as automation's `Market` (and export from automation's index). Blast radius: **low**.

---

#### 4. Market discovery pattern duplicated across traders, ops, and web (same algorithm, different contexts)
- **traders/src/context.ts:98-118** — `discoverOpenMarkets(program, opts)` with caching and normalization
- **web/src/lib/discovery.ts:67** — `normalizeDiscovered(raw)` normalization only
- **ops/src/settleDue.ts:94-105** — settlement discovery (scans, normalizes, filters)

Each re-implements the same `getRawMarket` → filter → normalize flow. No shared helper.

**Recommendation: MEDIUM confidence** — A shared `normalizeRawMarket(raw: RawMarketAccount): DiscoveredMarket` helper in SDK or automation would reduce duplication. However, each consumer applies different post-normalization filters (traders: open only; ops: both; web: both with outcome). The normalization *core* is duplicable; the filters are intentional. Blast radius: **medium** if extracting a helper; **low** if accepting the duplication as inevitable given the different consumers.

---

#### 5. Result/Summary types for job outcomes — each job defines its own
- **automation/src/settlementJob.ts:34** — `export interface SettleResult { status, error? }` (one settle attempt)
- **automation/src/settlementJob.ts:65** — `export interface SettlementJobSummary { attempted, settled, etc. }` (batch result)
- **automation/src/morningJob.ts:54** — `export interface MorningJobSummary { tickers, prices, strikes, etc. }` (batch result)

**Issue**: Two different *result* concepts (per-attempt vs batch) are defined separately in each job file. The shape pattern `{ status/count/summary, error? }` repeats.

**Recommendation: MEDIUM confidence** — The intent is clear: each job has its own result shape. No consolidation needed *unless* you want a `JobResult<T>` generic wrapper. Leaving as-is is acceptable. If consolidating: move to automation/results.ts with generics. Blast radius: **low** — these are output types, not passed between packages.

---

#### 6. Market read result interfaces — ConfigAccount, MarketAccount, OrderBookAccount, UserPosition all exported from SDK
- **sdk/src/reads.ts:38** — `ConfigAccount`
- **sdk/src/reads.ts:47** — `MarketAccount`
- **sdk/src/reads.ts:76** — `OrderBookAccount`
- **sdk/src/reads.ts:229** — `UserPosition`

All consumers (traders, web, automation) import these. ✓ **No duplication** — correctly centralized.

---

### MEDIUM CONFIDENCE

#### 7. Web's SettledMarketInfo vs ops's SettledMarket — similar intent, different shapes
- **web/src/lib/results.ts:23** — `SettledMarketInfo { ticker, tradingDay, outcome }`
- **ops/src/settleDue.ts:45** — `SettledMarket { address, symbol, strike, settlementPrice, outcome, alreadySettled }`

Both represent a settled market, but web's is minimal (for grouping results); ops's is full (for CLI output and re-settle tracking).

**Recommendation: MEDIUM confidence** — These serve different consumers and have intentional differences. No merge needed. If you wanted shared infra: ops's SettledMarket could export both minimal and full versions. Blast radius: **low** — isolated to each package.

---

#### 8. Duplicate enum: PriceSourceKind in automation/config.ts
- **automation/src/config.ts:27** — `export enum PriceSourceKind { Mock, Pyth }`

Only used internally in automation config parsing. No export from automation's index; no duplicate elsewhere.

**Recommendation: LOW confidence** — No duplication found. Leave as-is.

---

#### 9. LogLevel enum in automation (not shared with traders' logger)
- **automation/src/logger.ts:10** — `export enum LogLevel { Info, Warn, Error, Alert }`
- **traders/src/logger.ts** — No LogLevel; uses `kind: LogKind` instead

**Recommendation: MEDIUM confidence** — Intentionally different designs. Automation's logger is JSON-structured for log aggregators; traders' is human-readable for tailing. No consolidation.

---

## Recommendations

### Priority 1 (Implement immediately)

**Create SDK type alias: `WithAddress<T>` or `AccountWithAddress<T>`**
```typescript
// sdk/src/reads.ts or new sdk/src/types.ts export
export interface WithAddress<T> {
  address: PublicKey;
  account: T;
}

// Or more explicitly:
export interface AccountWithAddress<T> {
  address: PublicKey;
  account: T;
}
```
- Update automation/chain.ts, automation/markets.ts, e2e tests, automation tests to use it.
- **Blast radius: Low** — pure refactor.
- **Effort: ~30 mins** — 10 sites to update.

---

### Priority 2 (Decide: consolidate or accept duplication)

**RawMarketAll vs RawMarketAccount:** Choose one of:
1. **Consolidate** — Define once in SDK or automation, move traders/context and ops/settleDue to import it. Effort: ~20 mins; blast radius: medium (query paths).
2. **Accept duplication** — It's small and isolated. Effort: 0. Accept the trade-off.

**Recommendation: Accept duplication for now.** The three versions have subtly different fields (web includes outcome/orderBook). A shared type would require a union or new conditional type. Revisit if a fourth copy appears.

---

### Priority 3 (Document intent, not required)

**Add comments to RawMarket types explaining why they exist:**
- "Decoding shape for raw Anchor getProgramAccounts output before normalization."
- Reduces future confusion about why these inline/duplicate types exist.

---

## Risky calls

### What we did NOT consolidate and why:

1. **LogLevel enums (automation vs traders)** — Intentionally different. Automation is machine-parseable JSON; traders is human-readable. Consolidation would force one to accommodate the other's needs.

2. **Market discovery logic (traders, ops, web)** — Each has different filters and post-normalization logic. A shared helper would obscure intent. The duplication is acceptable.

3. **SettledMarketInfo vs SettledMarket** — Different consumers (UI vs CLI) have different needs. Keep separate.

4. **Domain-specific loggers** — Acceptable to have a Logger interface per domain (automation, traders, web). No need for a grand Logger trait.

---

## Conflicts/dependencies with other concerns

### Overlaps with refactor-audit concern #01 (dedup):
- The `WithAddress<T>` type recommendation here aligns with dedup's goal of reducing boilerplate. Implement both as one action.

### Overlaps with concern #03 (weak-types):
- RawMarketAll/RawMarketAccount are weakly typed (`Record<string, unknown>` for enums). A shared type doesn't fix this; consider adding stricter helpers (e.g., `normalizeTickerArg`) at the same time if consolidating market discovery.

### Overlaps with concern #04 (naming/boundaries):
- The naming of result types (SettleResult, SettlementJobSummary, MorningJobSummary) is clear but repetitive. Consider a naming convention doc (e.g., "result types end in Result/Summary, input types end in Options/Params") at refactor's end.

### Safe to proceed independently:
- All SDK types are already well-placed (Ticker, Outcome, OrderSide, etc.).
- The consolidations above do not break any public API; surface.test.ts will pass.

---

## Summary: Next actions

1. **Immediate** — Create `WithAddress<T>` in SDK and update ~10 call sites.
2. **Decide** — Keep or consolidate RawMarketAll/RawMarketAccount. Recommend: keep for now.
3. **Document** — Add JSDoc to RawMarket types explaining the pattern.
4. **Test** — Run `yarn lint` + `yarn workspace @meridian/sdk test` + `yarn workspace @meridian/automation test` after changes.

**Total effort: 30–60 mins for Priority 1 + optional cleanup. Blast radius: Low to medium, fully testable.**
