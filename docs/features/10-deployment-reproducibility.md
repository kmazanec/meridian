# Feature: Deployment & Reproducibility

**ID:** F-10 · **Roadmap piece:** F-10 · **Status:** Not started

## Description

This delivers the deployment and reproducibility layer: a one-command setup
(`make dev` or equivalent), reproducible scripts to deploy the program, create
markets, and run the full lifecycle end-to-end on Solana devnet, a `.env.example`
documenting all required secrets, and a README explaining setup and the demo.

It exists because the brief requires a reproducible devnet deployment with
one-command setup and a demonstrable create → mint → trade → settle → redeem flow.
This feature turns the verified system (F-09) into something a reviewer can run.

## How it fits the roadmap

Wave 5, the final link on the critical path after integration (F-09 → F-10).

## Dependencies (must exist before this starts)

- **F-09 Integration & E2E** — packages the verified lifecycle into reproducible
  scripts; depends on the integrated stack working.

## Unblocks (what waits on this)

- None — this is the terminal deliverable for the core submission. (Bonus mainnet-beta
  deployment, if pursued, would follow from here.)

## Acceptance criteria

- A single command brings up the local stack for development (`make dev` or
  equivalent), documented in the README.
- Reproducible scripts/commands deploy the program to devnet, create the day's
  markets, and run the full lifecycle (create → mint → trade → settle → redeem)
  end-to-end on devnet.
- `.env.example` lists every required environment variable (RPC endpoint, keypairs,
  oracle feed ids, alert channel, etc.) with safe placeholder values; no real secrets
  are committed.
- Tests run locally and validate all key invariants (per ARCHITECTURE.md §12).
- The README documents prerequisites, one-command setup, the demo steps, and a short
  risks/limitations note (no regulatory or compliance claims).

## Testing requirements

- A clean-checkout dry run: from a fresh clone with `.env` filled from `.env.example`,
  the one-command setup and the lifecycle scripts complete successfully on
  devnet/local validator.
- The deploy + lifecycle scripts are themselves exercised in CI or a documented manual
  run so reproducibility is verified, not assumed.

## Manual setup required

- A funded devnet deployer keypair and the automation keypair; an RPC endpoint; the
  per-ticker devnet oracle feed ids; any alert-channel credential. All provided via
  env per `.env.example`. (Bonus: a funded mainnet-beta setup if the mainnet
  deployment is attempted — not required for the core submission.)

## Implementation notes (filled in by the building agent)

> The agent implementing this feature records its implementation decisions and
> rationale here as it builds — chosen libraries/patterns within the architecture's
> constraints, trade-offs made, deviations from assumptions and why, and anything the
> next agent or the integrator needs to know. This section starts empty and is owned
> by the builder, not the planner. Cross-cutting discoveries that affect other
> features must also be propagated to ROADMAP.md or the architecture doc, not just
> left here.
