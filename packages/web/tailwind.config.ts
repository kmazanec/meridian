import type { Config } from "tailwindcss";

/**
 * The design tokens are the product's brand contract (the pitch deck). Colors and
 * type scale mirror it exactly so the app reads as one surface with the deck:
 * a dark fintech palette, mint-green "Yes", coral "No", blue USDC, amber warnings.
 */
const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: { DEFAULT: "#070b14", 2: "#0c121f" },
        panel: { DEFAULT: "#0f1726", 2: "#131d30" },
        line: { DEFAULT: "#243349", soft: "#18243a" },
        fg: { DEFAULT: "#e8edf5", dim: "#93a3bd", faint: "#5e6f8c" },
        accent: { DEFAULT: "#4ff0a8", dim: "#2bbd80" },
        amber: { DEFAULT: "#ffb454", dim: "#c9893b" },
        yes: "#4ff0a8",
        no: "#ff7a8a",
        usdc: "#5aa6ff",
      },
      fontFamily: {
        sans: ["Archivo", "Helvetica Neue", "sans-serif"],
        serif: ["Fraunces", "Georgia", "serif"],
        mono: ["Space Mono", "ui-monospace", "monospace"],
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
