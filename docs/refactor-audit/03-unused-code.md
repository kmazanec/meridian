# 03 — Unused / dead code audit

## Summary

Scope: TS/TSX across `packages/*`, plus `scripts/`, `migrations/`, and
`packages/web/functions/` (Cloudflare Pages). Rust ignored per brief.

Headline counts (after repo-wide verification):

- **Confirmed dead, safe to remove (high):**
  - **4 truly-dead local exports** (web): `addressFor`, `representativeMid`,
    `hasWallet`, `useOrderBook` — defined + `export`ed, never referenced anywhere.
  - **4 redundant re-export statements** (no new code, just `export { X }` of an
    already-surfaced symbol): `tools/index.ts` re-export block (6 names),
    `alerter.ts` `LogLevel`, `config.ts` `dollarsToBaseUnits`, `results.ts`
    `PRICE_SCALE_NUM`.
  - **4 genuinely unused deps** in `@meridian/traders`: `axios`,
    `@solana/spl-token`, `@pythnetwork/hermes-client`, `@anchor-lang/core`.
- **Over-exported (medium):** ~10 symbols that are `export`ed but only used inside
  their own file (drop the `export` keyword; nothing else changes). Low risk, low
  value.
- **Over-exported types (low/cosmetic):** ~11 types used only as building blocks of
  other exported types in the same file.
- **knip false positives confirmed as KEEP:** `react-dom`, `@testing-library/dom`,
  `@types/react-dom` (web), every `ts-mocha`/`ts-node` devDep, and the SDK public
  surface (locked by `surface.test.ts`).
- **Not dead, but dependency-hygiene nits:** `bs58` and `postcss-load-config`
  imported but undeclared (resolve via hoisting); `@pythnetwork/*` peer/devDeps in
  `@meridian/e2e` are unused by e2e itself.

No fully unreferenced *files* were found once test/bin/Next.js/Cloudflare entry
points are declared.

## Tooling used + raw signal (knip output excerpt)

- **knip 6.14.2** (`npx --no-install knip`).
- A default run flagged all 50+ test files and every bin as "unused" because knip
  could not infer the mocha (`ts-mocha 'tests/**/*.test.ts'`) / vitest / Next.js /
  Cloudflare-functions entry points. I supplied a temporary `knip.audit.jsonc`
  declaring per-workspace `entry`/`project` globs (test files, `src/bin/*.ts`,
  `src/app/**/page.tsx`, `functions/api/**`, e2e setup) and re-ran. **The temp
  config was deleted after the run** — no config was left in the tree.
- Every candidate below was then verified with a repo-wide `grep` over
  `*.ts/*.tsx/*.mjs/*.json/*.md`, excluding `node_modules/`, `dist/`, `target/`.

Knip output with the corrected config (trimmed):

```
Unused dependencies (5)
  @anchor-lang/core           packages/traders/package.json
  @pythnetwork/hermes-client  packages/traders/package.json
  @solana/spl-token           packages/traders/package.json
  axios                       packages/traders/package.json
  react-dom                   packages/web/package.json          <- FALSE POSITIVE
Unused devDependencies (12)
  ts-mocha / ts-node  (automation,e2e,ops,sdk,traders)           <- FALSE POSITIVE (used by scripts; my ignoreBinaries hid the usage)
  @pythnetwork/hermes-client / @pythnetwork/pyth-solana-receiver  packages/e2e   <- unused-by-e2e (optional-peer convention)
  @testing-library/dom        packages/web                       <- FALSE POSITIVE (required peer of @testing-library/react)
  @types/react-dom            packages/web                       <- FALSE POSITIVE (react-dom types)
Unlisted dependencies
  bs58 (automation, ops), postcss-load-config (web), @solana/web3.js & friends (scripts/*.mjs)  <- declare, not dead
Unused exports (25)   <- analysed individually below
Unused exported types (11) <- all internal building blocks (low)
```

## Findings (file:line, with verification grep result)

### A. Truly dead exports — defined, exported, never referenced (HIGH)

| Symbol | Location | Verification |
| --- | --- | --- |
| `addressFor` | `packages/web/src/lib/discovery.ts:175` | Only the definition matches across the whole repo. Doc comment calls it a "sanity/round-trip helper" — never called. |
| `representativeMid` | `packages/web/src/lib/marketStats.ts:185` | Only the definition matches. (Sibling `representativeMarket` *is* used internally; `representativeMid` is not.) |
| `hasWallet` | `packages/web/src/lib/tradeForm.ts:115` | Only the definition matches; the `user is PublicKey` type-guard is never invoked. |
| `useOrderBook` | `packages/web/src/lib/useChain.ts:173` | Only the definition + comment mentions (`useChain.ts:124`, `docs/features/08-frontend.md`). No call site. The raw-book read path is served elsewhere. |

Blast radius: all four live in the **private** `@meridian/web` app (no published
surface), so removal is contained to the web package. None appear in `.mjs`
scripts, JSON, or as dynamic strings.

### B. Redundant re-export statements — dead `export {}` lines (HIGH, trivial)

These do not introduce new code; they re-export a symbol that is already part of
the package's public barrel (or only consumed internally), so the extra `export`
statement is dead.

| Statement | Location | Why dead |
| --- | --- | --- |
| `export { makeMarketPriceTool, …make5more }` | `packages/traders/src/tools/index.ts:29-36` | Each `make*Tool` is imported once (to build `makeTools`, the only thing re-exported by `src/index.ts`). The named re-export block is never imported by anyone — verified: every reference is inside `tools/index.ts` plus the defs. |
| `export { LogLevel }` | `packages/automation/src/alerter.ts:133-134` | `LogLevel` is the enum from `logger.ts`, already on the package barrel via `src/index.ts:28`. The alerter re-export ("for consumers that only import the alerter") has no importer. |
| `export { dollarsToBaseUnits }` | `packages/automation/src/config.ts:222` | Same — already surfaced from `strikes.ts` via `src/index.ts:11`; tests import it from `../src/strikes`. The `config.ts` re-export is unused. |
| `export { PRICE_SCALE_NUM }` | `packages/web/src/lib/results.ts:197` | The const is used inside `results.ts`; the trailing `export` is never imported (`format.ts` has its own private `PRICE_SCALE_NUM`). |

### C. Genuinely unused dependencies (HIGH)

`@meridian/traders/package.json` lists four runtime deps with **zero** import
sites anywhere in the package (src + tests):

- `axios` (`:31`), `@solana/spl-token` (`:29`),
  `@pythnetwork/hermes-client` (`:28`), `@anchor-lang/core` (`:23`).

Verification: `grep -rn "axios|@solana/spl-token|@pythnetwork/hermes-client|@anchor-lang/core" packages/traders` → no matches. (Bots reach the chain through `@meridian/sdk`, which owns these.)

> Removing these edits `package.json`, which per CLAUDE.md requires re-running
> `yarn install` to refresh `yarn.lock` (CI `--immutable` gate).

### D. Over-exported symbols — drop `export`, used only in-file (MEDIUM)

Exported but referenced only within their defining module (and not via the package
barrel or tests). Converting to module-private is safe but low value.

| Symbol | Location | Internal use |
| --- | --- | --- |
| `solanaBin` | `packages/ops/src/deploy.ts:37` | Used at deploy.ts:149,172. (e2e has its own private copy.) |
| `programIdFromKeypairFile` | `packages/ops/src/deploy.ts:50` | Used at deploy.ts:128. (e2e has its own copy.) |
| `DEFAULT_CLOSES` | `packages/ops/src/liveCloses.ts:36` | Used at liveCloses.ts:118. |
| `fetchLiveCloses` | `packages/ops/src/liveCloses.ts:74` | Used at liveCloses.ts:124. |
| `manifestPath` | `packages/ops/src/manifest.ts:34` | Used as default param at manifest.ts:43,51,57. `repro.test.ts` imports only `readManifest`. |
| `BotConfigSchema` | `packages/traders/src/config.ts:21` | Used at config.ts:49 (composed into `FleetConfigSchema`). |
| `DEFAULT_FLEET_PATH` | `packages/traders/src/config.ts:75` | Used as default param at config.ts:78. |
| `marketMints` | `packages/web/src/lib/leaderboardData.ts:50` | Used at leaderboardData.ts:153. |
| `representativeMarket` | `packages/web/src/lib/marketStats.ts:165` | Used at marketStats.ts:180,189,269. |
| `E2E_WALLET_NAME` / `E2E_WALLET_STORAGE_KEY` | `packages/web/src/lib/e2eWallet.ts:23,25` | Used in-file only; the Playwright spec hardcodes the literal `"meridian.e2eWallet"` instead of importing the const. |
| `LOCAL_WALLET_NAME` | `packages/web/src/lib/localWallet.ts:29` | Used at localWallet.ts:41. |

### E. Over-exported types — internal building blocks (LOW / cosmetic)

All `export`ed, but only used as a field type inside another exported
type/interface in the **same file**; no external importer. Dropping `export` is
safe but cosmetic, and slightly risky if any are intended as part of an inferred
public shape.

`LogKind`, `BotLogLine` (`traders/src/logger.ts`), `PreparedBot`
(`traders/src/runner.ts`), `FaqItem` (`web/.../faqContent.ts`), `HistoryKind`,
`HistoryAsset` (`web/src/lib/history.ts`), `LeaderboardPosition`,
`MarketHolderRow` (`web/src/lib/leaderboard.ts`), `StockResult`
(`web/src/lib/results.ts`), `IntradayPoint` (`web/src/lib/useIntradaySession.ts`),
`TxStatus` (`web/src/lib/useSendIx.ts`).

### F. Dependency-hygiene nits (not dead code)

- **Unlisted (imported, undeclared) deps** — resolve only via workspace hoisting,
  fragile under stricter installs: `bs58` (`automation/src/keypair.ts:24`,
  `ops/src/env.ts:163`), `postcss-load-config` (`web/postcss.config.mjs`), and
  `@solana/web3.js` / `@solana/spl-token` / `@pythnetwork/hermes-client` used by
  the root `scripts/*.mjs` (no `package.json` declares them for scripts). Fix by
  *adding* declarations, not removing anything.
- **`@meridian/e2e` pyth peer/devDeps** (`@pythnetwork/hermes-client`,
  `@pythnetwork/pyth-solana-receiver`): no import anywhere in e2e. They mirror the
  optional-peer convention SDK/automation use; could be dropped from e2e, but
  that's a convention call — see Risky.

## Recommendations

**high — remove, clearly safe**

1. Delete the 4 truly-dead web exports (A): `addressFor`, `representativeMid`,
   `hasWallet`, `useOrderBook`. Blast radius: web package only; no consumers.
2. Delete the 4 redundant re-export statements (B). Pure dead `export {}` lines;
   the underlying symbols stay. Blast radius: none (verified no importer).
3. Remove the 4 unused traders deps (C: `axios`, `@solana/spl-token`,
   `@pythnetwork/hermes-client`, `@anchor-lang/core`). Blast radius: `package.json`
   + `yarn.lock` regen; no source change. Run `yarn install` per CLAUDE.md.

**medium — tidy, low risk / low value**

4. Demote the over-exported symbols in (D) to module-private (drop `export`).
   Verify each remaining in-file use compiles; do it package-by-package with
   `yarn workspace <pkg> typecheck`. Skip if it adds churn for little gain.

**low — leave unless doing a types pass**

5. The over-exported types in (E) — drop `export` only if doing a dedicated
   surface-tightening pass. Cosmetic.
6. Declare the unlisted deps in (F) for install robustness (additive, not removal).

**do NOT touch (KEEP)**

- `react-dom`, `@testing-library/dom`, `@types/react-dom` in web — required
  (React/Next runtime + `@testing-library/react@16` lists `@testing-library/dom`
  as a non-optional peer; confirmed in its `package.json`).
- Every `ts-mocha` / `ts-node` devDep — used by `test` / `run-*` package scripts
  (the knip "unused devDependency" flag was an artifact of my `ignoreBinaries`).
- The entire `@meridian/sdk` export surface — `tests/surface.test.ts` locks it as
  the published API; "unused internally" ≠ dead here.

## Risky calls (dynamic / convention-based usage possible)

- **`useOrderBook` (web hook):** lowest-risk of the four "dead" items but it is a
  *hook* in a hooks file; if a future trade-surface refactor is mid-flight it might
  be intended for imminent use. It's referenced in `docs/features/08-frontend.md`
  as part of the planned hook set. Removal is correct for *current* code; flag for
  a human who knows whether the trade surface still needs a raw-book hook.
- **`E2E_WALLET_STORAGE_KEY` (D):** the Playwright spec (`web/e2e/…`) uses the raw
  string `"meridian.e2eWallet"`. Demoting the const to private is fine, but do NOT
  change the literal value — the test depends on the exact string.
- **`@meridian/e2e` pyth deps (F):** removing them is plausible but they follow the
  repo-wide optional-peer pattern; a stricter install or a future e2e test that
  reaches Hermes could need them. Convention call — leave unless intentionally
  standardizing.
- **`solanaBin` / `programIdFromKeypairFile` (D):** duplicated (private copies) in
  `e2e/src/localValidator.ts`. The `export` is unused, but this duplication is a
  separate dedup concern (see 01-dedup-dry.md) — demoting `export` and de-duping
  should be coordinated, not done blindly.
- **bin entrypoints / Makefile:** `ops`/`automation`/`traders` ship `bin` scripts
  and are spawned by the root `Makefile` and DO droplet cron, not just imports. I
  treated all `src/bin/*.ts` and the package `bin` map as live entry points; none
  were recommended for removal.

## Conflicts/dependencies with other concerns

- **01-dedup-dry.md:** `solanaBin` / `programIdFromKeypairFile` are duplicated
  between `ops/src/deploy.ts` and `e2e/src/localValidator.ts`; and there are two
  `PRICE_SCALE_NUM` / two `dollarsToBaseUnits` definitions. My "drop redundant
  export" / "demote to private" suggestions overlap with any dedup work — coordinate
  so the two passes don't conflict.
- **02-type-consolidation.md:** the over-exported types in (E) may be re-homed or
  merged by the type-consolidation pass; don't independently demote their `export`
  if that pass plans to move them.
- **Lockfile coupling:** any dep removal (C) or addition (F) regenerates
  `yarn.lock`; batch all `package.json` edits into one `yarn install` to keep the
  CI `--immutable` gate green.
