import type { Config } from "tailwindcss";

// NOVA FITNESS palette (spec §36): black surfaces, red accents, light text.
// Deliberately not a generic blue SaaS theme.
const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        nova: {
          black: "#08080A",
          surface: "#101014",
          card: "#16161C",
          elevated: "#1D1D25",
          border: "#26262F",
          borderBright: "#3A3A47",
          red: "#FF1E3C",
          redDeep: "#C1102A",
          redGlow: "rgba(255, 30, 60, 0.14)",
          text: "#F2F2F5",
          muted: "#8E8E9C",
        },
      },
      fontFamily: {
        // Rajdhani for UI, Orbitron for anything that should read as a display.
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
        display: ["var(--font-display)", "var(--font-sans)", "sans-serif"],
      },
      letterSpacing: {
        widest: "0.2em",
      },
      boxShadow: {
        nova: "0 1px 0 0 rgba(255,255,255,0.05) inset, 0 12px 32px -18px rgba(0,0,0,0.95)",
        glow: "0 0 0 1px rgba(255,30,60,0.35), 0 8px 28px -8px rgba(255,30,60,0.45)",
        glowSoft: "0 0 24px -6px rgba(255,30,60,0.35)",
      },
      backgroundImage: {
        "nova-sheen":
          "linear-gradient(135deg, rgba(255,255,255,0.05) 0%, rgba(255,255,255,0) 45%)",
        "nova-red": "linear-gradient(135deg, #FF1E3C 0%, #C1102A 100%)",
      },
      keyframes: {
        "fade-up": {
          from: { opacity: "0", transform: "translateY(6px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        // Slow travelling highlight along the top edge of the app bars.
        sweep: {
          "0%": { transform: "translateX(-100%)" },
          "100%": { transform: "translateX(200%)" },
        },
      },
      animation: {
        // Kept minimal on purpose — member pages run on mid-range phones.
        "fade-up": "fade-up 0.22s ease-out",
        sweep: "sweep 4s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};

export default config;
