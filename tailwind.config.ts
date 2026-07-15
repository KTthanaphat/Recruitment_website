import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        navy: "#0B132B",
        charcoal: "#1F2937",
        slate: "#475569",
        cool: "#94A3B8",
        primary: "#0A3CDC",
        electric: "#146EFA",
        purple: "#411EDC",
        teal: "#0AA0C3",
        orange: "#FF8A00",
        scarlet: "#FF3B30",
        amber: "#FFC107",
        offwhite: "#FAFAFC",
        lightgray: "#F1F5F9"
      },
      boxShadow: {
        panel: "0 18px 50px rgba(11, 19, 43, 0.08)"
      }
    }
  },
  plugins: []
};

export default config;
