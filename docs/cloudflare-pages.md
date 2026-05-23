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

# publish the static output
npx wrangler pages deploy packages/web/out --project-name meridian
```

Or connect the GitHub repo in the Pages dashboard with the build command + output dir above
for push-to-deploy.

## Clean URLs

The export emits flat files (`trade/AAPL.html`, not `trade/AAPL/index.html`). Cloudflare
Pages serves `/trade/AAPL` from `trade/AAPL.html` automatically, so no rewrite rules are
needed.
