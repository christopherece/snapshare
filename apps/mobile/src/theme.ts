import { useColorScheme } from "react-native";

/** Brand colours for places Tailwind classes can't reach (icons, native props). Mirrors tailwind.config.js. */
export const colors = {
  ink: "#1b1a18",
  inkSoft: "#2a2825",
  inkDeep: "#121110",
  paper: "#f7f5f1",
  paperDim: "#ece8e1",
  gold: "#c8a97e",
  goldDeep: "#9a7647",
  muted: "#6f6962",
  mutedDark: "#a39c93",
  danger: "#b3402a",
  dangerSoft: "#e2725b",
  heart: "#ff4d6d",
} as const;

export const fonts = {
  serif: "InstrumentSerif_400Regular",
  serifItalic: "InstrumentSerif_400Regular_Italic",
} as const;

/** Resolved colours for the current light/dark appearance. */
export function useTheme() {
  const dark = useColorScheme() === "dark";
  return {
    dark,
    bg: dark ? colors.inkDeep : colors.paper,
    card: dark ? colors.inkSoft : "#ffffff",
    fg: dark ? colors.paper : colors.ink,
    muted: dark ? colors.mutedDark : colors.muted,
    accent: dark ? colors.gold : colors.goldDeep,
    danger: dark ? colors.dangerSoft : colors.danger,
    placeholder: dark ? "#7d766e" : "#a39c93",
  };
}
