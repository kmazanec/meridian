/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
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

export default nextConfig;
