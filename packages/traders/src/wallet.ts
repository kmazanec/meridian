/**
 * Load a trader {@link Keypair} from a file path.
 *
 * Unlike the automation service (one secret in an env var), each bot owns a *named wallet
 * file* — the two persistent test traders created by `scripts/fund-test-traders.mjs` live
 * at `~/.config/solana/trader{1,2}.json`. The bots config points each bot at one such
 * path. We accept the Solana CLI keypair format (a JSON array of 64 byte values) and
 * expand a leading `~` to the home directory, exactly like the funding script, so the same
 * paths work in both places.
 *
 * These are real signing keys. They are only ever loaded from a path the operator chose
 * (never logged), and on devnet they hold mock USDC — but treat them as secrets anyway.
 */

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { Keypair } from "@solana/web3.js";

/** Expand a leading `~` to the user's home directory (matches fund-test-traders.mjs). */
export function expandPath(p: string): string {
  return p.startsWith("~") ? p.replace("~", homedir()) : p;
}

/**
 * Load a {@link Keypair} from a Solana CLI keypair file (JSON array of 64 bytes).
 * Throws a clear error if the file is missing or not a valid 64-byte secret.
 */
export function loadWallet(path: string): Keypair {
  const full = expandPath(path);
  let raw: string;
  try {
    raw = readFileSync(full, "utf8");
  } catch (err) {
    throw new Error(
      `Could not read wallet file at ${full}: ${
        err instanceof Error ? err.message : String(err)
      }. ` + `Fund the test traders first (e.g. \`make fund-traders-devnet\`).`
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(
      `Wallet file ${full} is not valid JSON (expected a byte array).`
    );
  }
  if (!Array.isArray(parsed) || !parsed.every((n) => typeof n === "number")) {
    throw new Error(`Wallet file ${full} must be a JSON array of byte values.`);
  }
  const secret = Uint8Array.from(parsed as number[]);
  if (secret.length !== 64) {
    throw new Error(
      `Wallet file ${full} decoded to ${secret.length} bytes; an ed25519 secret key is 64 bytes.`
    );
  }
  try {
    return Keypair.fromSecretKey(secret);
  } catch (err) {
    throw new Error(
      `Wallet file ${full} is not a valid ed25519 keypair: ${
        err instanceof Error ? err.message : String(err)
      }`
    );
  }
}
