import { describe, it, expect } from "vitest";
import BN from "bn.js";
import { Keypair, PublicKey } from "@solana/web3.js";
import { buildHistory, eventToEntry, type DecodedEvent } from "./history";

const user = Keypair.generate().publicKey;
const other = Keypair.generate().publicKey;
const market = Keypair.generate().publicKey;
const ctx = { signature: "sig1", blockTime: 1000 };

function ev(name: string, data: Record<string, unknown>): DecodedEvent {
  return { name, data: { market, ...data } };
}

describe("eventToEntry", () => {
  it("maps the user's PairMinted", () => {
    const e = eventToEntry(
      ev("PairMinted", { user, amount: new BN(1_000_000) }),
      ctx,
      user
    )!;
    expect(e.kind).toBe("minted");
    expect(e.size!.toNumber()).toBe(1_000_000);
    expect(e.market).toBe(market.toBase58());
  });

  it("maps the user's OrderPlaced with side and price", () => {
    const e = eventToEntry(
      ev("OrderPlaced", {
        owner: user,
        side: 0,
        price: new BN(650_000),
        size: new BN(2_000_000),
        seq: new BN(1),
      }),
      ctx,
      user
    )!;
    expect(e.kind).toBe("placed");
    expect(e.summary).toMatch(/Buy Yes/);
    expect(e.price!.toNumber()).toBe(650_000);
  });

  it("maps an OrderMatched where the user is taker or maker", () => {
    const asTaker = eventToEntry(
      ev("OrderMatched", {
        maker: other,
        taker: user,
        price: new BN(700_000),
        fillSize: new BN(1_000_000),
        usdcAmount: new BN(700_000),
      }),
      ctx,
      user
    )!;
    expect(asTaker.kind).toBe("matched");
    expect(asTaker.summary).toMatch(/taker/);

    const asMaker = eventToEntry(
      ev("OrderMatched", {
        maker: user,
        taker: other,
        price: new BN(700_000),
        fillSize: new BN(1_000_000),
        usdcAmount: new BN(700_000),
      }),
      ctx,
      user
    )!;
    expect(asMaker.summary).toMatch(/maker/);
  });

  it("ignores events that don't involve the user", () => {
    expect(
      eventToEntry(
        ev("PairMinted", { user: other, amount: new BN(1) }),
        ctx,
        user
      )
    ).toBeNull();
    expect(
      eventToEntry(
        ev("OrderMatched", {
          maker: other,
          taker: other,
          price: new BN(1),
          fillSize: new BN(1),
          usdcAmount: new BN(1),
        }),
        ctx,
        user
      )
    ).toBeNull();
  });

  it("maps Redeemed (won vs lost)", () => {
    const won = eventToEntry(
      ev("Redeemed", {
        user,
        won: true,
        tokensBurned: new BN(3_000_000),
        usdcPaid: new BN(3_000_000),
      }),
      ctx,
      user
    )!;
    expect(won.summary).toMatch(/winning/i);
    const lost = eventToEntry(
      ev("Redeemed", {
        user,
        won: false,
        tokensBurned: new BN(1_000_000),
        usdcPaid: new BN(0),
      }),
      ctx,
      user
    )!;
    expect(lost.summary).toMatch(/losing/i);
  });

  it("ignores unknown event names", () => {
    expect(eventToEntry(ev("ConfigInitialized", {}), ctx, user)).toBeNull();
  });
});

describe("buildHistory", () => {
  it("collects the user's entries newest-first", () => {
    const events = [
      {
        event: ev("PairMinted", { user, amount: new BN(1) }),
        ctx: { signature: "a", blockTime: 100 },
      },
      {
        event: ev("PairMinted", { user, amount: new BN(1) }),
        ctx: { signature: "b", blockTime: 300 },
      },
      {
        event: ev("PairMinted", { user: other, amount: new BN(1) }),
        ctx: { signature: "c", blockTime: 200 },
      },
    ];
    const entries = buildHistory(events, user);
    expect(entries.map((e) => e.signature)).toEqual(["b", "a"]); // newest first, other dropped
  });
});
