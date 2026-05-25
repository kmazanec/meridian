# 10 — Naming & module boundaries audit

## Summary

**Positive findings**: The Meridian monorepo maintains strong module boundaries with **zero deep-import leaks** into SDK internals. Public API surface is well-guarded by `surface.test.ts`, barrel files are clean and intentional, and domain terminology is **consistent across packages** (vault/escrow/market/strike naming is uniform).

**Minor observations** (not blocking, low operational risk):
- One acceptable cross-package relative import: `automation/tests/integration.test.ts` → `../../sdk/tests/harness` (test helper, correctly not in public API)
- SDK barrel exports are intentionally broad (`export * from`) for modules like types/pdas/instructions, but each module is conceptually coherent and the surface test gates it
- Web `/lib` folder (44 files) lacks a barrel export, but web is a Next.js app (no public package export), so this is not a boundary risk

**Naming consistency**: ✓ Excellent
- Core domain concepts use consistent terminology: `market`, `strike`, `vault`, `escrow`, `pair`, `position` are never aliased or drift
- PDA names match their program seeds verbatim (verified against `constants.rs` comment)
- Enum variants (`Ticker`, `OrderSide`, `RedeemSide`, `Outcome`, `MarketState`) are canonical and stable across all packages
- Function naming is consistent: `fetch*`, `derive*`, `make*`, `compute*` prefixes follow domain conventions

---

## Findings (file:line evidence)

### ✓ Boundary Hygiene (PASS)

No cross-package relative imports (except test harness). All consumers use the public API:
- `/packages/web/src/**`: All imports use `from "@meridian/sdk"` (checked 30+ files; zero deep imports)
- `/packages/traders/src/**`: All imports use `from "@meridian/sdk"` (checked 10+ files)
- `/packages/automation/src/**`: All imports use `from "@meridian/sdk"` (10+ files)
- `/packages/automation/tests/integration.test.ts:38`: `import { Harness, describeOnChain } from "../../sdk/tests/harness"` — acceptable (test infrastructure, not exposed in public API)

**Public API guards:**
- `/packages/sdk/tests/surface.test.ts`: 86-item required list covers all critical exports (types, instructions, PDAs, reads, intent, Pyth)
- Any rename/drop of a surface export will fail the test immediately
- New exports are permitted (the test is an existence check, not an exhaustiveness check)

### ✓ Naming Consistency (PASS)

All checked domain nouns are used consistently across the repo:

| Concept | SDK definition | Usage in consumers | Status |
|---------|----------------|--------------------|--------|
| **Market** | `interface MarketAccount` (reads.ts:47), `type MarketId` (instructions.ts:42) | Web, traders, automation all use `MarketAccount`, `MarketId` | ✓ Consistent |
| **Strike** | `strike: BN` (MarketAccount field) | Web, automation both use `strike` for price; no alias | ✓ Consistent |
| **Vault** | `vaultPda()` (pdas.ts:107), `vault: PublicKey` (MarketAccount.vault) | `vaultBump`, `vault` used uniformly in web/automation | ✓ Consistent |
| **Escrow** | `usdcEscrowPda()`, `yesEscrowPda()` (pdas.ts:115–118) | Web leaderboard/history comment correctly distinguishes escrow as collateral in resting orders | ✓ Consistent |
| **Pair** | `mintPair()` instruction (instructions.ts:302), `pairsMinted` field | Web/automation use `mintPair`, `pairsMinted` without variation | ✓ Consistent |
| **Position** | `interface UserPosition` (reads.ts:352) | Web uses `UserPosition` type; does NOT alias as "holding" or "balance" | ✓ Consistent |
| **Book** | `interface BookView`, `interface DualBook`, `interface BookLevel` (reads.ts) | Web imports all three; no variant naming | ✓ Consistent |
| **Order** | `interface OrderEntry`, `interface OrderBookAccount` (reads.ts) | Web/traders import both by canonical name | ✓ Consistent |
| **Outcome** | `enum Outcome { Unsettled, YesWins, NoWins }` (types.ts:141–146) | Web consistently uses `Outcome` enum across components | ✓ Consistent |
| **Ticker** | `enum Ticker` (types.ts:13–21), `TICKER_SYMBOLS` const | Web uses `Ticker` enum + `TICKER_SYMBOLS`; no alias | ✓ Consistent |

### ✓ PDA Naming Matches Program Seeds (PASS)

`/packages/sdk/src/pdas.ts:11–28` documents each seed byte string and validates them against the program:
```
Config        : [b"config"]           ✓ configPda()
Market        : [b"market", ...]      ✓ marketPda()
OrderBook     : [b"order_book", ...]  ✓ orderBookPda()
Vault (USDC)  : [b"vault", ...]       ✓ vaultPda()
Mint authority: [b"mint_auth", ...]   ✓ mintAuthorityPda() — note: "mint_auth" seed, not "mint_authority"
Yes mint      : [b"yes_mint", ...]    ✓ yesMintPda()
No mint       : [b"no_mint", ...]     ✓ noMintPda()
USDC escrow   : [b"usdc_escrow", ...] ✓ usdcEscrowPda()
Yes escrow    : [b"yes_escrow", ...]  ✓ yesEscrowPda()
```
Names are intentional and match the Rust program constant definitions (unit tests pin these).

### ✓ Barrel Files & Export Hygiene (PASS)

**SDK (`/packages/sdk/src/index.ts`):**
```typescript
export { MERIDIAN_IDL, type Meridian } from "./idl";
export { PROGRAM_ID, getProgram, getProgramFromConnection, type MeridianProgram } from "./program";
export { PAYOFF_UNIT, PRICE_SCALE, TOKEN_DECIMALS, USDC_DECIMALS, ORDERBOOK_N, NUM_TICKERS } from "./constants";
export * from "./types";          // ✓ All Ticker/OrderSide/RedeemSide/Outcome/MarketState
export * from "./pdas";            // ✓ All PDA derivers + MarketPdas interface
export * from "./instructions";    // ✓ All builders + MarketId interface
export * from "./reads";           // ✓ All fetchers + all decoded account shapes
export * from "./intent";          // ✓ TradeAction, TradeIntent, buildTradeIntent, BuiltIntent
export * from "./pyth";            // ✓ Hermes/Receiver helpers (lazy-loads optional deps)
```
Each `export *` is backed by comments explaining the module's responsibility. Intentional, not accidental.

**Automation (`/packages/automation/src/index.ts`):**
- 30 named exports, no `export *` — every export is explicit and listed (good discipline)
- Re-exports calendar functions from SDK (lines 18–27) so automation's public surface doesn't force SDK import

**Traders (`/packages/traders/src/index.ts`):**
- 32 exports, single `export * from "./format"` (safe: a utility module with no internal dependencies)

### ✓ No Name/File Mismatches (PASS)

Sampled checks (100% pass rate on spot checks):
- `/packages/sdk/src/pdas.ts`: Exports `marketPda`, `vaultPda`, etc. — names match function signatures
- `/packages/sdk/src/reads.ts`: Exports `fetchConfig`, `fetchMarket`, `fetchOrderBook` — all follow `fetch*` pattern
- `/packages/web/src/lib/leaderboard.ts`: Exports `interface LeaderboardPosition`, function `buildLeaderboard` — names match contents
- `/packages/automation/src/strikes.ts`: Exports `computeStrikes`, `STRIKE_OFFSET_BPS`, `dollarsToBaseUnits` — all match file purpose

### ✓ Type Imports vs Re-exports (PASS)

All consumer packages correctly distinguish type-only imports:
```typescript
// automation/src/chain.ts
import { type MarketId } from "@meridian/sdk";  // ✓ Type-only

// web/src/lib/useProgram.ts
import { getProgram, type MeridianProgram } from "@meridian/sdk";  // ✓ Mixed
```
No circular imports detected. No consumers re-export SDK types with different names.

---

## Recommendations

### **HIGH PRIORITY** (0 items)

No breaking issues found. Module boundaries are healthy.

### **MEDIUM PRIORITY** (1 item, low risk)

**1. Web `/lib` folder lacks a barrel export** — consider adding for future maintainability
- **Location**: `/packages/web/src/lib/index.ts` does not exist
- **Status**: Not a current problem (web is not a published package; it's a Next.js app)
- **Rationale**: Next.js imports are file-relative; a barrel would not improve bundling. OK to leave as-is.
- **Action if adopted**: Create `index.ts` with `export * from "./leaderboard"`, etc., to make lib/ a coherent module. This would help if web ever becomes a reusable component library.
- **Blast radius**: None (web is internal to the monorepo)

### **LOW PRIORITY** (2 items, informational)

**1. SDK barrel is broad—consider naming specificity for future stability**
- **Location**: `/packages/sdk/src/index.ts` uses `export * from "./types"`, `export * from "./pdas"`, etc.
- **Status**: Acceptable; each module has a clear responsibility and is covered by `surface.test.ts`
- **Rationale**: The test is the contract; the barrel is a convenience. If the SDK's public surface needs to shrink (e.g., hide internal helpers), the test will catch it.
- **Note**: The comment on line 21–22 explains the calendar export philosophy — similar comments could document why other modules are re-exported in full.

**2. Intent module exports `TradeIntent` + builder; consider if both belong in public API**
- **Location**: `/packages/sdk/src/intent.ts` (checked: all builders and enums are used by web + automation)
- **Status**: Both are necessary; the module is appropriately scoped.
- **Rationale**: `TradeIntent` is the domain model; `buildTradeIntent` is the engine. Both needed by consumers.

---

## Risky Calls (name/type changes that ripple)

### Renames to Avoid (would break all consumers)
These are guarded by `surface.test.ts:10–86`. Renaming any will fail the test and ripple across:
- `Ticker`, `OrderSide`, `RedeemSide`, `Outcome`, `MarketState` enums
- `MarketId`, `MarketAccount`, `UserPosition`, `BookView`, `DualBook` types
- `marketPda`, `vaultPda`, `usdcEscrowPda`, `yesEscrowPda` functions
- `fetchMarket`, `fetchOrderBook`, `fetchUserPosition`, `buildTradeIntent` functions
- `PAYOFF_UNIT`, `PRICE_SCALE` constants

**Update strategy if unavoidable**:
1. Rename in SDK source
2. Update `surface.test.ts:10–86` required list
3. Rebuild SDK (`yarn workspace @meridian/sdk build`)
4. Update all imports in web/automation/traders (use IDE refactor)
5. Run `yarn workspace @meridian/* typecheck test` to verify

### Safe to Rename
- `refactorPdas()` helper (internal to instructions.ts) — used nowhere else
- `normalizeOutcome()`, `normalizeOrder()` (internal reads.ts helpers) — not exported
- Web `/lib` internals (leaderboard.ts functions) — only used within web

---

## Conflicts / Dependencies with Other Concerns

### Interaction with Type Consolidation (concern #08)
- **Current state**: `UserPosition` (SDK) vs `RedeemedPosition` (web) vs `LeaderboardPosition` (web) are distinct and intentional
- **No conflict**: Each has a specific shape. If consolidation is desired, must be a deliberate schema union, not a rename
- **Recommendation**: If exploring type unification, start with web's three Position types (all in `/lib`), then consider SDK import

### Interaction with Circular Dependencies (concern #06)
- **Current state**: No import cycles detected
- **Boundary check**: SDK imports nothing from consumers; one-way dependency (SDK → all)
- **No conflict**: Import boundaries are clean

### Interaction with Deduplication (concern #09)
- **Current state**: No concept duplication found; domain nouns are unique and stable
- **No conflict**: Naming is not the blocker; architecture is sound

---

## Checklist for Maintainers

When adding a new export to SDK:
- [ ] Add to `/packages/sdk/src/index.ts` with a comment explaining its role
- [ ] Add to `surface.test.ts:10–86` required list if it's a downstream-facing type or function
- [ ] Run `yarn workspace @meridian/sdk test` to verify surface test passes
- [ ] Ensure no imports from SDK internals (e.g., no `import { foo } from "@meridian/sdk/src/..."`)

When renaming a domain concept:
- [ ] Check `surface.test.ts` — if the name is in the list, it is a breaking change
- [ ] Update SDK source, test, and all imports in web/automation/traders
- [ ] Run full test suite to validate

When refactoring web `/lib`:
- [ ] No public API impact (web is not published)
- [ ] Prefer consistent naming with SDK domain types (e.g., use `MarketAccount` not `Market`)

---

## Conclusion

**Module boundaries**: ✓ Excellent (zero leaks, clean public API)
**Naming consistency**: ✓ Excellent (domain concepts are stable and uniform across packages)
**Barrel hygiene**: ✓ Good (intentional, tested, well-documented)

No renames required. No refactoring needed for boundary health. The repo is well-structured for scale.

