import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        // Brand
        "t-bg":        "#1B1B1D",
        "t-surface":   "#262628",
        "t-elevated":  "#2E2E32",
        "t-border":    "#333336",
        "t-subtle":    "#2A2A2D",
        // Greens
        "t-green":     "#0E714A",
        "t-green-mid": "#1BA86F",
        "t-green-light":"#B8F4C8",
        // Text
        "t-text":      "#FFFFFF",
        "t-muted":     "#9999A8",
        "t-dim":       "#666670",
        // Accent
        "t-amber":     "#E8A020",
        "t-red":       "#F87171",
        "t-yellow-text":"#FBBF24",
        // Legacy aliases so nothing breaks
        slash: {
          bg: "#1B1B1D",
          surface: "#262628",
          border: "#333336",
        },
      },
      fontFamily: {
        sans: ["'Clash Display'", "system-ui", "-apple-system", "sans-serif"],
        display: ["'Clash Display'", "system-ui", "sans-serif"],
      },
      borderRadius: {
        sm: "4px",
        md: "8px",
        lg: "12px",
        xl: "16px",
      },
    },
  },
  plugins: [],
};
export default config;
