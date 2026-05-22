/**
 * Retry primitives for the automation jobs.
 *
 * Two shapes:
 *   - {@link withBackoff} — exponential-backoff retry for transient RPC/network failures
 *     (used around create/settle sends). Bounded attempts; throws the last error.
 *   - {@link retryEvery} — fixed-interval retry within a time budget, used for the
 *     wide-confidence settlement loop: poll every 30s for up to 15 minutes, then give up
 *     (the caller alerts the admin for `admin_settle`). The clock and sleep are injectable
 *     so the loop is deterministic and instant under test.
 */

/** Default sleep: real wall-clock delay. Overridden in tests with a virtual clock. */
const realSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export interface BackoffOptions {
  /** Number of retries after the initial attempt (so attempts = retries + 1). */
  retries: number;
  /** Base delay; doubles each retry (`base × 2^n`). */
  baseDelayMs: number;
  /** Optional cap on any single delay. */
  maxDelayMs?: number;
  /** Injectable sleep (defaults to real setTimeout). */
  sleep?: (ms: number) => Promise<void>;
}

/**
 * Run `fn`, retrying on a thrown error with exponential backoff. Returns the first
 * successful result; rethrows the final error if all attempts fail.
 */
export async function withBackoff<T>(
  fn: () => Promise<T>,
  opts: BackoffOptions
): Promise<T> {
  const sleep = opts.sleep ?? realSleep;
  let lastError: unknown;
  for (let attempt = 0; attempt <= opts.retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt === opts.retries) break;
      let delay = opts.baseDelayMs * 2 ** attempt;
      if (opts.maxDelayMs !== undefined) delay = Math.min(delay, opts.maxDelayMs);
      await sleep(delay);
    }
  }
  throw lastError;
}

/** Thrown by {@link retryEvery} when the time budget is exhausted without success. */
export class RetryGaveUp extends Error {
  constructor(message = "retry window exhausted without success") {
    super(message);
    this.name = "RetryGaveUp";
  }
}

export interface RetryEveryOptions {
  /** Interval between attempts (e.g. 30_000 = 30s). */
  intervalMs: number;
  /** Total time budget (e.g. 15 * 60_000 = 15 min). */
  maxDurationMs: number;
  /** Current-time source (ms). Injectable for tests. */
  now?: () => number;
  /** Injectable sleep (defaults to real setTimeout). */
  sleep?: (ms: number) => Promise<void>;
  /**
   * If true, a thrown error from the attempt is treated like a falsy (retry) result
   * rather than aborting. Default false: a thrown error aborts immediately (it is a hard
   * failure, distinct from the soft "not ready yet" the boolean expresses).
   */
  retryOnError?: boolean;
}

/**
 * Poll `attempt` every `intervalMs` until it resolves truthy or the `maxDurationMs`
 * budget elapses. Returns `true` on success; throws {@link RetryGaveUp} if the window is
 * exhausted. Used for the settlement wide-confidence retry-then-alert path.
 *
 * The window check is inclusive of the boundary (`elapsed <= maxDuration`), so a 15-min
 * budget at a 30s interval makes its final attempt at the 15-min mark before giving up.
 */
export async function retryEvery(
  attempt: () => Promise<boolean>,
  opts: RetryEveryOptions
): Promise<boolean> {
  const now = opts.now ?? Date.now;
  const sleep = opts.sleep ?? realSleep;
  const start = now();

  for (;;) {
    let ok = false;
    try {
      ok = await attempt();
    } catch (err) {
      if (!opts.retryOnError) throw err;
      ok = false;
    }
    if (ok) return true;

    const elapsed = now() - start;
    if (elapsed + opts.intervalMs > opts.maxDurationMs) {
      // The next sleep would push us past the budget — stop now.
      throw new RetryGaveUp();
    }
    await sleep(opts.intervalMs);
  }
}
