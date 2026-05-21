# Feature: Market Creation & Admin

**ID:** F-05 · **Roadmap piece:** F-05 · **Status:** Not started

## Description

This delivers market provisioning and admin controls: `create_strike_market` (create
one stock-strike-day market — its Yes/No mints, the PDA vault, and the order book
account), `add_strike` (add an extra strike intraday), and `pause`/`unpause`
(emergency stop on minting and trading). It also covers the on-chain pieces of the
strike-creation contract that the automation service depends on.

It exists because every tradable market must be instantiated before users can mint
or trade, and the admin authority needs a safety switch. Market creation is *not*
batched — one call per strike (ARCHITECTURE.md §5).

## How it fits the roadmap

Wave 1, parallel with F-02 and F-03. Off the single longest critical path, but it is
a prerequisite for the SDK (F-06) because the SDK must build create/admin
instructions, and for integration (F-09).

## Dependencies (must exist before this starts)

- **F-01 Program scaffold & accounts** — needs `Config`, `Market`, and all PDA seeds
  to provision the per-market accounts.

## Unblocks (what waits on this)

- **F-06 Shared TS SDK** — wraps `create_strike_market`, `add_strike`, `pause`/`unpause`.
- **F-09 Integration & E2E** — the create leg of the lifecycle.

## Acceptance criteria

- `create_strike_market` provisions, for one ticker + strike + trading day: the Yes
  mint, the No mint (both with the program PDA as mint authority), the PDA USDC
  vault, and the `OrderBook` account; the resulting `Market` is in the `Open` state.
- Creating the same ticker/strike/day twice is rejected (idempotent provisioning).
- `add_strike` creates an additional market for an existing ticker/day under admin
  authority.
- `pause` blocks `mint_pair` and trading; `unpause` restores them; both are
  admin-only.
- All create/admin instructions enforce the admin authority from `Config`.
- The strike values supplied conform to the documented strike algorithm
  (±3/6/9% of previous close, rounded to $10, deduplicated); the on-chain side
  accepts admin-provided strikes (the calculation itself lives in the automation
  service, F-07).

## Testing requirements

- Unit tests: create happy path (all accounts provisioned, `Open` state); duplicate
  create rejected; `add_strike` happy path; pause blocks mint + trade; unpause
  restores; non-admin calls rejected for all admin instructions.
- Verify provisioned mints/vault are PDA-owned with no external authority.
- Run on a local validator via the Anchor test harness.

## Manual setup required

None (the admin keypair for tests is generated locally).

## Implementation notes (filled in by the building agent)

> The agent implementing this feature records its implementation decisions and
> rationale here as it builds — chosen libraries/patterns within the architecture's
> constraints, trade-offs made, deviations from assumptions and why, and anything the
> next agent or the integrator needs to know. This section starts empty and is owned
> by the builder, not the planner. Cross-cutting discoveries that affect other
> features must also be propagated to ROADMAP.md or the architecture doc, not just
> left here.
