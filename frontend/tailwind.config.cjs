/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: "class",
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        cream: "rgb(var(--color-cream) / <alpha-value>)",
        pearl: "rgb(var(--color-pearl) / <alpha-value>)",
        blush: "rgb(var(--color-blush) / <alpha-value>)",
        rose: "rgb(var(--color-rose) / <alpha-value>)",
        burgundy: {
          DEFAULT: "rgb(var(--color-burgundy) / <alpha-value>)",
          light: "rgb(var(--color-burgundy-light) / <alpha-value>)",
          dark: "rgb(var(--color-burgundy-dark) / <alpha-value>)",
        },
        clay: "rgb(var(--color-clay) / <alpha-value>)",
        gold: "rgb(var(--color-gold) / <alpha-value>)",
        alert: "rgb(var(--color-alert) / <alpha-value>)",
        success: "rgb(var(--color-success) / <alpha-value>)",
      },
      opacity: {
        2: "0.02",
        4: "0.04",
        6: "0.06",
        8: "0.08",
        12: "0.12",
        15: "0.15",
        16: "0.16",
        18: "0.18",
        22: "0.22",
        28: "0.28",
        35: "0.35",
        38: "0.38",
        45: "0.45",
        55: "0.55",
        65: "0.65",
        72: "0.72",
        82: "0.82",
      },
      fontFamily: {
        display: ["var(--font-display)"],
        sans: ["var(--font-sans)"],
        heading: ["var(--font-heading)"],
        script: ["var(--font-script)"],
      },
      boxShadow: {
        card: "0 18px 50px -28px rgba(122, 38, 50, 0.22)",
        soft: "0 24px 60px -32px rgba(122, 38, 50, 0.3)",
      },
      keyframes: {
        fadeIn: {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
        fadeUp: {
          "0%": { opacity: "0", transform: "translateY(10px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        popIn: {
          "0%": { opacity: "0", transform: "scale(0.92)" },
          "100%": { opacity: "1", transform: "scale(1)" },
        },
        scaleIn: {
          "0%": { opacity: "0", transform: "scale(0.96)" },
          "100%": { opacity: "1", transform: "scale(1)" },
        },
        drift: {
          "0%, 100%": { transform: "translate(0, 0)" },
          "50%": { transform: "translate(18px, -14px)" },
        },
        pulseSlow: {
          "0%, 100%": { boxShadow: "0 0 0 0 rgba(201, 161, 90, 0.45)" },
          "50%": { boxShadow: "0 0 0 5px rgba(201, 161, 90, 0)" },
        },
      },
      animation: {
        fadeIn: "fadeIn 0.5s ease-out forwards",
        fadeUp: "fadeUp 0.5s cubic-bezier(0.22, 1, 0.36, 1) forwards",
        popIn: "popIn 0.35s cubic-bezier(0.22, 1, 0.36, 1) forwards",
        scaleIn: "scaleIn 0.3s cubic-bezier(0.22, 1, 0.36, 1) forwards",
        drift: "drift 12s ease-in-out infinite",
        "pulse-slow": "pulseSlow 2.2s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};
