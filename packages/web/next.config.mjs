import { PHASE_DEVELOPMENT_SERVER } from "next/constants.js";

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Static export: the app is fully client-side (no API routes/SSR), so it ships as
  // plain static files to a CDN (Cloudflare Pages). `/trade/[symbol]` enumerates its
  // pages via generateStaticParams (the 7 tickers); see app/trade/[symbol]/page.tsx.
  output: "export",
  // The SDK is consumed as TypeScript source (no prebuilt dist), so Next must
  // transpile it alongside the app.
  transpilePackages: ["@meridian/sdk"],
  // `webpack` here is the instance Next passes in (no separate dependency needed).
  webpack: (config, { webpack }) => {
    // The wallet adapters and web3.js reference Node core modules that don't
    // exist in the browser; stub them so the client bundle builds.
    config.resolve.fallback = {
      ...config.resolve.fallback,
      fs: false,
      path: false,
      os: false,
      crypto: false,
    };

    // The SDK's Pyth helpers are settlement-only and lazy-load their optional peer
    // deps at call time. The frontend never settles, so it never calls them — but the
    // bundler still tries to *resolve* the dynamic `import("@pythnetwork/...")` and
    // their transitive deps (axios, rpc-websockets) at build time. Ignore them: they
    // are genuinely absent and never executed in the browser.
    config.plugins.push(
      new webpack.IgnorePlugin({
        resourceRegExp:
          /^(@pythnetwork\/hermes-client|@pythnetwork\/pyth-solana-receiver)$/,
      })
    );

    return config;
  },
};

// In production this is a pure static export (no server), so the `/api/history` Pages
// Function is served by Cloudflare alongside `out/`. But `next dev` has no Cloudflare
// runtime, so that route would 404 in development. To keep hot-reload AND real price
// history locally, we proxy `/api/history/*` to a `wrangler pages dev` instance during
// dev only (rewrites are unsupported under `output: export`, so they're added only in
// the dev phase — the production export is unchanged). Point at a custom wrangler origin
// with WRANGLER_DEV_URL if you don't use the default port.
//
//   Terminal 1:  cd packages/web && yarn build && npx wrangler pages dev out --port 8788
//   Terminal 2:  yarn workspace @meridian/web dev
const WRANGLER_DEV_URL =
  process.env.WRANGLER_DEV_URL ?? "http://localhost:8788";

export default (phase) => {
  if (phase === PHASE_DEVELOPMENT_SERVER) {
    // Strip `output: export` (incompatible with rewrites) and proxy the API in dev.
    const { output, ...devConfig } = nextConfig;
    return {
      ...devConfig,
      async rewrites() {
        return [
          {
            source: "/api/:path*",
            destination: `${WRANGLER_DEV_URL}/api/:path*`,
          },
        ];
      },
    };
  }
  return nextConfig;
};
