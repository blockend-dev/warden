import type { Config } from "tailwindcss";

export default {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#08090c",
        surface: "#0e1017",
        raised: "#12151d",
        paper: "#f6f5f1",
        // Semantic pair used throughout the privacy boundary: cyan for what
        // the ledger actually sees, violet for what never leaves a party's
        // own device. Keep these the only two colors that mean "visibility".
        public: {
          DEFAULT: "#38bdf8",
          dim: "#0c4a6e"
        },
        private: {
          DEFAULT: "#c084fc",
          dim: "#4c1d95"
        }
      },
      fontFamily: {
        display: ["var(--font-display)", "ui-sans-serif", "system-ui"],
        mono: ["var(--font-mono)", "ui-monospace", "SFMono-Regular"]
      },
      backgroundImage: {
        grid: "linear-gradient(to right, rgb(255 255 255 / 0.035) 1px, transparent 1px), linear-gradient(to bottom, rgb(255 255 255 / 0.035) 1px, transparent 1px)"
      }
    }
  },
  plugins: []
} satisfies Config;
