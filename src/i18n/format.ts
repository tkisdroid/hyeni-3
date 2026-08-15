import type { SupportedLocale } from "./locale.ts";

/** 가족 time zone 필드 이관 전 기존 가족이 사용하는 명시적 표시 시간대. */
export const LEGACY_FAMILY_TIME_ZONE = "Asia/Seoul";

const INTL_LOCALE_TAGS: Readonly<Record<SupportedLocale, string>> = {
  ko: "ko-KR",
  en: "en-US",
  ja: "ja-JP",
  "zh-CN": "zh-CN",
  "zh-TW": "zh-TW",
  vi: "vi-VN",
  th: "th-TH-u-ca-gregory",
  id: "id-ID",
  ms: "ms-MY",
  fil: "fil-PH",
};

export function intlLocaleTag(locale: SupportedLocale): string {
  return INTL_LOCALE_TAGS[locale];
}

export function formatDateTime(
  value: Date | number | string,
  options: {
    locale: SupportedLocale;
    timeZone: string;
    dateStyle?: "short" | "medium";
    timeStyle?: "short";
  },
): string {
  return new Intl.DateTimeFormat(intlLocaleTag(options.locale), {
    timeZone: options.timeZone,
    dateStyle: options.dateStyle,
    timeStyle: options.timeStyle,
  }).format(new Date(value));
}

export function formatNumber(value: number, locale: SupportedLocale): string {
  return new Intl.NumberFormat(intlLocaleTag(locale)).format(value);
}

export function formatRelativeTime(
  value: number,
  unit: Intl.RelativeTimeFormatUnit,
  locale: SupportedLocale,
): string {
  return new Intl.RelativeTimeFormat(intlLocaleTag(locale), { numeric: "always" }).format(value, unit);
}

export function formatProviderPrice(
  formattedPrice: string,
  locale: SupportedLocale,
): string {
  void locale;
  return formattedPrice;
}
