/**
 * 혜니캘린더 — 디자인 토큰 (v1.0)
 * 원본: design-system/tokens/theme.ts (프로토타입 "혜니캘린더 리디자인" 기준)
 * 모든 값은 리터럴 — tokens.css의 CSS 변수와 1:1 대응됩니다.
 * JS에서 색/간격 계산이 필요할 때 사용하고, 스타일링은 tokens.css 변수를 우선합니다.
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

/** 아이가 고르는 테마 강조색 (data-accent). */
export const accents = {
  rose:     { accent: "#F76BA6", light: "#FF9EC4", deep: "#F0518F", soft: "#FDE7F1", text: "#B0477A" },
  peach:    { accent: "#FF9E7A", light: "#FFC7A6", deep: "#F26B3F", soft: "#FFEEE3", text: "#C25A2E" },
  lavender: { accent: "#A78BFA", light: "#C4B0FF", deep: "#7C5CE1", soft: "#EFE8FF", text: "#6D4E9C" },
  mint:     { accent: "#31C48D", light: "#6FE0B4", deep: "#1E9E6E", soft: "#E7F8F0", text: "#0C7A54" },
  sky:      { accent: "#4FB2E8", light: "#8FD4F5", deep: "#2E86C1", soft: "#E6F4FC", text: "#1F6FA5" },
  lemon:    { accent: "#F5C542", light: "#FFDE7A", deep: "#E0A11E", soft: "#FFF6DC", text: "#9A6D0E" },
} as const;

export type AccentKey = keyof typeof accents;

export const radius = { xs: 8, sm: 10, md: 13, lg: 15, xl: 18, xxl: 20, card: 24, hero: 26, xxxl: 30, pill: 9999 } as const;
export const space = { s1: 4, s2: 8, s3: 12, s4: 16, s5: 20, s6: 24, sectionChild: 18, pagePadding: 20 } as const;

/** 역할별 강조색 */
export const modeAccent = {
  parent:  { accent: color.rose.brand,    soft: color.rose.soft,     text: color.rose.text,     line: color.rose.line },
  child:   { accent: color.rose.brand,    soft: color.rose.soft,     text: color.rose.text,     line: color.rose.line },
  teacher: { accent: color.mint.base,     soft: color.mint.soft,     text: color.mint.text,     line: color.mint.line },
  ai:      { accent: color.lavender.base, soft: color.lavender.soft, text: color.lavender.text, line: color.lavender.line },
} as const;

export const theme = { color, accents, radius, space, modeAccent } as const;
export type Theme = typeof theme;
export default theme;
