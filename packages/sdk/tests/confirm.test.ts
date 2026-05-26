/**
 * Tests for the shared send/confirm helpers (HTTP polling, not WebSocket signatureSubscribe).
 *
 * `rateLimitBackoffMs` and `isRateLimited` are pure. `confirmSignature` is exercised against a
 * tiny stub Connection so we can assert it polls to a terminal state, surfaces a program error,
 * detects expiry past `lastValidBlockHeight`, and swallows a transient 429 on the status read.
 */

import { expect } from "chai";
import {
  isRateLimited,
  rateLimitBackoffMs,
  confirmSignature,
} from "../src/index";

const MIN = 10_000;
const MAX = 30_000;

/** The ceiling the helper uses internally for a given attempt (mirror of its formula). */
function ceilingFor(attempt: number): number {
  return Math.min(MAX, MIN + (MAX - MIN) * (attempt * 0.25 + 0.25));
}

describe("isRateLimited", () => {
  it("recognizes 429 / too many requests", () => {
    expect(isRateLimited(new Error("429 Too Many Requests"))).to.be.true;
    expect(isRateLimited("server responded with 429")).to.be.true;
    expect(isRateLimited(new Error("Too Many Requests"))).to.be.true;
  });
  it("does not flag unrelated errors", () => {
    expect(isRateLimited(new Error("custom program error: 0x1771"))).to.be
      .false;
    expect(isRateLimited(new Error("blockhash not found"))).to.be.false;
  });
});

describe("rateLimitBackoffMs", () => {
  it("never returns less than the floor", () => {
    for (let attempt = 0; attempt < 6; attempt++) {
      for (let i = 0; i < 200; i++) {
        expect(rateLimitBackoffMs(attempt, MIN, MAX)).to.be.at.least(MIN);
      }
    }
  });

  it("never exceeds that attempt's widening ceiling (and so never the max)", () => {
    for (let attempt = 0; attempt < 6; attempt++) {
      const ceiling = ceilingFor(attempt);
      for (let i = 0; i < 200; i++) {
        const d = rateLimitBackoffMs(attempt, MIN, MAX);
        expect(d).to.be.at.most(ceiling);
        expect(d).to.be.at.most(MAX);
      }
    }
  });

  it("widens the window on later attempts", () => {
    const sampleMax = (attempt: number) =>
      Math.max(
        ...Array.from({ length: 500 }, () =>
          rateLimitBackoffMs(attempt, MIN, MAX)
        )
      );
    expect(sampleMax(3)).to.be.greaterThan(sampleMax(0));
  });

  it("tolerates min/max passed in either order", () => {
    const d = rateLimitBackoffMs(0, MAX, MIN); // swapped on purpose
    expect(d).to.be.at.least(MIN);
    expect(d).to.be.at.most(MAX);
  });
});

/** A minimal stub of the bits of web3.js `Connection` that `confirmSignature` calls. */
function stubConnection(opts: {
  statuses: Array<{
    err?: unknown;
    confirmationStatus?: "processed" | "confirmed" | "finalized";
  } | null>;
  blockHeight?: number;
  throwOnStatusOnce?: unknown;
}): { connection: any; calls: () => number } {
  let i = 0;
  let threw = false;
  const connection = {
    async getSignatureStatuses() {
      if (opts.throwOnStatusOnce && !threw) {
        threw = true;
        throw opts.throwOnStatusOnce;
      }
      const value = [opts.statuses[Math.min(i, opts.statuses.length - 1)]];
      i++;
      return { value };
    },
    async getBlockHeight() {
      return opts.blockHeight ?? 0;
    },
  };
  return { connection, calls: () => i };
}

describe("confirmSignature", () => {
  it("resolves once the status reaches confirmed", async () => {
    const { connection } = stubConnection({
      statuses: [
        { confirmationStatus: "processed" },
        { confirmationStatus: "confirmed" },
      ],
    });
    const sig = await confirmSignature(connection, "SIG", 1_000, {
      pollIntervalMs: 1,
    });
    expect(sig).to.equal("SIG");
  });

  it("throws when the transaction reports an error", async () => {
    const { connection } = stubConnection({
      statuses: [{ err: { InstructionError: [0, "Custom"] } }],
    });
    let caught: Error | null = null;
    try {
      await confirmSignature(connection, "SIG", 1_000, { pollIntervalMs: 1 });
    } catch (e) {
      caught = e as Error;
    }
    expect(caught?.message).to.match(/failed/);
  });

  it("throws on expiry once the chain passes lastValidBlockHeight", async () => {
    const { connection } = stubConnection({
      statuses: [{ confirmationStatus: "processed" }],
      blockHeight: 2_000,
    });
    let caught: Error | null = null;
    try {
      await confirmSignature(connection, "SIG", 1_000, { pollIntervalMs: 1 });
    } catch (e) {
      caught = e as Error;
    }
    expect(caught?.message).to.match(/expired/);
  });

  it("swallows a transient 429 on the status read and keeps polling", async () => {
    const { connection } = stubConnection({
      statuses: [{ confirmationStatus: "confirmed" }],
      throwOnStatusOnce: new Error("429 Too Many Requests"),
    });
    const sig = await confirmSignature(connection, "SIG", 1_000, {
      pollIntervalMs: 1,
    });
    expect(sig).to.equal("SIG");
  });
});
