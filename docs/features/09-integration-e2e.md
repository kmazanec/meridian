# Feature: Integration & E2E

**ID:** F-09 · **Roadmap piece:** F-09 · **Status:** Not started

## Description

This delivers the cross-stack integration and end-to-end test suite that proves the
whole system works together: the full daily lifecycle (create → mint → trade → settle
→ redeem), all four trade paths (Buy Yes, Buy No, Sell Yes, Sell No), and a
multi-user scenario (one user mints and quotes, another takes, both redeem). It
verifies the on-chain invariants hold across the integrated stack.

It exists because the parallel tracks (program features, SDK, automation, frontend)
must re-synchronize, and the brief's success criteria are end-to-end behaviors. This
is the convergence point where interface mismatches surface.

## How it fits the roadmap

Wave 5, the re-synchronization point on the critical path. It depends on essentially
everything and is the highest-coordination moment in the plan. It unblocks deployment
(F-10).

## Dependencies (must exist before this starts)

- **F-02, F-03, F-04, F-05** — the complete on-chain instruction set.
- **F-06 Shared TS SDK** — the client used to drive the lifecycle.
- **F-07 Automation service** — the scheduled create/settle legs.
- **F-08 Frontend** — the user-facing lifecycle and trade paths.

## Unblocks (what waits on this)

- **F-10 Deployment & reproducibility** — packages and scripts the verified lifecycle
  for one-command devnet runs.

## Acceptance criteria

- The full lifecycle passes end-to-end on a test validator and/or devnet:
  create market → mint pair → trade on the order book → settle via oracle → redeem.
- All four trade paths function on the one order book: Buy Yes, Buy No (mint + sell
  Yes), Sell Yes, Sell No (buy Yes).
- The multi-user scenario passes: a maker mints and posts quotes, a taker fills, the
  market settles, and both parties redeem to the correct USDC amounts.
- All on-chain invariants hold across the integrated run: collateralization, payout
  completeness, token provenance, settlement immutability, settlement timing, oracle
  quality (ARCHITECTURE.md §7).
- Settlement executes correctly within 10 minutes of market close in the scenario
  (using the chosen devnet oracle path or the documented fallback).
- Interface mismatches between program, SDK, automation, and frontend are resolved;
  any cross-cutting contract changes are propagated back to ROADMAP.md/ARCHITECTURE.md.

## Testing requirements

- Integration/E2E tests covering: the full lifecycle; each of the four trade paths;
  the multi-user scenario; invariant assertions after each phase.
- Tests must run against a real environment (local validator and/or devnet), not just
  mocks, and must cover the architecture's named risks (oracle staleness/confidence,
  partial fills, at-strike boundary).

## Manual setup required

- A configured devnet (or local validator) environment with funded keypairs and test
  USDC; for the oracle leg, whatever the F-04 spike concluded (live devnet feeds
  during market hours, or the fallback path).

## Implementation notes (filled in by the building agent)

> The agent implementing this feature records its implementation decisions and
> rationale here as it builds — chosen libraries/patterns within the architecture's
> constraints, trade-offs made, deviations from assumptions and why, and anything the
> next agent or the integrator needs to know. This section starts empty and is owned
> by the builder, not the planner. Cross-cutting discoveries that affect other
> features must also be propagated to ROADMAP.md or the architecture doc, not just
> left here.
