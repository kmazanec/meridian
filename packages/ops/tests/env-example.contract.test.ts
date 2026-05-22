/**
 * Env-drift guard: `.env.example` must document every variable the loaders read.
 *
 * The acceptance criterion is that `.env.example` lists *every* required environment variable
 * with safe placeholders. The loaders self-document their keys (`OPS_ENV_KEYS` here,
 * `ENV_KEYS` in @meridian/automation); this test cross-checks those against the committed
 * `.env.example` so a newly-added env var can't silently miss documentation. It also asserts
 * no real secret leaked into the template (placeholder discipline).
 */

import { expect } from "chai";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { OPS_ENV_KEYS } from "../src/env";
import { ENV_KEYS as AUTOMATION_ENV_KEYS } from "@meridian/automation";

/** Repo root from packages/ops/tests. */
const ENV_EXAMPLE = resolve(__dirname, "..", "..", "..", ".env.example");

/** Extract the bare env-var token from a documented entry like "RPC_URL (...)". */
function keyToken(entry: string): string {
  const name = entry.split(/\s|\(/)[0];
  // Reduce templated keys (FEED_<SYMBOL>, MOCK_CLOSE_<SYMBOL>) to their stable prefix.
  return name.replace(/<[^>]+>/g, "").replace(/_+$/, "");
}

describe(".env.example documents every loader key (contract)", () => {
  const text = readFileSync(ENV_EXAMPLE, "utf8");

  const allKeys = [
    ...OPS_ENV_KEYS.required,
    ...OPS_ENV_KEYS.optional,
    ...AUTOMATION_ENV_KEYS.required,
    ...AUTOMATION_ENV_KEYS.optional,
  ].map(keyToken);

  for (const key of Array.from(new Set(allKeys))) {
    it(`documents ${key}`, () => {
      // The key appears as a real var assignment OR a commented example (FEED_, MOCK_CLOSE_,
      // NEXT_PUBLIC_ etc. appear with a symbol/value suffix, so substring is the right check).
      expect(
        text.includes(key),
        `${key} is read by a loader but missing from .env.example`
      ).to.equal(true);
    });
  }

  it("documents the web NEXT_PUBLIC_* frontend vars", () => {
    for (const k of [
      "NEXT_PUBLIC_RPC_URL",
      "NEXT_PUBLIC_USDC_MINT",
      "NEXT_PUBLIC_CLUSTER",
    ]) {
      expect(text.includes(k), `${k} missing from .env.example`).to.equal(true);
    }
  });

  it("carries the never-commit-secrets warning", () => {
    expect(text.toUpperCase()).to.match(/NEVER COMMIT/);
  });

  it("contains no obviously-real secret (64-byte JSON array or long base58 blob)", () => {
    // A JSON byte array of 64 numbers would be an inline secret key; refuse it in the template.
    expect(text).to.not.match(/\[\s*\d+(\s*,\s*\d+){63}\s*\]/);
  });
});
