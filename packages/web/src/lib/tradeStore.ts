import BN from "bn.js";

/**
 * A local cost-basis store. The chain doesn't record per-user entry prices, so to show
 * P&L the frontend remembers the user's own fills locally (a size-weighted average
 * entry per wallet+market+side). This is **display-only**: it never affects what the
 * program does, and a cleared store just means P&L falls back to "no basis" — funds and
 * settlement are unaffected. Persisted in localStorage, keyed by wallet.
 */

export type Side = "yes" | "no";

/** A recorded fill: side, size acquired (6dp), and the price paid (price scale). */
export interface FillRecord {
  market: string; // base58 market address
  side: Side;
  size: string; // BN base units as string (JSON-safe)
  price: string; // BN price scale as string
  ts: number;
}

/** A size-weighted average entry for one market+side. */
export interface CostBasis {
  size: BN;
  avgPrice: BN;
}

const KEY_PREFIX = "meridian.fills.";

function storageKey(wallet: string): string {
  return KEY_PREFIX + wallet;
}

/** Pure: fold a list of fills into a per-(market,side) size-weighted average entry. */
export function aggregateBasis(fills: FillRecord[]): Map<string, CostBasis> {
  const byKey = new Map<string, CostBasis>();
  for (const f of fills) {
    const key = `${f.market}:${f.side}`;
    const size = new BN(f.size);
    const price = new BN(f.price);
    const prev = byKey.get(key);
    if (!prev) {
      byKey.set(key, { size, avgPrice: price });
      continue;
    }
    // New weighted average: (prevSize*prevAvg + size*price) / (prevSize + size).
    const totalSize = prev.size.add(size);
    if (totalSize.isZero()) {
      byKey.set(key, { size: new BN(0), avgPrice: new BN(0) });
      continue;
    }
    const weighted = prev.size
      .mul(prev.avgPrice)
      .add(size.mul(price))
      .div(totalSize);
    byKey.set(key, { size: totalSize, avgPrice: weighted });
  }
  return byKey;
}

/** The composite key used to look up a basis for a market+side. */
export function basisKey(market: string, side: Side): string {
  return `${market}:${side}`;
}

function readFills(wallet: string): FillRecord[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(storageKey(wallet));
    return raw ? (JSON.parse(raw) as FillRecord[]) : [];
  } catch {
    return [];
  }
}

function writeFills(wallet: string, fills: FillRecord[]): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(storageKey(wallet), JSON.stringify(fills));
  } catch {
    // A full/disabled localStorage just means no P&L basis — non-fatal.
  }
}

/** Record a fill for a wallet (appends; basis is computed on read). */
export function recordFill(wallet: string, fill: FillRecord): void {
  const fills = readFills(wallet);
  fills.push(fill);
  writeFills(wallet, fills);
}

/** The aggregated cost basis for a wallet, keyed by `market:side`. */
export function loadBasis(wallet: string): Map<string, CostBasis> {
  return aggregateBasis(readFills(wallet));
}
