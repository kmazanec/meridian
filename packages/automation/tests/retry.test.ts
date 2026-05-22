/**
 * Retry/backoff primitive tests, including the settlement wide-confidence loop:
 * retry every 30s for up to 15 minutes, then give up (the caller then alerts the admin
 * for `admin_settle`). A virtual clock + sleep is injected so the loop is deterministic
 * and instant in tests.
 */

import { expect } from "chai";
import { withBackoff, retryEvery, RetryGaveUp } from "../src/retry";

/** A controllable clock + sleep: time only advances when `sleep` is awaited. */
function virtualClock(startMs = 0) {
  let nowMs = startMs;
  return {
    now: () => nowMs,
    sleep: async (ms: number) => {
      nowMs += ms;
    },
    advance: (ms: number) => {
      nowMs += ms;
    },
  };
}

describe("withBackoff", () => {
  it("returns the first successful result without retrying", async () => {
    let calls = 0;
    const result = await withBackoff(
      async () => {
        calls++;
        return 42;
      },
      { retries: 3, baseDelayMs: 1, sleep: async () => {} }
    );
    expect(result).to.equal(42);
    expect(calls).to.equal(1);
  });

  it("retries on failure up to `retries` times then throws the last error", async () => {
    let calls = 0;
    const delays: number[] = [];
    let err: unknown;
    try {
      await withBackoff(
        async () => {
          calls++;
          throw new Error(`fail ${calls}`);
        },
        {
          retries: 3,
          baseDelayMs: 10,
          sleep: async (ms) => {
            delays.push(ms);
          },
        }
      );
    } catch (e) {
      err = e;
    }
    expect(calls).to.equal(4); // initial + 3 retries
    expect((err as Error).message).to.equal("fail 4");
    // exponential backoff: 10, 20, 40
    expect(delays).to.deep.equal([10, 20, 40]);
  });

  it("recovers if a retry eventually succeeds", async () => {
    let calls = 0;
    const result = await withBackoff(
      async () => {
        calls++;
        if (calls < 3) throw new Error("transient");
        return "ok";
      },
      { retries: 5, baseDelayMs: 1, sleep: async () => {} }
    );
    expect(result).to.equal("ok");
    expect(calls).to.equal(3);
  });
});

describe("retryEvery (wide-confidence settlement loop)", () => {
  it("succeeds immediately when the first attempt resolves truthy", async () => {
    const clock = virtualClock();
    let attempts = 0;
    const ok = await retryEvery(
      async () => {
        attempts++;
        return true;
      },
      { intervalMs: 30_000, maxDurationMs: 15 * 60_000, ...clock }
    );
    expect(ok).to.be.true;
    expect(attempts).to.equal(1);
  });

  it("retries every 30s and succeeds on a later attempt", async () => {
    const clock = virtualClock();
    let attempts = 0;
    const ok = await retryEvery(
      async () => {
        attempts++;
        return attempts === 5; // succeed on the 5th try
      },
      { intervalMs: 30_000, maxDurationMs: 15 * 60_000, ...clock }
    );
    expect(ok).to.be.true;
    expect(attempts).to.equal(5);
    // 4 sleeps of 30s elapsed before the success.
    expect(clock.now()).to.equal(4 * 30_000);
  });

  it("gives up after the max duration (15 min at 30s = ~31 attempts) by throwing RetryGaveUp", async () => {
    const clock = virtualClock();
    let attempts = 0;
    let err: unknown;
    try {
      await retryEvery(
        async () => {
          attempts++;
          return false; // never succeeds → exhausts the window
        },
        { intervalMs: 30_000, maxDurationMs: 15 * 60_000, ...clock }
      );
    } catch (e) {
      err = e;
    }
    expect(err).to.be.instanceOf(RetryGaveUp);
    // Window is 15 min; with a 30s interval the loop runs while elapsed <= max.
    expect(clock.now()).to.be.greaterThanOrEqual(15 * 60_000);
    expect(attempts).to.be.greaterThan(1);
  });

  it("propagates a non-retryable predicate error immediately (does not swallow)", async () => {
    const clock = virtualClock();
    let err: unknown;
    try {
      await retryEvery(
        async () => {
          throw new Error("hard failure");
        },
        {
          intervalMs: 30_000,
          maxDurationMs: 15 * 60_000,
          ...clock,
          retryOnError: false,
        }
      );
    } catch (e) {
      err = e;
    }
    expect((err as Error).message).to.equal("hard failure");
  });

  it("when retryOnError is true, treats a thrown error like a falsy attempt", async () => {
    const clock = virtualClock();
    let attempts = 0;
    const ok = await retryEvery(
      async () => {
        attempts++;
        if (attempts < 3) throw new Error("transient");
        return true;
      },
      {
        intervalMs: 30_000,
        maxDurationMs: 15 * 60_000,
        ...clock,
        retryOnError: true,
      }
    );
    expect(ok).to.be.true;
    expect(attempts).to.equal(3);
  });

  it("rejects a non-positive interval rather than busy-looping", async () => {
    const clock = virtualClock();
    let err: unknown;
    try {
      await retryEvery(async () => false, {
        intervalMs: 0,
        maxDurationMs: 15 * 60_000,
        ...clock,
      });
    } catch (e) {
      err = e;
    }
    expect((err as Error).message).to.match(/intervalMs must be > 0/);
  });

  it("sleeps before the first attempt when sleepFirst is set", async () => {
    const clock = virtualClock();
    const attemptClocks: number[] = [];
    const ok = await retryEvery(
      async () => {
        attemptClocks.push(clock.now());
        return true; // settles on the first (post-sleep) attempt
      },
      {
        intervalMs: 30_000,
        maxDurationMs: 15 * 60_000,
        ...clock,
        sleepFirst: true,
      }
    );
    expect(ok).to.be.true;
    expect(attemptClocks).to.deep.equal([30_000]); // attempted only after one sleep
  });
});
