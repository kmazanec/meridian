# Feature: Shared TypeScript SDK

**ID:** F-06 · **Roadmap piece:** F-06 · **Status:** Not started

## Description

This delivers a shared TypeScript client library that both the automation service and
the frontend depend on. It wraps the program's IDL with typed instruction builders,
derives all PDAs from the frozen seed conventions, provides Pyth/Hermes helpers
(fetch a signed price update and post it on-chain via the Receiver), and implements
the "four buttons → one book" intent translation in one place (Buy No = mint_pair +
sell Yes; Sell No = buy Yes — ARCHITECTURE.md §6, §8.2).

It exists to prevent two downstream features (automation, frontend) from
independently hand-rolling chain-calling code and the trade-intent translation, which
would drift apart. The SDK is the single client interface to the program.

## How it fits the roadmap

Wave 3, on the critical path (F-04 → F-06 → F-08 → …) and the convergence funnel for
the off-chain world: both F-07 and F-08 wait on it. Its instruction-builder and
PDA-derivation surface should be treated as a frozen contract before F-09.

## Dependencies (must exist before this starts)

- **F-04 Settlement & oracle** — needs the complete instruction set (incl.
  settlement) and the Pyth price-update account model to wrap.
- **F-05 Market creation & admin** — needs the create/admin instructions to wrap.
- (Transitively requires F-01–F-03 via the compiled IDL.)

## Unblocks (what waits on this)

- **F-07 Automation service** — uses instruction builders (create/settle) and Pyth
  helpers to drive the AM/PM jobs.
- **F-08 Frontend** — uses instruction builders, PDA helpers, and the four-button
  translation to render trading and sign transactions.
- **F-09 Integration & E2E** — drives the lifecycle through the SDK.

## Acceptance criteria

- Every program instruction has a typed builder that produces a valid transaction
  against the deployed program (built from the IDL, not hand-rolled serialization).
- Every PDA (vault, mint authority, `Market`, `OrderBook`) can be derived from inputs
  using the exact seeds frozen in F-01.
- A Pyth helper fetches a fresh signed price update from Hermes and posts it via the
  Pyth Solana Receiver, returning the price-update account usable by `settle_market`.
- The four-button intent translation is exposed as a single API (Buy/Sell Yes/No →
  the correct on-chain action(s)), so consumers never re-implement it.
- Reading helpers expose order-book state in both perspectives (Yes and No) from the
  one underlying book, and current positions/balances.
- The library is consumable by both a Node.js service and a browser/React app.

## Testing requirements

- Unit/contract tests: each instruction builder produces a transaction that succeeds
  against a local validator; PDA derivations match on-chain expectations; the
  four-button translation maps each action to the correct instruction(s); the Pyth
  helper posts and yields a readable price update (against a local validator with a
  cloned/fixture Pyth account, or devnet).
- Tests must lock the SDK surface as the interface F-07/F-08 rely on.

## Manual setup required

- An RPC endpoint for the target cluster and (for the Pyth helper integration test) a
  funded keypair to post price updates on devnet.

## Implementation notes (filled in by the building agent)

> The agent implementing this feature records its implementation decisions and
> rationale here as it builds — chosen libraries/patterns within the architecture's
> constraints, trade-offs made, deviations from assumptions and why, and anything the
> next agent or the integrator needs to know. This section starts empty and is owned
> by the builder, not the planner. Cross-cutting discoveries that affect other
> features must also be propagated to ROADMAP.md or the architecture doc, not just
> left here.
