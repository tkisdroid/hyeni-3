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

export function localizedBrandName(locale: SupportedLocale): string {
  return locale === "ko" ? "혜니캘린더" : "Hyeni Calendar";
}
