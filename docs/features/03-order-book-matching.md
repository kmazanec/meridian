# Feature: Order Book & Matching

**ID:** F-03 · **Roadmap piece:** F-03 · **Status:** Not started

## Description

This delivers the on-chain Central Limit Order Book (CLOB) for trading Yes tokens
against USDC: `place_order` (limit and market), `cancel_order`, and `match_orders`
(execute crossing bids/asks by price-time priority and settle the token + USDC
transfers atomically). It implements the bounded on-chain book described in
ARCHITECTURE.md §4.3 and ADR-002b.

It exists because the order book is the trading venue — the place where price
discovery and matching happen — and it is the most technically ambitious part of the
program (the brief explicitly rewards building it). One book per strike serves all
four user actions by perspective (ARCHITECTURE.md §6).

## How it fits the roadmap

Wave 1, parallel with F-02 and F-05. It is off the single longest critical path but
is required for F-09 integration (the trade leg and all four trade paths). Treat it
as the second-highest-risk component after the oracle.

## Dependencies (must exist before this starts)

- **F-01 Program scaffold & accounts** — needs `OrderBook`, `Order`, the price/size
  fixed-point scale, and the market PDA conventions.

## Unblocks (what waits on this)

- **F-09 Integration & E2E** — the trading leg; all four trade paths (Buy/Sell
  Yes/No) execute against this book.

## Acceptance criteria

- `place_order` posts a resting limit order or executes a market order against the
  opposite side; orders carry owner, price (USDC-per-Yes in `[0, 1.00]` at the fixed
  scale), size, and a monotonic sequence number for time priority.
- `match_orders` crosses bids and asks strictly by price-time priority and settles
  the corresponding Yes-token and USDC transfers atomically; partial fills are
  handled correctly (remaining size stays resting; filled size is removed).
- `cancel_order` removes only the caller's own resting order and returns any escrowed
  funds/tokens.
- The book respects its bounded capacity `N` gracefully (a clear, deterministic
  outcome when full — e.g. reject or evict per a documented rule), never corrupting
  state or exceeding account space.
- Matching is trustless: the cranker (taker or automation) cannot alter prices or
  sizes; it only triggers execution (ARCHITECTURE.md §5 note).
- Trading is rejected when the program is paused or the market is settled.
- No on-chain prohibition is added on a user holding both Yes and No (that guardrail
  is client-side only — ROADMAP.md cross-cutting concern #6).

## Testing requirements

- Unit tests: limit post + rest; market order full fill; partial fills across
  multiple price levels; price-time priority ordering (including ties broken by
  sequence); cancel returns escrow; book-full behavior; matching cannot be made to
  alter price/size; no trading when paused/settled.
- Edge cases named in the architecture: rounding at the fixed scale, partial fills,
  ordering. Property/fuzz-style coverage of matching is encouraged.
- Run on a local validator via the Anchor test harness.

## Manual setup required

None.

## Implementation notes (filled in by the building agent)

> The agent implementing this feature records its implementation decisions and
> rationale here as it builds — chosen libraries/patterns within the architecture's
> constraints, trade-offs made, deviations from assumptions and why, and anything the
> next agent or the integrator needs to know. This section starts empty and is owned
> by the builder, not the planner. Cross-cutting discoveries that affect other
> features must also be propagated to ROADMAP.md or the architecture doc, not just
> left here.
