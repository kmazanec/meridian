/**
 * Environment configuration for the ops scripts.
 *
 * The ops scripts are *environment-agnostic*: the same `deploy` / `bootstrap` /
 * `create-markets` / `lifecycle` code runs against a local `solana-test-validator` (CI,
 * demo) and against real devnet, selected entirely by `RPC_URL` + which keypair is supplied.
 * All inputs come from the environment (ROADMAP secrets concern #8); nothing is read from a
 * committed path and no secret is logged.
 *
 * Keypair handling is deliberately broader than the automation service's: a *human operator*
 * deploying to devnet already has a Solana CLI keypair *file* (`~/.config/solana/id.json`),
 * so `DEPLOYER_KEYPAIR` accepts a **file path** in addition to the inline forms the
 * automation loader takes (JSON byte array, base58). The deployer is the program upgrade
 * authority + Config admin; on a local validator it is funded by airdrop, on devnet by the
 * operator's pre-funded balance.
 *
 * The exact env keys are documented in `.env.example` (owned by this feature). See
 * `OPS_ENV_KEYS` at the bottom — kept in sync with the loader by the env-drift guard test.
 */

import { existsSync, readFileSync } from "node:fs";
import BN from "bn.js";
import { Keypair, PublicKey } from "@solana/web3.js";
import {
  Ticker,
  TickerSymbol,
  TICKER_SYMBOLS,
  symbolToTicker,
  PAYOFF_UNIT,
} from "@meridian/sdk";

/** Default RPC endpoint when `RPC_URL` is unset — the local validator. */
export const DEFAULT_LOCAL_RPC = "http://127.0.0.1:8899";

type Env = NodeJS.ProcessEnv | Record<string, string | undefined>;

export interface OpsEnv {
  /** The deployer / admin keypair (upgrade authority + Config admin). */
  deployer: Keypair;
  /** Solana RPC endpoint. Local validator by default. */
  rpcUrl: string;
  /** Cluster label for display/manifest (derived from `RPC_URL`, overridable by `CLUSTER`). */
  cluster: string;
  /** Pre-existing USDC mint to use as collateral; absent → bootstrap creates a mock mint. */
  usdcMint?: PublicKey;
  /** Tickers to operate on (default: full MAG7). */
  tickers: Ticker[];
  /** Per-ticker mock previous-close in USDC base units (drives create-markets strikes). */
  mockCloses: Partial<Record<TickerSymbol, BN>>;
  /** Per-ticker Pyth feed ids (hex) for devnet; absent tickers use the local test pattern. */
  feedIdsHex: Partial<Record<TickerSymbol, string>>;
  /** Include the rounded close as an at-the-money strike. Default false. */
  includeClose: boolean;
  /** Explicit trading-day (unix seconds) for create-markets; default = ~2h from now. */
  tradingDayOverride?: number;
}

function required(env: Env, key: string): string {
  const v = env[key];
  if (v === undefined || v.trim().length === 0) {
    throw new Error(`${key} is required but not set.`);
  }
  return v.trim();
}

/**
 * Resolve a deployer keypair from `DEPLOYER_KEYPAIR`, accepting (in order):
 *   1. a filesystem **path** to a Solana CLI keypair file (JSON byte array) — the operator
 *      convention for devnet,
 *   2. an inline **JSON byte array** (the file's contents pasted into the env),
 *   3. an inline **base58** secret key.
 * A value that looks like a path (no `[`, not valid base58) but does not exist on disk
 * fails loudly rather than being misread.
 */
function loadDeployerKeypair(env: Env): Keypair {
  const raw = required(env, "DEPLOYER_KEYPAIR");

  // Inline JSON byte array.
  if (raw.startsWith("[")) {
    return keypairFromJsonBytes(raw, "DEPLOYER_KEYPAIR (inline JSON)");
  }

  // A path: read the file and parse its JSON byte array.
  // Heuristic: a path separator, a leading `~`, or a `.json` suffix. We deliberately do NOT
  // treat a bare existing-filename as a path: a base58 secret key (no `/`, ~88 chars) could
  // otherwise collide with a same-named file in the CWD and be read as the wrong "keypair".
  // Path-like values always carry one of these markers; a base58 secret carries none.
  const looksLikePath =
    raw.includes("/") || raw.startsWith("~") || raw.endsWith(".json");
  if (looksLikePath) {
    const path = expandHome(raw);
    if (!existsSync(path)) {
      throw new Error(
        `DEPLOYER_KEYPAIR looks like a keypair file path but no file exists at: ${path}`
      );
    }
    let contents: string;
    try {
      contents = readFileSync(path, "utf8");
    } catch (err) {
      throw new Error(
        `DEPLOYER_KEYPAIR keypair file could not be read (${path}): ${
          err instanceof Error ? err.message : String(err)
        }`
      );
    }
    return keypairFromJsonBytes(contents, `DEPLOYER_KEYPAIR file ${path}`);
  }

  // Inline base58 secret key.
  let secret: Uint8Array;
  try {
    secret = base58Decode(raw);
  } catch {
    throw new Error(
      `DEPLOYER_KEYPAIR is not a keypair file path, a JSON byte array, or valid base58.`
    );
  }
  return keypairFromSecretBytes(secret, "DEPLOYER_KEYPAIR (base58)");
}

function keypairFromJsonBytes(json: string, label: string): Keypair {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error(`${label} is not valid JSON.`);
  }
  if (!Array.isArray(parsed) || !parsed.every((n) => typeof n === "number")) {
    throw new Error(`${label} must be a JSON array of byte values.`);
  }
  return keypairFromSecretBytes(Uint8Array.from(parsed as number[]), label);
}

function keypairFromSecretBytes(secret: Uint8Array, label: string): Keypair {
  if (secret.length !== 64) {
    throw new Error(
      `${label} decoded to ${secret.length} bytes; an ed25519 secret key is 64 bytes.`
    );
  }
  try {
    return Keypair.fromSecretKey(secret);
  } catch (err) {
    throw new Error(
      `${label} is not a valid ed25519 keypair: ${
        err instanceof Error ? err.message : String(err)
      }`
    );
  }
}

/** Decode base58 (bs58 ships transitively with @solana/web3.js). */
function base58Decode(s: string): Uint8Array {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const bs58 = require("bs58");
  return (bs58.default ?? bs58).decode(s);
}

/** Expand a leading `~` to the user's home directory. */
function expandHome(p: string): string {
  if (p === "~" || p.startsWith("~/")) {
    const home = process.env.HOME ?? process.env.USERPROFILE ?? "";
    return home + p.slice(1);
  }
  return p;
}

function parsePubkey(value: string, key: string): PublicKey {
  try {
    return new PublicKey(value);
  } catch {
    throw new Error(`${key} is not a valid base58 public key: ${value}`);
  }
}

/** Derive a human cluster label from an RPC URL (overridden by `CLUSTER`). */
function clusterLabel(rpcUrl: string, override?: string): string {
  if (override && override.trim().length > 0) return override.trim();
  if (isLocalRpc(rpcUrl)) return "localnet";
  const u = rpcUrl.toLowerCase();
  if (u.includes("devnet")) return "devnet";
  if (u.includes("testnet")) return "testnet";
  if (u.includes("mainnet")) return "mainnet-beta";
  // Deliberately NOT "localnet": an unrecognized endpoint (e.g. a private/staging node) is
  // unknown, not local. Defaulting it to "localnet" would let the local-only `dev-up` guard
  // (which now checks the RPC host, not this label) be fooled — see isLocalRpc.
  return "unknown";
}

/**
 * True only for an RPC that is unambiguously a LOCAL validator (loopback host). This is the
 * authoritative check for the `dev-up` safety guard — it inspects the actual RPC host rather
 * than the cosmetic cluster label, so a private/non-standard remote URL can never be mistaken
 * for local and trigger an airdrop/mock-mint against a real cluster. Parses the URL so a
 * substring like "localhost" inside a path/query can't grant local status.
 */
export function isLocalRpc(rpcUrl: string): boolean {
  let host: string;
  try {
    host = new URL(rpcUrl).hostname.toLowerCase();
  } catch {
    return false;
  }
  // URL.hostname keeps IPv6 brackets (e.g. "[::1]"); strip them for the comparison.
  if (host.startsWith("[") && host.endsWith("]")) host = host.slice(1, -1);
  return (
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "0.0.0.0" ||
    host === "::1" ||
    host.endsWith(".localhost")
  );
}

/** Parse a comma-separated TICKERS list (symbols) into ordinals; default = full MAG7. */
function parseTickers(value: string | undefined): Ticker[] {
  if (!value || value.trim().length === 0) {
    return TICKER_SYMBOLS.map((s) => symbolToTicker(s));
  }
  return value
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((s) => symbolToTicker(s)); // throws on an unknown symbol
}

function parseBool(value: string | undefined): boolean {
  if (!value) return false;
  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

/** Exact dollars → USDC base units (6 dp), integer-rounded (no $10 snapping here). */
function dollarsExactToBaseUnits(dollars: number): BN {
  return new BN(Math.round(dollars * Number(PAYOFF_UNIT.toString())));
}

/** Parse and validate the ops config from an environment map. */
export function loadOpsEnv(env: Env = process.env): OpsEnv {
  const deployer = loadDeployerKeypair(env);
  const rpcUrl = (env["RPC_URL"]?.trim() || DEFAULT_LOCAL_RPC) as string;
  const cluster = clusterLabel(rpcUrl, env["CLUSTER"]);

  const usdcRaw = env["USDC_MINT"]?.trim();
  const usdcMint = usdcRaw ? parsePubkey(usdcRaw, "USDC_MINT") : undefined;

  const tickers = parseTickers(env["TICKERS"]);

  const mockCloses: Partial<Record<TickerSymbol, BN>> = {};
  const feedIdsHex: Partial<Record<TickerSymbol, string>> = {};
  for (const sym of TICKER_SYMBOLS) {
    const mock = env[`MOCK_CLOSE_${sym}`]?.trim();
    if (mock) {
      const dollars = Number(mock);
      if (!Number.isFinite(dollars) || dollars <= 0) {
        throw new Error(
          `MOCK_CLOSE_${sym} must be a positive number (got "${mock}")`
        );
      }
      mockCloses[sym] = dollarsExactToBaseUnits(dollars);
    }
    const feed = env[`FEED_${sym}`]?.trim();
    if (feed) feedIdsHex[sym] = normalizeFeedId(feed, sym);
  }

  let tradingDayOverride: number | undefined;
  const tdRaw = env["TRADING_DAY"]?.trim();
  if (tdRaw) {
    const td = Number(tdRaw);
    if (!Number.isInteger(td) || td <= 0) {
      throw new Error(
        `TRADING_DAY must be a positive integer (unix seconds); got "${tdRaw}"`
      );
    }
    tradingDayOverride = td;
  }

  return {
    deployer,
    rpcUrl,
    cluster,
    usdcMint,
    tickers,
    mockCloses,
    feedIdsHex,
    includeClose: parseBool(env["INCLUDE_CLOSE"]),
    tradingDayOverride,
  };
}

/**
 * Validate a Pyth feed id (32-byte / 64-hex, optional `0x`) and return it unchanged. Catches
 * a transposed/garbage id at config load rather than at settlement; the value is the same
 * form `bootstrap.feedIdHexToBytes` consumes. (Mirrors the automation config's check.)
 */
function normalizeFeedId(value: string, sym: string): string {
  const hex = value.startsWith("0x") ? value.slice(2) : value;
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error(
      `FEED_${sym} must be a 32-byte hex feed id (64 hex chars, optional 0x prefix); got "${value}"`
    );
  }
  return value;
}

/**
 * The environment keys the ops scripts read. Documented here so `.env.example` (owned by
 * this feature) and the env-drift guard test stay in sync with the loader.
 */
export const OPS_ENV_KEYS = {
  required: [
    "DEPLOYER_KEYPAIR (keypair FILE PATH, or inline JSON byte array / base58 secret — never commit a real one)",
  ],
  optional: [
    `RPC_URL (Solana RPC endpoint; default ${DEFAULT_LOCAL_RPC})`,
    "CLUSTER (display label; default derived from RPC_URL)",
    "USDC_MINT (existing collateral mint pubkey; default: bootstrap creates a mock mint)",
    "TICKERS (comma list of symbols to operate on; default all MAG7)",
    "MOCK_CLOSE_<SYMBOL> (mock previous close in dollars, e.g. MOCK_CLOSE_META=680)",
    "FEED_<SYMBOL> (devnet Pyth hex feed id per ticker; absent → local test pattern)",
    "INCLUDE_CLOSE (1/true to add the at-the-money strike)",
    "TRADING_DAY (unix seconds for create-markets; default ~2h from now)",
  ],
} as const;
