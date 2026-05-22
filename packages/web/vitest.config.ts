import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  esbuild: {
    // Use the automatic JSX runtime so components don't need `React` in scope
    // (matches Next's SWC behavior).
    jsx: "automatic",
  },
  resolve: {
    alias: {
      "@meridian/sdk": path.resolve(__dirname, "../sdk/src/index.ts"),
      "@meridian/sdk/pyth": path.resolve(__dirname, "../sdk/src/pyth.ts"),
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
    // Playwright specs live under e2e/ and run with their own runner.
    exclude: ["e2e/**", "node_modules/**"],
  },
});
