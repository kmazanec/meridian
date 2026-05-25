import BN from "bn.js";
import { MERIDIAN_IDL } from "./idl";

/**
 * Frozen program constants, read from the vendored IDL so they cannot drift from
 * the on-chain program. The IDL's `constants` block carries each value as a string;
 * we parse it once here and expose typed values. (See the program's `constants.rs`.)
 */
function idlConstant(name: string): string {
  const c = MERIDIAN_IDL.constants.find((x) => x.name === name);
  if (!c) {
    throw new Error(
      `Meridian IDL is missing constant "${name}" — vendored IDL is stale`
    );
  }
  return c.value;
}

/** Base units representing $1.00 of collateral / one winning token's payout (1e6). */
export const PAYOFF_UNIT = new BN(idlConstant("PAYOFF_UNIT"));

/**
 * Convert a plain dollar `number` to USDC base units (6 dp), rounded to the nearest
 * unit. The dollar input is the only float; it is immediately quantized, so callers
 * carry no float error past this boundary. Throws on a non-finite input.
 */
export function dollarsToBaseUnits(dollars: number): BN {
  if (!Number.isFinite(dollars)) {
    throw new Error(`dollars must be a finite number (got ${dollars})`);
  }
  return new BN(Math.round(dollars * Number(PAYOFF_UNIT.toString())));
}

/**
 * Order-price scale: prices are integers in USDC-per-Yes over `[0, PRICE_SCALE]`,
 * i.e. `[$0.00, $1.00]`. $0.65 is `650_000`. (Equals {@link PAYOFF_UNIT}.)
 */
export const PRICE_SCALE = new BN(idlConstant("PRICE_SCALE"));

/** Decimals of the Yes/No outcome tokens (mirrors USDC at 6). */
export const TOKEN_DECIMALS = Number(idlConstant("TOKEN_DECIMALS"));

/** Decimals of the collateral token (USDC) — 6 on Solana. */
export const USDC_DECIMALS = Number(idlConstant("USDC_DECIMALS"));

/**
 * Max resting orders per side of one book. Not in the IDL constants block (it sizes
 * the account, it is not a program `#[constant]`); frozen here to mirror the program's
 * `ORDERBOOK_N`. Clients use it to detect a full book before sending.
 */
export const ORDERBOOK_N = 128;

/** Number of supported MAG7 tickers. */
export const NUM_TICKERS = 7;
