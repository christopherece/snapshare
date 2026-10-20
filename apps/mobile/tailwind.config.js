/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./app/**/*.{ts,tsx}", "./src/**/*.{ts,tsx}"],
  presets: [require("nativewind/preset")],
  darkMode: "media",
  theme: {
    extend: {
      colors: {
        ink: { DEFAULT: "#111111", soft: "#2a2a2a" },
        paper: { DEFAULT: "#faf8f5", dim: "#efebe5" },
        accent: "#c8a97e",
      },
    },
  },
  plugins: [],
};
