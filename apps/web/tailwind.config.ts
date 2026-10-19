import type { Config } from "tailwindcss";

export default {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // White family: a cool off-white canvas, glass panels, ink text.
        canvas: "#f4f7fc",
        ink: "#0b1220",
        // Semantic pair used throughout the privacy boundary: sky for what
        // the ledger actually sees, violet for what never leaves a party's
        // own device. Keep these the only two colors that mean "visibility".
        public: {
          DEFAULT: "#0284c7",
          soft: "#e0f2fe"
        },
        private: {
          DEFAULT: "#7c3aed",
          soft: "#ede9fe"
        }
      },
      fontFamily: {
        display: ["var(--font-display)", "ui-sans-serif", "system-ui"],
        mono: ["var(--font-mono)", "ui-monospace", "SFMono-Regular"]
      },
      boxShadow: {
        glass: "0 1px 0 rgba(255,255,255,0.9) inset, 0 12px 40px -16px rgba(30,41,90,0.22), 0 2px 6px -2px rgba(30,41,90,0.06)",
        lift: "0 1px 0 rgba(255,255,255,0.95) inset, 0 22px 50px -18px rgba(30,41,90,0.32), 0 4px 10px -4px rgba(30,41,90,0.08)"
      },
      backgroundImage: {
        grid: "linear-gradient(to right, rgb(15 23 42 / 0.045) 1px, transparent 1px), linear-gradient(to bottom, rgb(15 23 42 / 0.045) 1px, transparent 1px)"
      }
    }
  },
  plugins: []
} satisfies Config;
