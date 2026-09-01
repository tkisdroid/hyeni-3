export type MapProvider = "kakao" | "google" | "unsupported";

export type MapPolicy =
  | { provider: "kakao"; countryCode: "KR" }
  | { provider: "google"; countryCode: string }
  | {
      provider: "unsupported";
      reason: "country_unresolved" | "china_unsupported" | "country_not_enabled";
    };

/**
 * 운영에서 Google 지도 공급자로 명시 활성화한 비한국 국가만 여기에 추가한다.
 * 전 세계 wildcard로 바꾸지 않고 국가별 검증·회귀가 끝난 코드만 명시한다.
 */
export const GOOGLE_MAP_RELEASE_COUNTRIES: readonly string[] = [
  "JP",
  "TW",
  "HK",
  "SG",
  "VN",
  "TH",
  "ID",
  "MY",
  "PH",
];

const ISO_ALPHA_2 = /^[A-Z]{2}$/;

function normalizeCountryCode(countryCode: unknown): string | null {
  if (typeof countryCode !== "string") return null;
  const normalized = countryCode.trim().toUpperCase();
  return ISO_ALPHA_2.test(normalized) ? normalized : null;
}

export function resolveMapPolicy(
  countryCode: unknown,
  googleCountries: ReadonlySet<string> = new Set(GOOGLE_MAP_RELEASE_COUNTRIES),
): MapPolicy {
  const normalized = normalizeCountryCode(countryCode);
  if (!normalized || normalized === "ZZ") {
    return { provider: "unsupported", reason: "country_unresolved" };
  }
  if (normalized === "KR") {
    return { provider: "kakao", countryCode: "KR" };
  }
  if (normalized === "CN") {
    return { provider: "unsupported", reason: "china_unsupported" };
  }
  if (googleCountries.has(normalized)) {
    return { provider: "google", countryCode: normalized };
  }
  return { provider: "unsupported", reason: "country_not_enabled" };
}
