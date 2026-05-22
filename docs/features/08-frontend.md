# Feature: Frontend

**ID:** F-08 · **Roadmap piece:** F-08 · **Status:** In progress

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

## Implementation plan (approved)

Locked decisions (confirmed with the user before building):

- **Stack:** Next.js (App Router, TS) · `@solana/wallet-adapter-react` for
  connect/sign · Tailwind for the dark-fintech brand from the deck
  (`docs/meridian-deck.html`) · Vitest + React Testing Library for component/unit
  tests · Playwright for e2e.
- **Data sourcing:** discover markets via `getProgramAccounts`
  (`program.account.market.all()`, discriminator-filtered) over RPC; derive the
  displayed "live price" from the order-book mid/last (fallback to strike-implied
  $0.50 when the book is empty). **No Pyth deps in the browser bundle** — the SDK's
  Pyth helpers are lazy/optional and the UI never settles.
- **Test scope:** thorough component/unit tests in CI **plus** a Playwright e2e that
  boots against a **local `solana-test-validator`** with an **injected keypair
  signer** (no browser extension), exercising the golden path + the four trade paths.

Lives in a new workspace package `packages/web` (`@meridian/web`), sibling of
`packages/sdk`, depending on `@meridian/sdk` via the workspace. F-08 consumes only
the SDK — never hand-rolls serialization, never re-implements the four-button
mapping (it calls `buildTradeIntent`). Position constraint is **client-side only**
(ADR-006). Units: USDC base units (6 dp), `PAYOFF_UNIT = PRICE_SCALE = 1_000_000`,
no floats in serialized math.

Build chunks (test-first; each ends in a tickable item):

- [x] **1. Workspace scaffold + brand system** — `packages/web` Next.js App Router +
  TS, Tailwind with deck palette/fonts as tokens, `@meridian/sdk` workspace dep,
  Vitest+RTL+jsdom, root scripts, `Providers` (Connection/Wallet/WalletModal) with
  env RPC (`NEXT_PUBLIC_RPC_URL`/`NEXT_PUBLIC_USDC_MINT`), base layout + brand
  primitives. Smoke test passes.
- [x] **2. Chain data layer (hooks) + market discovery** — `src/lib`: `useProgram`,
  `useConfig`, `useMarkets` (gPA discovery grouped by ticker), `useMarket`,
  `useOrderBook` (→ `dualBook`), `useUserPositions`, `priceFromBook`. Pure helpers
  (`format.ts`/`market-math.ts`: price/mid, P&L, 4 PM ET countdown, formatting)
  unit-tested directly.
- [x] **3. Landing + Markets pages** — Landing: explainer (brand voice), live prices,
  connect CTA. Markets: 7 stocks with live price + active contract count. RTL tests
  against mocked hooks.
- [x] **4. Trade page — book (both perspectives) + strike list + payoff/countdown** —
  strike list; order book in both Yes and No perspectives (`dualBook`); implied No
  price ($1.00 − Yes); plain-language payoff line; 4 PM ET settlement countdown.
  Tests: mirror consistency (best Yes bid + best No ask = `PRICE_SCALE`), implied No,
  payoff text, countdown.
- [x] **5. Trade panel — four buttons + position constraint** — Buy/Sell Yes/No via
  `buildTradeIntent` (one tx, one approval); `makerAccounts` from the live book for
  marketable orders; client-side size/price validation; position-constraint guard
  (client-only). Tests: action→intent mapping (decoded legs), BUY_NO whole-token/cap
  rules, guard blocks Buy-Yes-while-holding-No.
- [x] **6. Portfolio + redeem flow** — active positions (entry vs current, P&L),
  settled outcomes via `payoutFor`, redeem button building+signing the SDK `redeem`
  ix (USDC to wallet). Entry price from a local trade store. Tests: P&L, payout
  display, redeem ix + post-redeem balance.
- [ ] **7. History page (trade execution log)** — log for the connected wallet from
  program events (`OrderMatched`/`OrderPlaced`/`PairMinted`/`Redeemed`) via the event
  coder over the user's signatures, cached client-side. Tests: parsed executions
  render in order; empty state.
- [ ] **8. Wallet connect + signing wiring** — connect/disconnect/account-change;
  all state-changing actions via wallet `sendTransaction`; brand-styled tx-status
  toasts. Tests: connected/disconnected gate; action triggers `sendTransaction` with
  SDK-built ixs (mocked adapter).
- [ ] **9. Playwright e2e vs local validator** — boot `solana-test-validator` with
  `target/deploy/meridian.so` + Pyth Receiver, seed Config+market+book via SDK
  builders, fund a generated keypair (SOL+USDC), run the app with an injected keypair
  adapter, drive a browser: connect → mint/Buy Yes → Buy No → Sell Yes → Sell No →
  (admin settle) → redeem. Gated for local + CI; if flaky in CI, stays runnable
  locally and is documented as the manual-verification path (honestly noted).
- [ ] **10. Adversarial review + triage** — independent subagent
  (robustness/efficiency/security); fix high/medium, re-run suite, record lows below.

## Implementation notes (filled in by the building agent)

> The agent implementing this feature records its implementation decisions and
> rationale here as it builds — chosen libraries/patterns within the architecture's
> constraints, trade-offs made, deviations from assumptions and why, and anything the
> next agent or the integrator needs to know. This section starts empty and is owned
> by the builder, not the planner. Cross-cutting discoveries that affect other
> features must also be propagated to ROADMAP.md or the architecture doc, not just
> left here.

### Chunk 1 — workspace scaffold + brand system

- **`packages/web` (`@meridian/web`)** is a new sibling workspace package, Next.js 14
  App Router + TS. It depends on `@meridian/sdk` via `workspace:^`.
- **SDK consumed as TypeScript source, not a prebuilt `dist`.** `@meridian/sdk`'s
  `dist` is gitignored and not built in this worktree, so `tsconfig.json` maps
  `@meridian/sdk` → `../sdk/src/index.ts` (and `/pyth` → `../sdk/src/pyth.ts`) and
  `next.config.mjs` lists it under `transpilePackages`. Next/SWC compiles the SDK
  source alongside the app — no separate SDK build step in the frontend's loop. Vitest
  mirrors the same aliases. (If F-09/F-10 prefer consuming the built package, point the
  alias at `dist` after a `yarn workspace @meridian/sdk build`; the import surface is
  identical.)
- **Brand contract = the pitch deck.** `tailwind.config.ts` encodes the deck's palette
  (`docs/meridian-deck.html` `:root`) as design tokens — ink/panel/line/fg, accent &
  `yes` mint `#4ff0a8`, `no` coral `#ff7a8a`, `usdc` blue `#5aa6ff`, amber — and its
  three families (Archivo sans / Fraunces serif / Space Mono mono). `globals.css`
  reproduces the deck's atmosphere glows and defines `.panel`/`.btn*` components. All UI
  uses these tokens; no raw hex in components.
- **Wallet stack:** `@solana/wallet-adapter-react` + `react-ui`. The static adapter
  list is **empty** — wallets register via the Wallet Standard, so Phantom/Solflare/
  Backpack appear without bundling per-wallet adapters. Dropped
  `@solana/wallet-adapter-wallets` deliberately: it transitively pulls heavy SDKs
  (Ledger → `@stellar/stellar-sdk`, `usb`, etc.) for wallets we don't need to hard-code.
  The e2e harness injects its own keypair adapter via `Providers`' `wallets` prop.
- **`Providers`** mounts `ConnectionProvider`/`WalletProvider`/`WalletModalProvider`
  with an env-driven endpoint; `WalletMultiButton` is loaded via `next/dynamic`
  (`ssr:false`) since it touches `window`. Config is `NEXT_PUBLIC_*` only (no secrets in
  the frontend); `.env.example` documents `NEXT_PUBLIC_RPC_URL`/`_USDC_MINT`/`_CLUSTER`.
- **Tests:** Vitest + RTL + jsdom, automatic JSX runtime (`esbuild.jsx: "automatic"`)
  so components need no `React` import. Chunk-1 proof: brand-primitive render tests pass,
  `tsc --noEmit` is clean, and `next build` produces an optimized production build
  (SSR-safe wallet provider, SDK transpiled).
- **Repo plumbing:** root `lint`/`lint:fix` globs widened to `.tsx`; `.gitignore` +
  `.prettierignore` updated for `.next`/Playwright artifacts. yarn `node_modules`
  linker (matches the SDK's choice for native addons).

### Chunk 2 — chain data layer + market discovery

- **Read/sign split.** `useProgram` builds the Anchor `Program` with a **read-only
  provider** (connection + a placeholder pubkey, no signer). The frontend holds no
  keys; we use the program only to *encode instructions* and *read/decode accounts*,
  and we send the built instructions through the wallet adapter's `sendTransaction`
  (chunk 8). This keeps the signing trust boundary in the wallet, matching the
  architecture (the frontend "holds nothing").
- **Market discovery via `getProgramAccounts`** (`discovery.ts`): there is no on-chain
  market index, so `discoverMarkets` calls Anchor's `program.account.market.all()`
  (discriminator-filtered, decoded), normalizes the enum fields, and sorts by
  ticker→strike→day. `groupByTicker`/`activeCount` back the Markets page's per-stock
  counts. Decode/sort/group are **pure** and unit-tested with a stubbed
  `account.market.all()`; the RPC itself is exercised by the e2e. This stays in
  `packages/web` (a frontend concern), **not** a cross-cutting SDK/contract change —
  if F-09 wants a shared discovery helper later, lift it into the SDK then.
- **Polling read hooks** (`useChain.ts`): a generic `usePolled` resource
  (`{data,loading,error,refresh}`) with a manual refresh + interval poll, then
  `useConfig`/`useMarkets`/`useMarket`/`useOrderBook`/`useUserPosition` on top. Books
  poll fast (5 s, the trading surface); discovery/config slow (30 s/60 s). `useUsdcMint`
  prefers on-chain `Config.usdcMint` and falls back to the env bootstrap so the UI can
  render before config resolves.
- **Pure helpers, all unit-tested:** `format.ts` (price→`$0.65`, price→`65%`
  probability, USDC/token/signed-USDC, short key — floats live *only* here),
  `market-math.ts` (`midPrice`/`priceFromBook` with the empty-book → strike-implied
  50/50 fallback, `impliedComplement`, `markValue`, `positionPnl`, `settledPayout`,
  `holdsBothSides`), `countdown.ts` (delta to the market's `trading_day`, which the
  program already stores as the 4 PM ET close *instant* — the frontend never
  reimplements an ET/DST calendar). A `dualbook.test` pins the SDK's dual-perspective
  contract the UI leans on (best Yes bid + best No ask = `PRICE_SCALE`, sizes
  preserved) so a regression in that projection trips here too.

### Chunk 3 — Landing + Markets pages

- **Presentational/wrapper split.** Each page is a thin `"use client"` wrapper that
  wires hooks to a pure presentational component (`LandingView`, `MarketsView`) taking
  data props. The views render identically in tests (RTL, no provider) and against
  live RPC; the connect-wallet control is *injected* into `LandingView` so it tests
  without the wallet context.
- **Markets** renders all 7 MAG7 tickers (always — even with no markets yet), each with
  its live Yes price + implied probability and its **active (open) contract count**,
  linking to `/trade/<SYMBOL>`. **Live prices** come from `useTickerPrices`, which reads
  **one representative open market per ticker** (the median strike — closest to a
  coin-flip, usually most liquid) and takes the book mid. That bounds the page to ~7
  book reads instead of one per strike; selection is pure and unit-tested.
- **Landing** states the pitch in the brand voice ("One book. Four actions. Two
  perspectives.", `Yes + No = $1.00`), a live-price strip, connect CTA, and three
  value props (non-custodial / four-buttons-one-book / settles-at-close).
- **Finding (build-time, affects every consumer incl. F-07/F-09) → `webpack.IgnorePlugin`.**
  The SDK barrel does `export * from "./pyth"`, and although the Pyth helpers
  *lazy-load* their optional peer deps (`await import("@pythnetwork/...")` at call
  time), a **bundler still statically resolves** those dynamic specifiers and their
  transitive deps (`axios`, `rpc-websockets`) at build time — which aren't installed
  (they're optional). The frontend never settles, so it never calls them; `next.config`
  adds an `IgnorePlugin` for `@pythnetwork/hermes-client` + `@pythnetwork/pyth-solana-receiver`
  so the production build doesn't try to resolve genuinely-absent, never-executed
  modules. (Runtime is already safe via the SDK's `.catch()`; this is purely the
  bundler's resolution graph.) Any other bundler-based consumer of `@meridian/sdk` that
  doesn't settle will hit the same and needs the same ignore — noted for F-09/F-10.

### Chunk 4 — Trade page (book both perspectives, strikes, payoff, countdown)

- **`/trade/[symbol]`** is the trading surface. It resolves the symbol → `Ticker`
  (`symbolToTicker`, with an unknown-symbol guard), lists that ticker's strikes from
  discovery, and defaults the selection to the first *open* strike. Selecting a strike
  drives the market + book reads.
- **`DualBookView` renders both perspectives** of the one book from the SDK's
  `dualBook` — `OrderBookView` for Yes and for No, asks-over-bids, best-price-first. The
  No side is the SDK's `1 − price` mirror; the UI never re-derives it. A component test
  asserts the mirror (Yes bid $0.60 → No ask $0.40; Yes ask $0.70 → No bid $0.30).
- **`PayoffLine`** shows the plain-language question ("Will META close at or above
  $680.00 today? …") and both the Yes price and the **implied No price** ($1.00 − Yes)
  with implied probabilities — translating the mechanics so the user never reasons about
  token math.
- **`Countdown`** ticks every second to the market's `trading_day`, which the program
  already stores as the **4:00 PM ET close instant** (a unix timestamp) — so the
  frontend just renders the delta and shows "Closed" past it; it never reimplements an
  ET/DST calendar (that conversion is the automation service's concern).
- Live Yes price for the selected strike is the book mid via `priceFromBook` (50/50
  fallback on an empty book). The trade *panel* (chunk 5) slots into the marked spot.

### Chunk 5 — trade panel (four buttons + position constraint)

- **The mapping lives only in the SDK.** `TradePanel` collects an action + price (in the
  action's own perspective) + size, and routes every action through the SDK's
  `buildTradeIntent` into one transaction (one wallet approval). It never re-implements
  Buy-No = mint+sell-Yes etc. A contract test mocks `buildTradeIntent` and asserts each
  of the four buttons calls it with the correct `TradeAction`, price (No price passed
  as-is for No actions — the SDK reflects it), and size.
- **Maker accounts for marketable orders** (`crossing.ts`): the intent layer is
  book-agnostic, so the panel computes the resting makers an order will cross from the
  *live raw book* in the **Yes-book frame** (`tradeForm.yesSideFor`/`yesPriceFor` mirror
  which Yes side/price the action lands on — mirroring *which side*, not re-deriving the
  instructions). A Yes bid crossing asks lists each maker's **USDC** ATA (they receive
  USDC); a Yes ask crossing bids lists makers' **Yes** ATAs — in best-price-then-seq
  order, only as many as fill the size. Passed to `buildTradeIntent` as `makerAccounts`.
- **Client-side validation** (`tradeForm.validateTradeForm`) mirrors the program/SDK
  preconditions (size > 0, limit price in range, BUY_NO whole-token + `MAX_BUY_NO_MINT_PAIRS`
  cap) so the user sees the problem before a round-trip.
- **Position-constraint guard** (`positionGuard.ts`, ADR-006, **client-side only**):
  blocks Buy-Yes-while-holding-No (and Buy-No-while-holding-Yes), points to the exit
  action, and disables submit. It explicitly does *not* claim to be a fund-safety
  control — the program permits both-sides (the Buy-No mint transiently holds both); this
  is purely a UX guardrail. Selling either side is always allowed; an unknown (not-loaded)
  position never blocks.
- **Send path** (`useSendIx`): builds one `Transaction`, sets a fresh blockhash + the
  wallet as fee payer, signs/sends via the wallet adapter's `sendTransaction`
  (signing-here, no keys held), and tracks signing→confirming→success/error;
  `TxStatusBanner` surfaces it. After a confirmed trade the page refreshes book + balances.
- **Finding (test env, affects all chain-logic tests + the e2e):** under **jsdom**,
  `getAssociatedTokenAddressSync`'s on-curve check throws "Unable to find a viable
  program address nonce" — jsdom lacks the crypto/curve primitive Node/the real browser
  provides. Pure chain-logic tests that derive ATAs (`crossing.test.ts`) run with
  `// @vitest-environment node`; component tests that don't derive ATAs stay on jsdom.
  The real browser is unaffected (the e2e uses a real Chromium).

### Chunk 6 — Portfolio + redeem flow

- **Cost basis is local + display-only** (`tradeStore.ts`). The chain records no per-user
  entry price, so to show P&L the app remembers the user's own fills in `localStorage`
  (size-weighted average per wallet+market+side) and the trade page records a fill after
  each confirmed trade (`recordTradeFill` maps action→acquired side+price: BUY_YES/SELL_NO
  → Yes; BUY_NO → No; SELL_YES is an exit, not recorded). This never affects the program
  or settlement — a cleared store just means P&L shows "—". The aggregation + the
  action→record mapping are pure and unit-tested.
- **Portfolio assembly is pure** (`portfolio.ts`): `buildPortfolio(holdings, basis)` folds
  holdings + marks + basis into rows. **Open** rows mark a Yes holding at the book mid and
  a No holding at `1 − mid`, and show entry/mark/P&L (P&L null when no basis). **Settled**
  rows use the on-chain outcome via `settledPayout` (winner 1:1, loser $0) and expose a
  redeem button only for redeemable winners. `usePortfolio` gathers holdings across all
  discovered markets the wallet touches.
- **Redeem** builds the SDK `redeem` instruction (Yes/No side, full held amount) and sends
  it through the wallet (`useSendIx`); on confirm it refreshes so the now-redeemed balance
  (USDC in wallet) reflects. `PortfolioView` is presentational and RTL-tested (P&L
  display, redeem fires, loser shows "Lost").
