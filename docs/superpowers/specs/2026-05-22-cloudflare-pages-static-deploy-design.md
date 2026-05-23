# Design: Cloudflare Pages static deploy (devnet)

**Date:** 2026-05-22 · **Status:** approved · **Scope:** deploy the Meridian frontend to
Cloudflare Pages as a static SPA pointed at Solana devnet.

## Context

The web app (`packages/web`) is a fully client-side Next.js 14 app (`"use client"`
throughout, no API routes / SSR / server actions). It reads chain state directly via the
Solana RPC and derives the program id from the SDK's compiled IDL — so it has no server
runtime needs and can ship as static files to a CDN. Devnet is the "production" chain
(no real funds). See [[deployment-hosting-decisions]].

## Decisions

- **Static export** (`output: 'export'`) over the `@cloudflare/next-on-pages` edge adapter.
  The app has no server code, so the adapter's runtime + build deps are unnecessary weight.
- **Custom not-found page** for unknown symbol URLs (vs. a bare CDN 404).

## Changes

### 1. `packages/web/next.config.mjs`
Add `output: 'export'`. Keep existing `transpilePackages: ["@meridian/sdk"]` and the webpack
fallbacks / `IgnorePlugin` (still required). No `images: { unoptimized: true }` needed —
the app uses no `next/image` (verified).

### 2. `/trade/[symbol]` route split (static export needs `generateStaticParams`)
`generateStaticParams` cannot live in a `"use client"` file. Split:
- **`page.tsx`** (new server component): exports `generateStaticParams()` returning the 7
  symbols from the SDK's `TICKER_SYMBOLS`; renders the client component.
- **`TradePageClient.tsx`**: the existing client component, moved verbatim (logic unchanged).

Only the 7 valid ticker pages are pre-rendered (`/trade/AAPL` … `/trade/TSLA`).

### 3. `packages/web/src/app/not-found.tsx` (new)
Branded "market not found" page (uses existing UI components) with a link back to `/markets`.
Covers typo'd symbol URLs that the CDN serves as 404 before the component runs.

### 4. Cloudflare Pages config
- **Build:** `yarn workspace @meridian/sdk build && yarn workspace @meridian/web build`
  (SDK builds first; web consumes it).
- **Output dir:** `packages/web/out` (static-export default; already gitignored).
- **Env (Pages dashboard / wrangler):**
  `NEXT_PUBLIC_RPC_URL=https://api.devnet.solana.com`,
  `NEXT_PUBLIC_USDC_MINT=<devnet mint from bootstrap manifest>`,
  `NEXT_PUBLIC_CLUSTER=devnet`. Program id needs no env var (compiled from the IDL).
- **Deploy:** `wrangler pages deploy packages/web/out`. `wrangler login` is interactive
  (browser auth) and is run by the user via `!`.

## Verification

- `yarn workspace @meridian/web build` produces `out/` cleanly.
- The existing 107 web tests still pass after the route split.
- `out/` contains `trade/AAPL/index.html` … `trade/TSLA/index.html` and `404.html`.

## Open dependency

The devnet **USDC mint** comes from the user's `make bootstrap-devnet` (deploy manifest).
Everything except that final env var + `wrangler login`/deploy is done up front; the mint is
slotted in when the devnet deploy lands.
