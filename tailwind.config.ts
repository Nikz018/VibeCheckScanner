import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#14201b",
        paper: "#f4f0e6",
        lime: "#dff25b",
        moss: "#1d3a2e",
        bark: "#0e1210",
      },
      fontFamily: {
        sans: ["var(--font-sans)", "ui-sans-serif", "system-ui"],
        display: ["var(--font-display)", "ui-serif", "Georgia"],
      },
      boxShadow: {
        card: "0 20px 50px rgba(8, 12, 10, 0.18)",
      },
    },
  },
  plugins: [],
};

export default config;
