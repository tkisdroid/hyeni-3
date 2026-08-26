export const supportedLocales = [
  "ko", "en", "ja", "zh-CN", "zh-TW", "vi", "th", "id", "ms", "fil",
] as const;

export type SupportedLocale = (typeof supportedLocales)[number];

const exact = new Set<string>(supportedLocales);
const languageLocales = ["ko", "en", "ja", "vi", "th", "id", "ms", "fil"] as const;

export function isSupportedLocale(locale: string): locale is SupportedLocale {
  return exact.has(locale);
}

export function normalizeLocale(input: string | null | undefined): SupportedLocale {
  const raw = String(input ?? "").trim().replaceAll("_", "-");
  if (isSupportedLocale(raw)) return raw;

  const lower = raw.toLowerCase();
  if (lower === "in" || lower.startsWith("in-")) return "id";
  if (lower === "tl" || lower.startsWith("tl-")) return "fil";
  if (/^zh-(hant|tw|hk|mo)(-|$)/i.test(raw)) return "zh-TW";
  if (/^zh-(hans|cn|sg)(-|$)/i.test(raw)) return "zh-CN";
  if (lower === "zh") return "zh-CN";
  for (const locale of languageLocales) {
    if (lower === locale || lower.startsWith(`${locale}-`)) return locale;
  }
  return "en";
}

export function isSupportedLocaleInput(input: string | null | undefined): boolean {
  const raw = String(input ?? "").trim().replaceAll("_", "-");
  const lower = raw.toLowerCase();

  return isSupportedLocale(raw)
    || lower === "in"
    || lower.startsWith("in-")
    || lower === "tl"
    || lower.startsWith("tl-")
    || /^zh-(hant|tw|hk|mo|hans|cn|sg)(-|$)/i.test(raw)
    || lower === "zh"
    || languageLocales.some((locale) => lower === locale || lower.startsWith(`${locale}-`));
}

export function localeFallbackChain(locale: SupportedLocale): SupportedLocale[] {
  return locale === "ko" ? ["ko", "en"] : locale === "en" ? ["en", "ko"] : [locale, "en", "ko"];
}

export function localeDirection(_locale: SupportedLocale): "ltr" {
  return "ltr";
}

/**
 * locale 별 브랜드 표기 정본(2026-08-25 TK 승인 A안).
 *
 * 고유명 `Hyeni` 는 그대로 두고 "캘린더"에 해당하는 **일반명사만 현지어**로 쓴다.
 * 음역(ヘニ·慧尼 …)은 상표·의미 결정이 필요해 채택하지 않았다.
 * 한국어만 붙여쓰기 고유 표기 `혜니캘린더` 를 유지한다.
 *
 * ⚠️ 이 표를 고치면 `locales/manifest.json` 의 `brandName`, `locales/glossary.json` 의 `brand`,
 * 각 locale `core.brand.name`, `scripts/i18n/audit-task8-locales.mjs` 의 브랜드 감사를 함께 맞춰야 한다.
 */
const BRAND_NAMES: Record<SupportedLocale, string> = {
  ko: "혜니캘린더",
  en: "Hyeni Calendar",
  ja: "Hyeni カレンダー",
  "zh-CN": "Hyeni 日历",
  "zh-TW": "Hyeni 日曆",
  vi: "Lịch Hyeni",
  th: "ปฏิทิน Hyeni",
  id: "Kalender Hyeni",
  ms: "Kalendar Hyeni",
  fil: "Kalendaryo Hyeni",
};

export function localizedBrandName(locale: SupportedLocale): string {
  return BRAND_NAMES[locale] ?? BRAND_NAMES.en;
}
