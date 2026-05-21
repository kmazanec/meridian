// Vendored copy of the compiled program interface.
//
// Three artifacts:
//   - `meridian.json`     — the canonical runtime IDL emitted by `anchor build` (the
//                           source of truth that is diffed/reviewed).
//   - `meridian-type.ts`  — the camelCase TypeScript type (also from `anchor build`) that
//                           makes `program.methods.*` and account fetches statically typed.
//   - `meridian-idl.ts`   — the IDL re-emitted as a plain TS object (generated from the
//                           JSON). The runtime imports THIS, not the `.json`, so the
//                           package loads identically under CommonJS, Node ESM (no JSON
//                           import attributes), and bundlers.
//
// They are vendored (rather than imported from the repo's gitignored `target/`) so this
// package is self-contained for downstream consumers. Regenerate after any program change:
//   anchor build
//   cp target/idl/meridian.json   packages/sdk/src/idl/meridian.json
//   cp target/types/meridian.ts   packages/sdk/src/idl/meridian-type.ts
//   node packages/sdk/scripts/gen-idl-module.mjs
// The constants-match test (idl.test.ts) fails loudly if the embedded IDL drifts from the
// program.

import { MERIDIAN_IDL } from "./meridian-idl";
import type { Meridian } from "./meridian-type";

export { MERIDIAN_IDL };
export type { Meridian };
