// Finalize the dual build so both entrypoints load under raw Node, not just bundlers.
//
// 1. Mark each build's module type (dist/cjs → CommonJS, dist/esm → ES modules) so Node
//    interprets the `.js` files correctly regardless of the package's top-level type.
// 2. Rewrite relative imports in the ESM output to carry explicit extensions, since Node's
//    ES-module resolver (unlike bundlers and CommonJS) does NOT add `.js` or resolve a
//    bare directory to its `index.js`. TypeScript's classic `node` resolution emits
//    extensionless specifiers, so we patch them here: `./foo` → `./foo.js`, and a
//    directory like `./idl` → `./idl/index.js`.
import { writeFileSync, existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const dist = resolve(here, "..", "dist");

const targets = [
  ["cjs", '{\n  "type": "commonjs"\n}\n'],
  ["esm", '{\n  "type": "module"\n}\n'],
];

for (const [dir, contents] of targets) {
  const d = resolve(dist, dir);
  if (!existsSync(d)) {
    throw new Error(`Expected build output at ${d} — run tsc first`);
  }
  writeFileSync(resolve(d, "package.json"), contents);
}

// --- ESM relative-import extension fixup ---

const esmDir = resolve(dist, "esm");

/** Resolve a TS-emitted relative specifier against `fromFile` into a real `.js` path. */
function resolveSpecifier(fromFile, spec) {
  const baseDir = dirname(fromFile);
  const asFile = resolve(baseDir, `${spec}.js`);
  if (existsSync(asFile)) return `${spec}.js`;
  const asDirIndex = resolve(baseDir, spec, "index.js");
  if (existsSync(asDirIndex)) return `${spec.replace(/\/$/, "")}/index.js`;
  return spec; // leave anything we can't resolve untouched
}

const RELATIVE_IMPORT =
  /(\bfrom\s+|\bimport\s+|\bexport\s+\*\s+from\s+|\bimport\()\s*(["'])(\.\.?\/[^"']*)\2/g;

function rewriteFile(file) {
  const src = readFileSync(file, "utf8");
  const out = src.replace(RELATIVE_IMPORT, (match, kw, quote, spec) => {
    if (/\.(js|json|mjs|cjs)$/.test(spec)) return match; // already extensioned
    const fixed = resolveSpecifier(file, spec);
    return `${kw}${quote}${fixed}${quote}`;
  });
  if (out !== src) writeFileSync(file, out);
}

function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walk(p);
    else if (p.endsWith(".js")) rewriteFile(p);
  }
}

walk(esmDir);

console.log("finalize-dist: wrote type markers + fixed ESM import extensions");
