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
    timeStyle?: "short" | "medium";
  },
): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat(intlLocaleTag(options.locale), {
    timeZone: options.timeZone,
    dateStyle: options.dateStyle,
    timeStyle: options.timeStyle,
  }).format(date);
}

export function formatCalendarDay(
  value: Date | number | string,
  options: {
    locale: SupportedLocale;
    timeZone: string;
    weekday?: "short" | "long";
  },
): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat(intlLocaleTag(options.locale), {
    timeZone: options.timeZone,
    month: "long",
    day: "numeric",
    weekday: options.weekday,
  }).format(date);
}

export function formatCalendarMonth(
  value: Date | number | string,
  options: { locale: SupportedLocale; timeZone: string },
): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat(intlLocaleTag(options.locale), {
    timeZone: options.timeZone,
    month: "long",
  }).format(date);
}

export function formatWeekday(
  value: Date | number | string,
  options: {
    locale: SupportedLocale;
    timeZone: string;
    width: "short" | "long";
  },
): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat(intlLocaleTag(options.locale), {
    timeZone: options.timeZone,
    weekday: options.width,
  }).format(date);
}

export function formatClockWithSeconds(
  value: Date | number | string,
  options: { locale: SupportedLocale; timeZone: string },
): string {
  return formatDateTime(value, { ...options, timeStyle: "medium" });
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

export function formatPastTime(
  value: Date | number | string,
  now: Date,
  locale: SupportedLocale,
): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime()) || Number.isNaN(now.getTime())) return "—";
  const elapsedMs = Math.max(0, now.getTime() - date.getTime());
  const minutes = Math.floor(elapsedMs / 60_000);
  if (minutes < 1) return formatRelativeTime(0, "second", locale);
  if (minutes < 60) return formatRelativeTime(-minutes, "minute", locale);
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return formatRelativeTime(-hours, "hour", locale);
  return formatRelativeTime(-Math.floor(hours / 24), "day", locale);
}

export function formatProviderPrice(
  formattedPrice: string,
  locale: SupportedLocale,
): string {
  void locale;
  return formattedPrice;
}
