import type { Config } from "tailwindcss";

/**
 * The design tokens are the product's brand contract — the "Editorial Fintech / Gold & Teal"
 * identity. A warm near-black surface, GOLD as the brand accent (logo, primary CTAs, the
 * settlement countdown), TEAL "Yes" and TERRACOTTA "No" semantics, blue USDC, amber warnings.
 *
 * Crucial split: `accent` is the BRAND color (gold) and is deliberately a *different* hex from
 * `yes` (teal). Up-trends and the "Yes" side read teal; the gold accent never stands in for Yes.
 * Type is editorial: Fraunces serif display, Inter body, JetBrains Mono for all numbers.
 */
const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: { DEFAULT: "#0f1115", 2: "#16181d" },
        panel: { DEFAULT: "#14161b", 2: "#1a1d23" },
        line: { DEFAULT: "#272a31", soft: "#20232a" },
        fg: { DEFAULT: "#e9e5dc", dim: "#b3ad9f", faint: "#7d776b" },
        accent: { DEFAULT: "#e8b14c", dim: "#b8853a" },
        amber: { DEFAULT: "#d99a4e", dim: "#a8763a" },
        yes: "#4ac9a2",
        no: "#e08a6c",
        usdc: "#5aa6ff",
      },
      fontFamily: {
        sans: ["Inter", "Helvetica Neue", "sans-serif"],
        serif: ["Fraunces", "Georgia", "serif"],
        mono: ["JetBrains Mono", "ui-monospace", "monospace"],
      },
      maxWidth: {
        page: "1180px",
      },
      borderRadius: {
        panel: "14px",
      },
    },
  },
  plugins: [],
};

export default config;
