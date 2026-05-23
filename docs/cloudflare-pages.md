# Deploying the Meridian frontend to Cloudflare Pages

The frontend is a fully client-side Next.js app (`output: 'export'`) — it talks straight to a
Solana RPC and holds no secrets. So it ships as plain static files to Cloudflare Pages' CDN.
We run it against **Solana devnet** as the "production" chain (no real funds).

## What gets configured

| Setting | Value |
|---|---|
| Build command | `yarn workspace @meridian/sdk build && yarn workspace @meridian/web build` |
| Build output dir | `packages/web/out` |
| Root directory | repo root (the build needs the workspace to resolve `@meridian/sdk`) |

The SDK builds first because the web app consumes it. The 7 per-stock trade pages
(`/trade/AAPL` … `/trade/TSLA`) are pre-rendered at build time via `generateStaticParams`;
any other `/trade/<x>` URL falls through to the branded not-found page.

## Build-time environment variables

These are `NEXT_PUBLIC_*` so they're baked into the static bundle **at build time** (set them
in the Pages project: *Settings → Environment variables → Production*, or inline before a CLI
build). The frontend holds no secrets.

| Var | Value (devnet) | Notes |
|---|---|---|
| `NEXT_PUBLIC_RPC_URL` | `https://api.devnet.solana.com` | the cluster the app reads/writes |
| `NEXT_PUBLIC_USDC_MINT` | *(devnet USDC mint from the deploy manifest)* | from `make bootstrap-devnet` |
| `NEXT_PUBLIC_CLUSTER` | `devnet` | header label; gates the localnet dev-wallet off |

> **Never set `NEXT_PUBLIC_LOCAL_WALLET_SECRET` here.** It is a localnet-only signing
> backdoor; the production build throws if it is present. It lives only in a local,
> gitignored `packages/web/.env.local`.

The **program id needs no env var** — the SDK derives it from the compiled IDL
(`MERIDIAN_IDL.address`), so the same value is used everywhere automatically.

## Deploy (CLI)

```bash
# one-time: authenticate (opens a browser)
npx wrangler login

# build the static site against devnet
NEXT_PUBLIC_RPC_URL=https://api.devnet.solana.com \
NEXT_PUBLIC_USDC_MINT=<devnet-usdc-mint> \
NEXT_PUBLIC_CLUSTER=devnet \
  yarn workspace @meridian/sdk build && \
  yarn workspace @meridian/web build

# publish — run FROM packages/web so wrangler bundles both `out/` and `functions/`
cd packages/web && npx wrangler pages deploy --project-name meridian
```

> **Run the deploy from `packages/web/`.** The repo now ships one Pages Function
> (`packages/web/functions/api/history.ts`, a server-side proxy for stock-close history —
> see "Price-history function" below). Wrangler auto-detects a `functions/` directory that
> is a sibling of the build output dir, so the deploy must run from `packages/web` (where
> `wrangler.toml` sets `pages_build_output_dir = "out"`). Deploying `packages/web/out` from
> the repo root would ship the static site **without** the function.

Or connect the GitHub repo in the Pages dashboard with the build command + output dir above
for push-to-deploy.

## Price-history function

`functions/api/history.ts` is a Cloudflare Pages Function serving
`GET /api/history?symbol=NVDA` → `[{ "date": "YYYY-MM-DD", "close": 123.45 }]` (last ~30
daily closes). It proxies a public market-data source server-side because that source
sends no CORS headers, so the browser can't call it directly. The static export is
unaffected — the function rides along in the same deploy.

- **Quick check:** `cd packages/web && yarn build && npx wrangler pages dev out`, then open
  `http://localhost:8788/api/history?symbol=NVDA`. This serves the real static build + the
  function together (no hot-reload).

- **`next dev` hot-reload with real history (recommended for development).** `next dev` has
  no Cloudflare runtime, so `/api/history` would 404 on its own. `next.config.mjs` therefore
  **proxies `/api/*` to a local `wrangler pages dev` instance in the dev phase only** (the
  production static export is unchanged — rewrites can't coexist with `output: export`, so
  they're added only under `PHASE_DEVELOPMENT_SERVER`). Run two terminals:

  ```bash
  # Terminal 1 — serve the function (rebuild once; out/ only needs to exist)
  cd packages/web && yarn build && npx wrangler pages dev out --port 8788

  # Terminal 2 — the app with hot-reload; /api/* is proxied to :8788
  yarn workspace @meridian/web dev
  ```

  Override the proxy target with `WRANGLER_DEV_URL` if you use a different port. With only
  `next dev` running (no wrangler), `/api/history` 404s and the sparkline shows its empty
  baseline — harmless, expected.

- Alternatively, point `NEXT_PUBLIC_HISTORY_BASE` at a deployed Pages preview to skip the
  local wrangler process entirely.

## Clean URLs

The export emits flat files (`trade/AAPL.html`, not `trade/AAPL/index.html`). Cloudflare
Pages serves `/trade/AAPL` from `trade/AAPL.html` automatically, so no rewrite rules are
needed.
