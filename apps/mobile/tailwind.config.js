/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./app/**/*.{ts,tsx}", "./src/**/*.{ts,tsx}"],
  presets: [require("nativewind/preset")],
  darkMode: "media",
  theme: {
    extend: {
      // Brand tokens — keep in step with packages/brand and src/theme.ts.
      colors: {
        ink: { DEFAULT: "#1b1a18", soft: "#2a2825", deep: "#121110" },
        paper: { DEFAULT: "#f7f5f1", dim: "#ece8e1" },
        accent: { DEFAULT: "#c8a97e", deep: "#9a7647" },
        muted: { DEFAULT: "#6f6962", dark: "#a39c93" },
        danger: { DEFAULT: "#b3402a", soft: "#e2725b" },
      },
      fontFamily: {
        serif: ["InstrumentSerif_400Regular"],
        "serif-italic": ["InstrumentSerif_400Regular_Italic"],
      },
    },
  },
  plugins: [],
};
