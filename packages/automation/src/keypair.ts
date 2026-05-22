/**
 * Load the automation keypair from an environment secret.
 *
 * Secrets handling (ROADMAP concern #8 / ARCHITECTURE §13): the funded automation keypair
 * is provided via an environment variable only — never read from a path committed to the
 * repo, never logged. Two formats are accepted:
 *   - a JSON byte array (the Solana CLI keypair file's contents), or
 *   - a base58-encoded secret key.
 * The loader is deliberately strict: a missing, empty, or malformed secret throws a clear
 * error rather than silently producing a junk key.
 *
 * The keypair only signs permissioned instructions and pays fees; the PDA design means it
 * cannot move user funds or violate invariants (ADR-005). Even so, it is a real secret —
 * treat the env var as sensitive (mask it in CI, never echo it).
 */

import { Keypair } from "@solana/web3.js";

const ENV_VAR = "AUTOMATION_KEYPAIR";

/** Decode a base58 string to bytes (bs58 ships transitively with @solana/web3.js). */
function base58Decode(s: string): Uint8Array {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const bs58 = require("bs58");
  return (bs58.default ?? bs58).decode(s);
}

/**
 * Load the automation {@link Keypair} from `env[AUTOMATION_KEYPAIR]`. Defaults to reading
 * `process.env`; a map can be passed for testing. Throws on missing/empty/malformed.
 */
export function loadKeypairFromEnv(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env
): Keypair {
  const raw = env[ENV_VAR];
  if (raw === undefined) {
    throw new Error(
      `${ENV_VAR} is not set. Provide the automation keypair secret via this environment ` +
        `variable (a JSON byte array or a base58 secret key). Never commit it.`
    );
  }
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    throw new Error(`${ENV_VAR} is empty.`);
  }

  let secret: Uint8Array;
  if (trimmed.startsWith("[")) {
    // JSON byte-array form (Solana CLI keypair file contents).
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      throw new Error(`${ENV_VAR} looks like JSON but failed to parse.`);
    }
    if (!Array.isArray(parsed) || !parsed.every((n) => typeof n === "number")) {
      throw new Error(`${ENV_VAR} JSON must be an array of byte values.`);
    }
    secret = Uint8Array.from(parsed as number[]);
  } else {
    // base58 secret-key form.
    try {
      secret = base58Decode(trimmed);
    } catch {
      throw new Error(
        `${ENV_VAR} is not valid base58 (and not a JSON byte array).`
      );
    }
  }

  if (secret.length !== 64) {
    throw new Error(
      `${ENV_VAR} decoded to ${secret.length} bytes; an ed25519 secret key is 64 bytes.`
    );
  }
  try {
    return Keypair.fromSecretKey(secret);
  } catch (err) {
    throw new Error(
      `${ENV_VAR} is not a valid ed25519 keypair: ${
        err instanceof Error ? err.message : String(err)
      }`
    );
  }
}

/** The env var name the secret is read from (documented for `.env.example`, owned by F-10). */
export const AUTOMATION_KEYPAIR_ENV = ENV_VAR;
