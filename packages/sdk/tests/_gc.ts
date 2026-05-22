/**
 * Mocha root hook: force a garbage-collection pass after every test.
 *
 * Each describe block that exercises the program spins up its own LiteSVM (a
 * Rust-backed SVM with a large native arena) via `Harness.create()`. litesvm 0.8
 * exposes no explicit free, so reclamation depends on GC. On a roomy dev box this
 * never matters; on the low-RAM CI runner (≈3.8 GB, no swap) the instances pile
 * up faster than the JS heap feels pressure, and a native allocation eventually
 * fails outright with `std::bad_alloc` — before V8 would have collected anything.
 *
 * Pairing each describe's `after(() => h.dispose())` (which drops the reference)
 * with a forced `global.gc()` here keeps peak live native memory at ~one harness.
 * Requires running mocha under `--expose-gc` (see the package `test` script); if
 * gc isn't exposed this is a no-op and the dispose() refs are reclaimed normally.
 */
export const mochaHooks = {
  afterEach(): void {
    if (typeof global.gc === "function") {
      global.gc();
    }
  },
};
