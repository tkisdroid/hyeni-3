import { SERVICE_COUNTRY_CODES } from "./serviceCountries.ts";

export const GOOGLE_MAPS_CORE_COVERAGE_SOURCE = "https://developers.google.com/maps/coverage";
export const GOOGLE_MAPS_CORE_COVERAGE_REVIEWED_AT = "2026-09-01";

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
 * Google 공식 core coverage 표에 저장 가능한 ISO 249개국이 모두 포함되므로 KR만 Kakao로 제외한다.
 */
export const GOOGLE_MAP_RELEASE_COUNTRIES: readonly string[] = Object.freeze(
  SERVICE_COUNTRY_CODES.filter((countryCode) => countryCode !== "KR"),
);

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
  if (googleCountries.has(normalized)) {
    return { provider: "google", countryCode: normalized };
  }
  if (normalized === "CN") {
    return { provider: "unsupported", reason: "china_unsupported" };
  }
  return { provider: "unsupported", reason: "country_not_enabled" };
}
