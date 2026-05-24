# Admin Market-Wide Trader Leaderboard + Drilldown — Design

**Date:** 2026-05-23
**Status:** Approved (pending spec review)
**Surface:** `packages/web` — the operator admin console (`/admin`)

## Problem & context

We have a demo-only bot performance report (`scripts/bot-results.mjs`, wired into
`make settle-due`) that ranks our 8 named trading bots by end-of-day worth. That report
relies on knowing the bot wallets (from `bots.config.json` + local keypairs) and their
starting capital ($1000 each) — neither is available in a browser, and neither generalizes
to production.

Production wants a different thing: an **admin observability view of the entire market** —
every meaningful trader, not just our demo bots — that the on-chain Config admin can open
from the dashboard. This is the production counterpart to the demo artifact. The two are
deliberately separate: the demo report is a Makefile/script concern; this is a web feature.

## Decisions (locked during brainstorming)

1. **Holder discovery:** top-N holders per market via `getTokenLargestAccounts`
   (one cheap call per mint, ~top 20). Avoids `getProgramAccounts`-by-mint scans, which are
   rate-limited on public devnet. Tradeoff: long-tail/dust holders are excluded (footnoted).
2. **Ranking metric:** **current net worth** per wallet — `wallet USDC + outcome-token value
   + escrowed order collateral`. No PnL column: an arbitrary wallet's starting capital is
   unknown, so "PnL vs start" is not honestly computable. We rank by "who holds the most
   value right now."
3. **Panel scope:** leaderboard **+ per-market drilldown** (click a market → its holders and
   book depth).
4. **Compute site:** **client-side, lazy** — computed in the browser only when the admin
   opens the panel / expands a market. NOT added to the always-on `ChainDataProvider` poll
   (that would run heavy RPC for every visitor on every page and risks the devnet rate limit).
5. **Approach A:** self-contained admin lib + lazy hook + new components mounted in
   `AdminView`, following existing patterns (pure-math-in-lib, RPC-in-hook, render-in-component).
6. **Module split:** pure accounting (`leaderboard.ts`) separate from impure RPC discovery
   (`leaderboardData.ts`), so the accounting core is unit-testable without a connection.

## Architecture

Four units, mirroring the existing `market-math` → `portfolio` → hook → component layering.

### 1. `lib/leaderboard.ts` — pure, unit-tested (no RPC, no React)

The accounting core. Folds already-fetched inputs into ranked rows.

- `valueOfHolding(market, side, amount): BN`
  - settled market → `settledPayout` (reuse `market-math.ts`)
  - open market → mark-to-market via the yes-mark (reuse `market-math` `midPrice`/`sideMark`)
  - open market with no derivable mark → **unpriceable**: excluded from net, flagged (never
    silently valued)
- `foldLeaderboard(inputs): LeaderboardRow[]` sorted by `net` desc, where
  `LeaderboardRow = { owner, usdc, tokenValue, escrowValue, net, openOrders, positions[],
  unpriceableCount }`.
  - Escrow attribution reuses the exact logic from `scripts/bot-results.mjs`:
    - resting **bid** → escrowed USDC = `ceil(price * size / PRICE_SCALE)`
    - resting **ask** → escrowed YES tokens valued by the market's settled payout (or mark if
      open; unpriceable → flagged)
  - Owners appearing in multiple markets fold into one row (keyed by owner base58).
- `foldMarketDrilldown(market, holders, orders, mark): MarketDrilldownView` — holders +
  book depth for one market.

**Known seam:** the escrow/payout math is duplicated between `scripts/bot-results.mjs` and
`leaderboard.ts`. Accepted for now (script is Node/ops, web is browser/TS); a shared
`@meridian/sdk` helper is a future extraction, not in scope here.

### 2. `lib/leaderboardData.ts` — RPC discovery (no React)

The impure half, kept separate so the core stays testable.

- `marketMints(program, markets): Map<marketAddr, {yesMint, noMint, vault}>` — `DiscoveredMarket`
  lacks the mints, so fetch per market (via `fetchMarket`). (Possible optimization: extend
  `discovery.ts` to carry mints; out of scope unless trivial.)
- `topHolders(connection, mint): {owner, amount}[]` — `getTokenLargestAccounts(mint)` →
  `getMultipleAccountsInfo` to resolve each token-account address to its `.owner` + amount.
  (Note: `getTokenLargestAccounts` returns token *accounts*, not owners — owner resolution is
  the required second step.)
- `ownerUsdcBalances(connection, owners, usdcMint): Map<owner, BN>` — batched USDC ATA reads.

### 3. `lib/useLeaderboard.ts` — hooks

- `useLeaderboard(enabled)`: pulls `markets` + `allBooks` from `useChainData` (free, already
  polled); when `enabled` (panel open), lazily calls the discovery module, folds via the pure
  core, returns `AsyncResource<LeaderboardRow[]>`.
- `useMarketDrilldown(marketAddr | null)`: fires only when a market is expanded.

### 4. Components

- `components/admin/LeaderboardPanel.tsx` — the ranked net-worth table.
- `components/admin/MarketDrilldown.tsx` — per-market holders + book depth (expand-on-click).
- Mounted in `AdminView` as new admin-gated `Panel`s, alongside Pause/Settle/AddStrike.

## Data flow

1. Admin opens the leaderboard panel.
2. Hook reads cached `markets` + `allBooks` from context (no new RPC for these).
3. Discovery resolves: market mints → top holders per mint → token-account owners →
   owner USDC balances.
4. Pure fold → ranked `LeaderboardRow[]` → table.
5. Admin expands a market → `useMarketDrilldown` → that market's holders + book → render.

## Error handling & edge cases

- **`getTokenLargestAccounts` / RPC failure** → surfaced as `AsyncResource` error; panel shows
  retry; does not crash `AdminView`.
- **Open market with no book/mark** → position is **unpriceable**: excluded from net, surfaced
  via `unpriceableCount` + a footnote (never silently valued).
- **Top-20 truncation** → footnote: "top 20 holders/side per market; long-tail excluded."
- **Token-account owner resolution missing/closed** → skip that holder.
- **Duplicate owners across markets** → folded into one row.

## Testing

- `leaderboard.test.ts` (pure, like `market-math.test.ts`): net-worth folding; escrow
  attribution (bid ceil + ask payout); open vs settled valuation; owner dedup; unpriceable-open
  edge. No RPC.
- `leaderboardData` discovery: mocked-connection tests for holder→owner resolution shape
  (mirroring `ChainDataProvider.test.tsx`).
- `LeaderboardPanel` smoke test for admin-gating (like `AdminView.test.tsx`).

## Labeling

Rows are raw wallet pubkeys (truncated base58) — no names. This is the production view, so
there is no bot roster. (A future enhancement could optionally label known wallets, e.g. the
on-chain Config admin as "admin", but that is not in this build.)

## Out of scope

- PnL/realized-flow columns (no starting-capital baseline on-chain).
- Server-side `/api/` endpoint (client-side chosen; revisit only if client RPC gets too heavy).
- Sharing escrow math as an SDK package (known seam, future extraction).
- Full exhaustive holder enumeration (top-N chosen deliberately).
- Any change to the demo bot report or `settleDue()`.

## Non-functional notes

- Lazy: zero added cost to non-admin visitors and to other pages.
- Reuses the global `markets`/`allBooks` polls for the free inputs; only holder discovery is
  new RPC, and only while an admin has the panel open.
