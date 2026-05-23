import { describe, it, expect } from "vitest";
import BN from "bn.js";
import { PublicKey } from "@solana/web3.js";
import { isAdmin, parseDollarsToBaseUnits, formatBaseUnitsUsd } from "./adminForm";

const A = new PublicKey("11111111111111111111111111111111");
const B = new PublicKey("So11111111111111111111111111111111111111112");

describe("isAdmin", () => {
  it("true when wallet equals config admin", () => {
    expect(isAdmin(A, A)).toBe(true);
  });
  it("false when they differ", () => {
    expect(isAdmin(A, B)).toBe(false);
  });
  it("false when either is null/undefined", () => {
    expect(isAdmin(null, A)).toBe(false);
    expect(isAdmin(A, null)).toBe(false);
    expect(isAdmin(undefined, undefined)).toBe(false);
  });
});

describe("parseDollarsToBaseUnits", () => {
  it("converts whole dollars at 1e6", () => {
    const r = parseDollarsToBaseUnits("680");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.eq(new BN(680_000_000))).toBe(true);
  });
  it("converts cents (rounds to 6dp)", () => {
    const r = parseDollarsToBaseUnits("229.50");
    expect(r.ok && r.value.eq(new BN(229_500_000))).toBe(true);
  });
  it("rejects empty", () => {
    const r = parseDollarsToBaseUnits("  ");
    expect(r.ok).toBe(false);
  });
  it("rejects non-numeric", () => {
    expect(parseDollarsToBaseUnits("abc").ok).toBe(false);
  });
  it("rejects negative", () => {
    expect(parseDollarsToBaseUnits("-5").ok).toBe(false);
  });
  it("rejects absurdly large", () => {
    expect(parseDollarsToBaseUnits("2000000").ok).toBe(false);
  });
});

describe("formatBaseUnitsUsd", () => {
  it("formats base units as $X.XX", () => {
    expect(formatBaseUnitsUsd(new BN(680_000_000))).toBe("$680.00");
    expect(formatBaseUnitsUsd(new BN(229_500_000))).toBe("$229.50");
  });
});
