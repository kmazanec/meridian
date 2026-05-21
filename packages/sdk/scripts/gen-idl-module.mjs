// Regenerate `src/idl/meridian-idl.ts` from the vendored `src/idl/meridian.json`.
//
// The runtime imports the IDL as a TS object (not a `.json`) so the package loads
// identically under CommonJS, Node ESM (which would otherwise require JSON import
// attributes), and bundlers. Run this whenever `meridian.json` is refreshed from
// `anchor build`.
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const idlDir = resolve(here, "..", "src", "idl");

const idl = JSON.parse(readFileSync(resolve(idlDir, "meridian.json"), "utf8"));

const out = `// AUTO-GENERATED from meridian.json by scripts/gen-idl-module.mjs — do not edit by hand.
// Regenerate after a program change:
//   anchor build
//   cp target/idl/meridian.json   packages/sdk/src/idl/meridian.json
//   cp target/types/meridian.ts   packages/sdk/src/idl/meridian-type.ts
//   node packages/sdk/scripts/gen-idl-module.mjs
//
// The IDL is embedded as a plain JS object (not a .json import) so the package loads
// identically under CommonJS, Node ESM (which would otherwise require JSON import
// attributes), and bundlers.
import type { Meridian } from "./meridian-type";

const IDL = ${JSON.stringify(idl, null, 2)} as unknown as Meridian;

export const MERIDIAN_IDL: Meridian = IDL;
`;

writeFileSync(resolve(idlDir, "meridian-idl.ts"), out);
console.log("gen-idl-module: wrote src/idl/meridian-idl.ts");
