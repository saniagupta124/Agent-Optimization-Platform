import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        slash: {
          bg: "#121212",
          surface: "#1a1a1a",
          border: "#2a2a2a",
          orange: "#f97316",
          "orange-deep": "#ea580c",
          blue: "#38bdf8",
        },
      },
    },
  },
  plugins: [],
};
export default config;
