import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#071018",
        paper: "#f4f7fb",
        lime: "#dff25b",
        moss: "#12324a",
        bark: "#071018",
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
