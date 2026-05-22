/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The SDK is consumed as TypeScript source (no prebuilt dist), so Next must
  // transpile it alongside the app.
  transpilePackages: ["@meridian/sdk"],
  webpack: (config) => {
    // The wallet adapters and web3.js reference Node core modules that don't
    // exist in the browser; stub them so the client bundle builds.
    config.resolve.fallback = {
      ...config.resolve.fallback,
      fs: false,
      path: false,
      os: false,
      crypto: false,
    };
    return config;
  },
};

export default nextConfig;
