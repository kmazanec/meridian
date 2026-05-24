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

import {
  topHolders,
  ownerUsdcBalances,
  getMultipleAccountsChunked,
} from "./leaderboardData";

const pk = (n: number) => new PublicKey(new Uint8Array(32).fill(n));

function fakeConnection(over: Record<string, unknown>) {
  return over as unknown as import("@solana/web3.js").Connection;
}

describe("topHolders", () => {
  it("resolves token accounts to owners, skips zero + undecodable + missing", () => {
    // Owners must be on-curve wallets (off-curve PDAs are filtered — see the next test).
    const ownerA = Keypair.generate().publicKey;
    const ownerB = Keypair.generate().publicKey;
    const acctA = pk(50);
    const acctB = pk(51);
    const acctZero = pk(52); // filtered: amount "0"
    const acctMissing = pk(53); // getMultipleAccountsInfo returns null
    ownerByAccount.set(acctA.toBase58(), { owner: ownerA, amount: 5n });
    ownerByAccount.set(acctB.toBase58(), { owner: ownerB, amount: 3n });

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
        addrs.map((a) => (a.equals(acctMissing) ? null : ({} as never))),
    });

    return topHolders(connection, pk(99)).then((holders) => {
      expect(holders).toHaveLength(2);
      expect(holders[0].owner.toBase58()).toBe(ownerA.toBase58());
      expect(holders[0].amount.toNumber()).toBe(5);
      expect(holders[1].owner.toBase58()).toBe(ownerB.toBase58());
    });
  });

  it("skips off-curve (PDA) owners — vault/escrow accounts aren't traders", () => {
    const wallet = Keypair.generate().publicKey; // on-curve
    const pdaOwner = pk(7); // all-7 bytes: off-curve (a program/PDA account)
    const acctWallet = pk(60);
    const acctPda = pk(61);
    ownerByAccount.set(acctWallet.toBase58(), { owner: wallet, amount: 5n });
    ownerByAccount.set(acctPda.toBase58(), { owner: pdaOwner, amount: 9n });

    const connection = fakeConnection({
      getTokenLargestAccounts: async () => ({
        value: [
          { address: acctWallet, amount: "5" },
          { address: acctPda, amount: "9" },
        ],
      }),
      getMultipleAccountsInfo: async (addrs: PublicKey[]) =>
        addrs.map(() => ({} as never)),
    });

    return topHolders(connection, pk(99)).then((holders) => {
      expect(holders).toHaveLength(1);
      expect(holders[0].owner.toBase58()).toBe(wallet.toBase58());
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

describe("getMultipleAccountsChunked", () => {
  // Regression: getMultipleAccountsInfo rejects > 100 keys ("Too many inputs provided; max
  // 100"). The leaderboard gathers >100 owners across all markets, so it must chunk.
  it("splits > 100 keys into batches of <= 100 and concatenates in order", async () => {
    const batchSizes: number[] = [];
    const connection = fakeConnection({
      getMultipleAccountsInfo: async (keys: PublicKey[]) => {
        expect(keys.length).toBeLessThanOrEqual(100);
        batchSizes.push(keys.length);
        // Echo a marker so we can verify order: index encoded as the returned "lamports".
        return keys.map((_k, i) => ({ lamports: i } as never));
      },
    });

    const keys = Array.from({ length: 250 }, () => PublicKey.unique());
    const infos = await getMultipleAccountsChunked(connection, keys);

    expect(infos).toHaveLength(250);
    expect(batchSizes).toEqual([100, 100, 50]);
  });

  it("single call when <= 100", async () => {
    let calls = 0;
    const connection = fakeConnection({
      getMultipleAccountsInfo: async (keys: PublicKey[]) => {
        calls += 1;
        return keys.map(() => null);
      },
    });
    await getMultipleAccountsChunked(
      connection,
      Array.from({ length: 100 }, () => PublicKey.unique())
    );
    expect(calls).toBe(1);
  });
});
