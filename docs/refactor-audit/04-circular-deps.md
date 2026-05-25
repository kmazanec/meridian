# 04 — Circular dependency audit

Read-only audit of import cycles in the Meridian monorepo, both intra-package
(file ↔ file) and inter-package (workspace ↔ workspace). No source code was
modified.

## Summary

- **1 circular dependency found**, all of it intra-package in `@meridian/web`:
  - `lib/ChainDataProvider.tsx` ↔ `lib/useChain.ts`
- **0 cycles** in `sdk`, `automation`, `traders`, `e2e`, `ops`.
- **Inter-package layering is clean.** The workspace dependency graph is a proper
  DAG with no inversions:
  - `sdk` (base, depends on no other workspace) → `automation` / `traders` /
    `web` → `e2e` → `ops`.
  - `@meridian/sdk` imports **nothing** from any consumer package (the critical
    invariant — sdk must never import up the graph). Verified by grep.
  - The only cross-package edges beyond the obvious sdk fan-out are `e2e →
    automation` and `ops → {automation, e2e}`, both declared in the respective
    `package.json` and **one-directional** (no reverse import). `e2e` mentions
    `@meridian/ops` only in doc comments, not in code.

Worst (and only) offender: `@meridian/web` lib layer. Low severity — it's a
value+type cycle between two co-located client hook modules, harmless under
Next.js/webpack today (hoisted function declarations resolve it at runtime) but
worth a trivial cleanup.

## Tooling used + raw madge output (per package)

Tool: `madge --circular` (run via `npx --yes madge`). For `web`, both `.ts` and
`.tsx` were included and the package `tsconfig.json` was passed so the `@/*`,
`@meridian/sdk` path aliases resolve. Confirmed alias resolution works (104 of
135 web files had resolved edges; `@/lib/*` imports resolved to `lib/*`), so the
single reported cycle is not an artifact of unresolved imports.

```text
$ npx madge --circular --extensions ts packages/sdk/src
Processed 12 files
✔ No circular dependency found!

$ npx madge --circular --extensions ts packages/automation/src
Processed 31 files
✔ No circular dependency found!

$ npx madge --circular --extensions ts packages/traders/src
Processed 33 files
✔ No circular dependency found!

$ npx madge --circular --extensions ts,tsx --ts-config packages/web/tsconfig.json packages/web/src
Processed 135 files (52 warnings)
✖ Found 1 circular dependency!

1) lib/ChainDataProvider.tsx > lib/useChain.ts

$ npx madge --circular --extensions ts packages/e2e/src
Processed 17 files
✔ No circular dependency found!

$ npx madge --circular --extensions ts packages/ops/src
Processed 48 files
✔ No circular dependency found!
```

Note on the 52 web "warnings": these are `@meridian/sdk` imports resolving to the
built declaration file `../sdk/dist/cjs/index.d.ts` (an external package
boundary), not unresolved local modules. They do not hide intra-package cycles —
the web `@/lib` graph resolves fully.

Inter-package layering check (grep for any consumer imported "up" the graph):

```text
sdk    importing automation|traders|web|e2e|ops  → (none)
automation importing web|traders|e2e|ops         → (none)
traders importing web|automation|e2e|ops         → (none)
web    importing automation|traders|e2e|ops      → (none)
ops    importing web|traders|e2e                  → e2e only (declared dep, OK)
e2e    importing web                              → (none)
e2e    importing ops (reverse of ops→e2e)         → (none; comments only)
```

Declared workspace deps (forms a DAG, no cycles):

```text
@meridian/sdk        → (no @meridian deps)
@meridian/automation → sdk
@meridian/traders    → sdk
@meridian/web        → sdk
@meridian/e2e        → automation, sdk
@meridian/ops        → automation, e2e, sdk
```

## Findings (each cycle as a file chain)

### C-1 — `web`: ChainDataProvider ↔ useChain (value + type cycle)

**File chain:**

```
packages/web/src/lib/ChainDataProvider.tsx
   ── line 11: import { usePolled, type AsyncResource } from "./useChain"
   → packages/web/src/lib/useChain.ts
   ── line 17: import { useChainData } from "./ChainDataProvider"
   → packages/web/src/lib/ChainDataProvider.tsx   (cycle closes)
```

**What each side actually needs from the other:**

- `ChainDataProvider.tsx` needs from `useChain.ts`:
  - `usePolled` — the generic polling-resource hook (a **value/runtime** import,
    used to poll markets/books/config).
  - `AsyncResource<T>` — a **type-only** import (the shape of each polled
    resource, used in the `ChainData` interface).
- `useChain.ts` needs from `ChainDataProvider.tsx`:
  - `useChainData` — a **value/runtime** import. The shared read hooks
    (`useConfig`, `useMarkets`, `useAllBooks`) call `useChainData()` to pull the
    centralized store out of context.

So `useChain.ts` owns the low-level primitive (`usePolled` + `AsyncResource`),
`ChainDataProvider.tsx` builds the context/store on top of it, and then the
high-level read hooks (which live back in `useChain.ts`) consume that store. The
primitive and its highest-level consumers share a file, which is what closes the
loop.

This is currently benign: `useChainData`, `useConfig`, etc. are all hoisted
function declarations, and the imports are only invoked at React render time
(well after both module bodies have evaluated), so there is no
temporal-dead-zone/`undefined`-at-import hazard today. It is still an unnecessary
cycle and a latent footgun if either side later adds module-top-level code that
touches the other's export.

## Recommendations

### R-1 (**low**) — Break C-1 by extracting the polling primitive

The minimal, lowest-risk break is to move the shared primitive that
`ChainDataProvider` depends on out of `useChain.ts` into its own module, so the
dependency becomes one-directional.

**Option A (recommended): extract `usePolled` + `AsyncResource` to a new file**,
e.g. `packages/web/src/lib/usePolled.ts`.

- New direction (no cycle):
  - `usePolled.ts` — imports nothing local; exports `usePolled`, `AsyncResource`.
  - `ChainDataProvider.tsx` — imports `usePolled`/`AsyncResource` from
    `./usePolled` (instead of `./useChain`).
  - `useChain.ts` — imports `usePolled`/`AsyncResource` from `./usePolled`, and
    keeps importing `useChainData` from `./ChainDataProvider`.
  - Resulting graph: `usePolled.ts → (nothing)`,
    `ChainDataProvider.tsx → usePolled.ts`,
    `useChain.ts → {usePolled.ts, ChainDataProvider.tsx}`. Linear, acyclic.
- **Blast radius:** small and mechanical. Move ~80 lines (the `usePolled`
  function + `AsyncResource` interface, lines ~21–118 of `useChain.ts`) into the
  new file. Update the two import sites (`ChainDataProvider.tsx` line 11;
  `useChain.ts` lines 11/17 region) plus any other file that imports
  `usePolled`/`AsyncResource` directly. Grep `from "./useChain"` /
  `from "@/lib/useChain"` across `packages/web/src` to find all consumers and
  decide whether to re-export the moved symbols from `useChain.ts` for
  compatibility (a single `export { usePolled, type AsyncResource } from
  "./usePolled";` line keeps every existing external import path working and
  shrinks the diff to ~3 files). No runtime behavior change.

**Option B (smaller diff, weaker): move only the type.** `AsyncResource` is the
type half of the cycle; moving just it to a shared `types.ts` does *not* break
the cycle, because `ChainDataProvider` still imports the **value** `usePolled`
from `useChain.ts`. So Option B alone is insufficient — Option A is required to
actually remove the edge. (Noting it so a future reader doesn't reach for the
type-only move and find the cycle still there.)

Severity is **low** because the cycle is currently harmless and isolated to two
files; this is cleanup, not a bug fix. Do it opportunistically (e.g. bundled with
any other web `lib/` refactor) rather than as an urgent standalone change.

### R-2 (**low**) — Add a CI guard once C-1 is fixed (optional)

Since the codebase is otherwise cycle-free and the layering is a clean DAG, a
cheap `madge --circular` gate (per package src, web with `--ts-config`) in the
`lint-ts` job would keep it that way at near-zero cost. Optional; flag for the
owner, don't assume.

## Risky calls

- **C-1 is not a runtime bug today.** I am *not* claiming this cycle causes
  incorrect behavior or a crash — under the current code (hoisted function
  exports, render-time-only usage) it resolves fine. The recommendation is
  hygiene/future-proofing, deliberately rated **low**. Don't oversell it.
- **`ops → e2e` is intentional, leave it.** It looks unusual for a "deploy" CLI
  package to depend on the "e2e test" package, but `e2e` deliberately exports
  reusable lifecycle/fixture helpers (`Fixture`, `sendTx`, `programSoPath`, etc.)
  that `ops` builds on — see the doc comment in `packages/e2e/src/index.ts`. It's
  a declared, one-directional dependency, not a cycle. Do not "fix" it.
- **madge resolves `@meridian/sdk` to the built `dist/`**, not sdk source. That's
  correct for an external package boundary and means sdk-internal cycles are
  covered by the separate `packages/sdk/src` run (clean), not the web run. No
  blind spot, but worth stating.

## Conflicts / dependencies with other concerns

- **Type consolidation (likely concern 02/03):** `AsyncResource<T>` is the type
  on the cycle and an obvious candidate for a shared web `lib/types.ts`. If the
  type-consolidation pass moves `AsyncResource` there, coordinate so it doesn't
  *partially* address C-1 and leave the value-import edge (`usePolled`) in place —
  see R-1 Option B. The clean outcome is: `AsyncResource` + `usePolled` land
  together in one primitive module (`usePolled.ts`), or the type goes to
  `types.ts` **and** `usePolled` still moves out of `useChain.ts`. Either way,
  whoever does the C-1 break and whoever does type consolidation should not both
  touch `useChain.ts`'s top imports independently — sequence them.
- **Dedup concern:** none of the SDK read wrappers (`fetchMarket`,
  `fetchOrderBook`, etc.) are involved in any cycle; the web hooks are thin
  wrappers over sdk reads. No conflict, but the dedup auditor and this audit both
  touch `useChain.ts`, so coordinate edits to that file.
- **No conflict with any inter-package work** — the layering is already a clean
  DAG; no package boundaries need to move to resolve cycles.
