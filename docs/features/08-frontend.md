# Feature: Frontend

**ID:** F-08 · **Roadmap piece:** F-08 · **Status:** Not started

## Description

This delivers the Next.js (React + TypeScript) web application: the Landing, Markets,
Trade, Portfolio, and History pages; wallet connection and transaction signing; the
order-book display in both Yes and No perspectives of the single underlying book; the
position-aware trade panel with Buy Yes / Buy No / Sell Yes / Sell No; settlement
display and the redeem flow; and portfolio P&L.

It exists to give users the simple "four buttons, one book" experience while hiding
the underlying mechanics (Buy No is really mint-and-sell-Yes). It enforces the
client-side position constraint (a user should not persistently hold both Yes and No
for a strike — ARCHITECTURE.md ADR-006).

## How it fits the roadmap

Wave 4, the final pre-integration link on the critical path (F-06 → F-08 → F-09),
chosen as the last link because the demo and most acceptance criteria are observed
through the UI. Runs in parallel with the automation service (F-07).

## Dependencies (must exist before this starts)

- **F-06 Shared TS SDK** — uses instruction builders, PDA helpers, order-book read
  helpers, and the four-button intent translation; does not re-implement them.
- External: a wallet (e.g. Phantom) for manual testing; an RPC endpoint.

## Unblocks (what waits on this)

- **F-09 Integration & E2E** — the user-facing lifecycle and the four-trade-path
  acceptance are exercised through the UI.

## Acceptance criteria

- **Landing** explains the product, shows live prices, and offers connect-wallet.
- **Markets** shows the 7 stocks with live prices and active contract counts.
- **Trade** shows the strike list for a stock, the order book in both perspectives of
  the one book, and a Buy Yes / Buy No / Sell Yes / Sell No panel; the implied No
  price ($1.00 − Yes) and a plain-language payoff line are displayed; a settlement
  countdown to 4:00 PM ET is shown.
- The trade panel enforces the position constraint: if the user holds No for a strike,
  it guides them to exit before buying Yes (and vice versa) — client-side only.
- **Portfolio** shows active positions, entry vs current price, P&L, settled
  outcomes, and a redeem button for settled contracts that completes the redeem flow
  with USDC arriving in the wallet.
- **History** shows a trade execution log.
- Wallet connect, order placement, and transaction signing work end-to-end; each
  user-facing action maps (via the SDK) to the correct on-chain action(s).

## Testing requirements

- Frontend tests: wallet connection flow; order placement + signing; real-time price
  display; order-book rendering and updates in both perspectives; position-constraint
  enforcement (cannot hold both Yes and No from trading); portfolio/P&L accuracy;
  settlement display and redeem flow.
- Because feature correctness is observed in the browser, the build must be exercised
  in a browser against a running program (local validator or devnet) for the golden
  path and the four trade paths — not only unit tests.

## Manual setup required

- A browser wallet extension funded with devnet SOL + test USDC for manual testing;
  an RPC endpoint configured via env. Human verification of the UI flows in a browser.

## Implementation notes (filled in by the building agent)

> The agent implementing this feature records its implementation decisions and
> rationale here as it builds — chosen libraries/patterns within the architecture's
> constraints, trade-offs made, deviations from assumptions and why, and anything the
> next agent or the integrator needs to know. This section starts empty and is owned
> by the builder, not the planner. Cross-cutting discoveries that affect other
> features must also be propagated to ROADMAP.md or the architecture doc, not just
> left here.
