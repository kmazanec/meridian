import BN from "bn.js";
import { PublicKey } from "@solana/web3.js";
import { PAYOFF_UNIT } from "@meridian/sdk";

/**
 * Pure helpers for the /admin controls. Kept separate from the component so the gating and
 * the dollars→base-units parsing (which must match the program's 6-dp fixed point) are unit
 * tested. PAYOFF_UNIT is 1e6 = $1.00, the same scale the ops scripts and settlement use.
 */

/** True iff the connected wallet is the on-chain Config admin (the only authority for the
 * admin-gated instructions). Null/undefined inputs → false. */
export function isAdmin(
  wallet: PublicKey | null | undefined,
  configAdmin: PublicKey | null | undefined
): boolean {
  if (!wallet || !configAdmin) return false;
  return wallet.equals(configAdmin);
}

/**
 * Parse a dollar string (e.g. "680", "229.50") to USDC base units (6 dp), matching the
 * program's fixed point: `round(dollars * 1e6)`. Returns an error string instead of throwing
 * so a form can show it. Rejects empty, non-numeric, negative, and absurdly large values.
 */
export function parseDollarsToBaseUnits(
  input: string
): { ok: true; value: BN } | { ok: false; error: string } {
  const trimmed = input.trim();
  if (trimmed === "") return { ok: false, error: "Enter a price." };
  const dollars = Number(trimmed);
  if (!Number.isFinite(dollars)) {
    return { ok: false, error: "Price must be a number." };
  }
  if (dollars < 0) return { ok: false, error: "Price can’t be negative." };
  if (dollars > 1_000_000) {
    return { ok: false, error: "Price is unreasonably large." };
  }
  const unit = Number(PAYOFF_UNIT.toString());
  return { ok: true, value: new BN(Math.round(dollars * unit)) };
}

/** Format base units (6 dp) back to a "$X.XX" string for display. */
export function formatBaseUnitsUsd(units: BN): string {
  const unit = Number(PAYOFF_UNIT.toString());
  return `$${(Number(units.toString()) / unit).toFixed(2)}`;
}
