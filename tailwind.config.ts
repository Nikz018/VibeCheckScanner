import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#1a100c",
        paper: "#f6f3f0",
        // Utility name stays `lime` so existing classes keep working. The brand accent is coral.
        lime: "#ff6a3d",
        moss: "#2a211c",
        bark: "#1a100c",
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
