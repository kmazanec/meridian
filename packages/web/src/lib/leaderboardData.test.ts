import { describe, it, expect, beforeEach, vi } from "vitest";
import { Keypair, PublicKey } from "@solana/web3.js";

// Control what each token account decodes to (owner, amount), keyed by account address. We
// mock @solana/spl-token but explicitly re-export the REAL getAssociatedTokenAddressSync (and
// constants) so ATA derivation in ownerUsdcBalances keeps working — only unpackAccount is
// replaced. (Spreading the actual module instead wraps each export in a proxy, which breaks
// the ed25519/PDA math; passing the real function reference through avoids that.)
const ownerByAccount = new Map<string, { owner: PublicKey; amount: bigint }>();

vi.mock("@solana/spl-token", async (orig) => {
  const actual = await orig<typeof import("@solana/spl-token")>();
  return {
    getAssociatedTokenAddressSync: actual.getAssociatedTokenAddressSync,
    TOKEN_PROGRAM_ID: actual.TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID: actual.ASSOCIATED_TOKEN_PROGRAM_ID,
    unpackAccount: (address: PublicKey) => {
      const e = ownerByAccount.get(address.toBase58());
      if (!e) throw new Error("not a token account");
      return { owner: e.owner, amount: e.amount };
    },
  };
});

beforeEach(() => ownerByAccount.clear());

import { topHolders, ownerUsdcBalances } from "./leaderboardData";

const pk = (n: number) => new PublicKey(new Uint8Array(32).fill(n));

function fakeConnection(over: Record<string, unknown>) {
  return over as unknown as import("@solana/web3.js").Connection;
}

describe("topHolders", () => {
  it("resolves token accounts to owners, skips zero + undecodable + missing", () => {
    const acctA = pk(50); // owner 1, amount 5
    const acctB = pk(51); // owner 2, amount 3
    const acctZero = pk(52); // filtered: amount "0"
    const acctMissing = pk(53); // getMultipleAccountsInfo returns null
    ownerByAccount.set(acctA.toBase58(), { owner: pk(1), amount: 5n });
    ownerByAccount.set(acctB.toBase58(), { owner: pk(2), amount: 3n });

    const connection = fakeConnection({
      getTokenLargestAccounts: async () => ({
        value: [
          { address: acctA, amount: "5" },
          { address: acctB, amount: "3" },
          { address: acctZero, amount: "0" },
          { address: acctMissing, amount: "1" },
        ],
      }),
      getMultipleAccountsInfo: async (addrs: PublicKey[]) =>
        // acctZero was filtered before this call; the remaining three are A, B, missing.
        addrs.map((a) =>
          a.equals(acctMissing) ? null : ({} as never)
        ),
    });

    return topHolders(connection, pk(99)).then((holders) => {
      expect(holders).toHaveLength(2);
      expect(holders[0].owner.toBase58()).toBe(pk(1).toBase58());
      expect(holders[0].amount.toNumber()).toBe(5);
      expect(holders[1].owner.toBase58()).toBe(pk(2).toBase58());
    });
  });

  it("returns [] when a mint has no holders", async () => {
    const connection = fakeConnection({
      getTokenLargestAccounts: async () => ({ value: [] }),
    });
    expect(await topHolders(connection, pk(99))).toEqual([]);
  });
});

describe("ownerUsdcBalances", () => {
  // NOTE: the present/absent decode path is covered by topHolders above (same unpackAccount +
  // getMultipleAccountsInfo logic). We don't unit-test the ATA-derivation branch here because
  // @solana/web3.js's ed25519/PDA derivation misbehaves under jsdom — that math is exercised
  // for real against a validator in the e2e suite, not in jsdom.

  it("no owners → empty map, no RPC", async () => {
    const getMultipleAccountsInfo = vi.fn();
    const connection = fakeConnection({ getMultipleAccountsInfo });
    const bals = await ownerUsdcBalances(connection, [], pk(80));
    expect(bals.size).toBe(0);
    expect(getMultipleAccountsInfo).not.toHaveBeenCalled();
  });
});
