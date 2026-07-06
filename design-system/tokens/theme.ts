/**
 * 혜니캘린더 — React Native theme
 * Generated from tokens.json (v1.0). Import `theme` and use throughout the app.
 *
 *   import { theme } from "@/theme";
 *   <View style={{ backgroundColor: theme.color.bg.card, borderRadius: theme.radius.card }} />
 *
 * Fonts: bundle PretendardVariable.ttf and map to family "Pretendard Variable"
 * (expo-font / react-native.config.js). Fallbacks resolve to the system Korean face.
 */

export const color = {
  rose:     { s50: "#FFF0F5", soft: "#FDE7F1", line: "#FFD0DD", light: "#FF9EC4", base: "#F779A8", brand: "#F76BA6", deep: "#F0518F", text: "#B0477A" },
  mint:     { soft: "#E7F8F0", line: "#BCEBD8", light: "#46D19B", base: "#31C48D", deep: "#23A876", text: "#087653" },
  lavender: { soft: "#F1ECFF", soft2: "#EFE8FF", line: "#DDD1FF", light: "#B79DFB", base: "#A78BFA", mid: "#8B6BEC", deep: "#7C5CE1", text: "#6D4E9C" },
  gold:     { soft: "#FFF3D6", base: "#FFD76A", deep: "#E08A1E", text: "#8A6A1E" },
  blue:     { soft: "#E6F2FB", base: "#2E86C1", text: "#2E6DA4" },
  danger:   { soft: "#FFECEE", base: "#E5484D", strong: "#F04770", text: "#B91C1C" },
  fg:       { primary: "#201A1D", secondary: "#4A4145", body: "#3A3236", tertiary: "#6D6469", muted: "#8B7E84", faint: "#A99FA4", disabled: "#C9BFC4" },
  line:     { hair: "rgba(32,26,29,0.06)", soft: "rgba(32,26,29,0.10)", strong: "rgba(32,26,29,0.16)" },
  bg:       { app: "#FBF7F4", page: "#F7F4F3", body: "#EFE7EE", card: "#FFFFFF", press: "#FBF3F6" },
} as const;

export const font = {
  family: "Pretendard Variable",
  weight: { medium: "500", semibold: "600", bold: "700", heavy: "800", black: "900" },
} as const;

/** size / lineHeight (px) / fontWeight — ready to spread into a Text style. */
export const type = {
  display:  { fontSize: 44,   lineHeight: 46, fontWeight: "900", letterSpacing: -1.2 },
  titleXl:  { fontSize: 26,   lineHeight: 34, fontWeight: "800", letterSpacing: -0.5 },
  title:    { fontSize: 25,   lineHeight: 32, fontWeight: "900", letterSpacing: -0.5 },
  section:  { fontSize: 17,   lineHeight: 22, fontWeight: "800", letterSpacing: -0.3 },
  bodyLg:   { fontSize: 16,   lineHeight: 21, fontWeight: "700" },
  body:     { fontSize: 15,   lineHeight: 21, fontWeight: "700" },
  bodySm:   { fontSize: 14,   lineHeight: 21, fontWeight: "600" },
  label:    { fontSize: 12.5, lineHeight: 16, fontWeight: "700" },
  caption:  { fontSize: 12,   lineHeight: 16, fontWeight: "600" },
  micro:    { fontSize: 11,   lineHeight: 14, fontWeight: "700" },
  tiny:     { fontSize: 10.5, lineHeight: 13, fontWeight: "800" },
} as const;

export const radius = { xs: 8, sm: 10, md: 13, lg: 15, xl: 18, xxl: 20, card: 24, hero: 26, xxxl: 30, pill: 9999 } as const;

export const space = { s1: 4, s2: 8, s3: 12, s4: 16, s5: 20, s6: 24, sectionChild: 18, pagePadding: 20 } as const;

/** RN shadow presets. iOS uses shadow*, Android uses elevation. */
export const shadow = {
  soft:     { shadowColor: "#201A1D", shadowOpacity: 0.06, shadowRadius: 12, shadowOffset: { width: 0, height: 4 },  elevation: 2 },
  card:     { shadowColor: "#201A1D", shadowOpacity: 0.10, shadowRadius: 24, shadowOffset: { width: 0, height: 14 }, elevation: 6 },
  floating: { shadowColor: "#201A1D", shadowOpacity: 0.12, shadowRadius: 30, shadowOffset: { width: 0, height: 12 }, elevation: 10 },
  rose:     { shadowColor: "#F0518F", shadowOpacity: 0.45, shadowRadius: 30, shadowOffset: { width: 0, height: 18 }, elevation: 10 },
  mint:     { shadowColor: "#23A876", shadowOpacity: 0.45, shadowRadius: 20, shadowOffset: { width: 0, height: 12 }, elevation: 8 },
  lavender: { shadowColor: "#7C5CE1", shadowOpacity: 0.50, shadowRadius: 26, shadowOffset: { width: 0, height: 16 }, elevation: 10 },
} as const;

export const motion = {
  duration: { fast: 120, base: 160, screen: 400 },
  // react-native-reanimated Easing.bezier(...) args:
  easing:   { standard: [0.2, 0, 0.2, 1], cheer: [0.34, 1.56, 0.64, 1] },
  pressScale: 0.96,
} as const;

/** Per-mode accent — theme the shell by role. */
export const modeAccent = {
  parent:  { accent: color.rose.brand,     soft: color.rose.soft,     text: color.rose.text,  line: color.rose.line },
  child:   { accent: color.rose.brand,     soft: color.rose.soft,     text: color.rose.text,  line: color.rose.line },
  teacher: { accent: color.mint.base,      soft: color.mint.soft,     text: color.mint.text,  line: color.mint.line },
  ai:      { accent: color.lavender.base,  soft: color.lavender.soft, text: color.lavender.text, line: color.lavender.line },
} as const;

export const theme = { color, font, type, radius, space, shadow, motion, modeAccent } as const;
export type Theme = typeof theme;
export default theme;
