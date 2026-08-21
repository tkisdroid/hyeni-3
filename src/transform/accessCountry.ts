import type { SupportedLocale } from "../i18n/locale.ts";

export type RegionalSocialProvider = "kakao" | "google" | "naver";

const TIME_ZONE_COUNTRIES: Readonly<Record<string, string>> = {
  "Asia/Seoul": "KR",
  "Asia/Tokyo": "JP",
  "Asia/Shanghai": "CN",
  "Asia/Chongqing": "CN",
  "Asia/Harbin": "CN",
  "Asia/Urumqi": "CN",
  "Asia/Taipei": "TW",
  "Asia/Hong_Kong": "HK",
  "Asia/Macau": "MO",
  "Asia/Ho_Chi_Minh": "VN",
  "Asia/Saigon": "VN",
  "Asia/Bangkok": "TH",
  "Asia/Jakarta": "ID",
  "Asia/Pontianak": "ID",
  "Asia/Makassar": "ID",
  "Asia/Jayapura": "ID",
  "Asia/Kuala_Lumpur": "MY",
  "Asia/Kuching": "MY",
  "Asia/Manila": "PH",
};

const COUNTRY_LOCALES: Readonly<Record<string, SupportedLocale>> = {
  KR: "ko",
  JP: "ja",
  CN: "zh-CN",
  SG: "zh-CN",
  TW: "zh-TW",
  HK: "zh-TW",
  MO: "zh-TW",
  VN: "vi",
  TH: "th",
  ID: "id",
  MY: "ms",
  PH: "fil",
};

export function normalizeAccessCountry(value: unknown): string {
  const country = typeof value === "string" ? value.trim().toUpperCase() : "";
  if (!/^[A-Z]{2}$/.test(country) || country === "XX" || country === "ZZ") return "ZZ";
  return country;
}

function countryFromNavigatorLocale(locale: string): string | null {
  try {
    const region = new Intl.Locale(locale.replaceAll("_", "-")).region;
    const country = normalizeAccessCountry(region);
    return country === "ZZ" ? null : country;
  } catch {
    return null;
  }
}

/** 서버 국가 응답 전에도 화면이 흔들리지 않도록 시간대→브라우저 지역 순으로 안전한 초기값을 만든다. */
export function accessCountryFromClientHints(args: {
  timeZone?: string | null;
  navigatorLanguages: readonly string[];
}): string {
  const timeZone = String(args.timeZone ?? "").trim();
  const timeZoneCountry = TIME_ZONE_COUNTRIES[timeZone];
  if (timeZoneCountry) return timeZoneCountry;
  for (const language of args.navigatorLanguages) {
    const country = countryFromNavigatorLocale(language);
    if (country) return country;
  }
  return "ZZ";
}

/** 지원하지 않는 국가의 첫 언어는 영어로 닫되 사용자가 펼쳐서 언제든 바꿀 수 있다. */
export function localeForAccessCountry(country: unknown): SupportedLocale {
  return COUNTRY_LOCALES[normalizeAccessCountry(country)] ?? "en";
}

/** 국내 전용 OAuth는 한국 접속에서만 보이고 Google은 전 지역 공용으로 유지한다. */
export function socialProvidersForAccessCountry(
  country: unknown,
  options: { naverAvailable: boolean },
): RegionalSocialProvider[] {
  const normalized = normalizeAccessCountry(country);
  // 국가 판정 실패 시 기존 로그인 수단을 숨기지 않는 fail-open 정책을 쓴다.
  const koreanProviders = normalized === "KR" || normalized === "ZZ";
  if (!koreanProviders) return ["google"];
  return ["kakao", "google", ...(options.naverAvailable ? ["naver" as const] : [])];
}
