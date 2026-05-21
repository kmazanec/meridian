// Vendored copy of the compiled program interface.
//
// Two artifacts, both produced by `anchor build`:
//   - `meridian.json`      — the runtime IDL (what the Anchor client deserializes
//                            instructions/accounts against). Carries the program id.
//   - `meridian-type.ts`   — the camelCase TypeScript type that makes `program.methods.*`
//                            and account fetches statically typed.
//
// They are vendored (rather than imported from the repo's gitignored `target/`) so this
// package is self-contained for downstream consumers. Regenerate after any program change:
//   `anchor build`
//   `cp target/idl/meridian.json        packages/sdk/src/idl/meridian.json`
//   `cp target/types/meridian.ts        packages/sdk/src/idl/meridian-type.ts`
// The constants-match test (idl.test.ts) fails loudly if the JSON drifts from the program.

import idlJson from "./meridian.json";
import type { Meridian } from "./meridian-type";

/** The strongly-typed runtime IDL for the Meridian program. */
export const MERIDIAN_IDL = idlJson as Meridian;

export type { Meridian };
