# Feature: Settlement & Oracle

**ID:** F-04 · **Roadmap piece:** F-04 · **Status:** Not started

## Description

This delivers settlement: the `settle_market` instruction (read the stock's closing
price on-chain via the oracle, validate freshness and confidence, and write the
immutable Yes/No outcome) and the `admin_settle` fallback (an admin-only,
time-delayed override for when the oracle is unavailable). It owns the oracle
abstraction (a Pyth implementation behind an interface) and the payout-completeness
invariant.

It also contains the project's #1 de-risking task: a **devnet equity-feed spike** —
a small verification that each MAG7 feed returns a fresh price on Solana devnet
during market hours (via Hermes → Pyth Solana Receiver → `get_price_no_older_than`).
The spike's outcome decides whether live-Pyth settlement is the devnet demo path or
whether a fallback (crypto-feed stand-ins / mocked oracle) is used.

## How it fits the roadmap

Wave 2, on the critical path (F-02 → F-04 → F-06 → …) and the riskiest link. Run the
devnet feed spike *first*, before committing settlement logic, so a negative finding
triggers the documented fallback early (ARCHITECTURE.md §14 Q1).

## Dependencies (must exist before this starts)

- **F-02 Mint & redeem** — settlement writes the outcome that `redeem` pays against;
  both share the vault and the payout-completeness invariant.
- External: the Pyth Solana Receiver on the target cluster (program ID is the same on
  devnet and mainnet — ARCHITECTURE.md ADR-004); per-ticker devnet feed ids.

## Unblocks (what waits on this)

- **F-06 Shared TS SDK** — needs the full instruction set (including settlement) and
  the Pyth price-update account model to wrap.
- **F-09 Integration & E2E** — the settle leg of the lifecycle.

## Acceptance criteria

- `settle_market` reads the closing price on-chain, rejects prices older than the
  configured staleness threshold and prices whose confidence band exceeds the
  configured threshold, rejects calls before 4:00 PM ET, and writes an immutable
  outcome: closing price ≥ strike → YesWins, else NoWins (ARCHITECTURE.md §7).
- The payout-completeness invariant (`Yes_payout + No_payout == $1.00`) holds for all
  prices, including the at-strike boundary (at-or-above → Yes wins).
- `outcome` and `settlement_price` cannot change once written (immutability).
- `admin_settle` is admin-only and rejected before its enforced time delay (e.g. ≥1h
  after close); it records the same immutable outcome.
- `settle_market` is idempotent (a second call on a settled market is a safe no-op)
  and, where feasible, callable permissionlessly after 4:00 PM ET (ARCHITECTURE.md
  ADR-005, §14 Q4).
- The devnet feed spike is completed and its result documented (which oracle path the
  devnet demo uses, and why).

## Testing requirements

- Unit tests: settlement at/above/below strike; at-strike boundary; stale-price
  rejected; wide-confidence rejected; valid-price accepted; pre-4PM rejected;
  immutability after settle; `admin_settle` time-delay enforced and admin-only;
  idempotent re-settle.
- Oracle validation tests should use representative Pyth price-update fixtures
  (including the exponent scaling) so units match the program's fixed-point scale.
- A devnet (or cloned-account) test that exercises a real price-update read for the
  spike. Run unit tests on a local validator.

## Manual setup required

- Run the devnet feed spike during US market hours (a human or scheduled run must
  hit a live session). Provide the per-ticker devnet feed ids and a funded devnet
  keypair to pay for posting price updates. Document the spike outcome.

## Implementation notes (filled in by the building agent)

> The agent implementing this feature records its implementation decisions and
> rationale here as it builds — chosen libraries/patterns within the architecture's
> constraints, trade-offs made, deviations from assumptions and why, and anything the
> next agent or the integrator needs to know. This section starts empty and is owned
> by the builder, not the planner. Cross-cutting discoveries that affect other
> features must also be propagated to ROADMAP.md or the architecture doc, not just
> left here.
