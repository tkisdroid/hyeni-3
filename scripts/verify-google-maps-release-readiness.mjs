import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  GOOGLE_MAP_RELEASE_COUNTRIES,
  GOOGLE_MAPS_CORE_COVERAGE_REVIEWED_AT,
  GOOGLE_MAPS_CORE_COVERAGE_SOURCE,
} from "../shared/mapPolicy.ts";
import { dayWindowAt, wallTimeToEpoch } from "../shared/timeZone.ts";
import { SERVICE_COUNTRY_CODES } from "../shared/serviceCountries.ts";

const root = resolve(import.meta.dirname, "..");
const read = (path) => readFileSync(resolve(root, path), "utf8");
const pkg = JSON.parse(read("package.json"));
const checks = [];
const check = (name, passed) => checks.push({ name, passed: Boolean(passed) });
const expectedCountries = SERVICE_COUNTRY_CODES.filter((countryCode) => countryCode !== "KR");

check("Google 웹 SDK 버전 고정", pkg.dependencies?.["@googlemaps/js-api-loader"] === "2.1.1");
check("Google Android SDK 버전 고정", pkg.dependencies?.["@capacitor/google-maps"] === "8.0.1");
check("가족 국가 migration 존재", /ALTER TABLE families ADD COLUMN country_code/u.test(read("worker/db/global-family-country.sql")));
check("지도 요청 제어 migration 존재", /map_autocomplete_sessions/u.test(read("worker/db/maps-request-control.sql")));
check("Android key는 Gradle placeholder", /android:value="\$\{MAPS_API_KEY\}"/u.test(read("android/app/src/main/AndroidManifest.xml")));
check("release key 누락 fail-closed", /릴리즈 Google Maps API key Gradle property가 누락되었습니다/u.test(read("android/app/build.gradle")));
check(
  "운영 Google 국가 allowlist는 공식 coverage의 저장 가능 ISO 국가에서 한국만 제외",
  JSON.stringify(GOOGLE_MAP_RELEASE_COUNTRIES) === JSON.stringify(expectedCountries),
);
check(
  "한국·미확정·비ISO 지역은 Google allowlist에서 제외",
  ["KR", "ZZ", "AC"].every((countryCode) => !GOOGLE_MAP_RELEASE_COUNTRIES.includes(countryCode)),
);
check("Google CSP가 허용됨", /maps\.googleapis\.com/u.test(read("public/_headers")) && /maps\.gstatic\.com/u.test(read("public/_headers")));

check("가족·수신자 시간대 migration 존재", /ADD COLUMN time_zone/u.test(read("worker/db/global-family-time-zone.sql")));
check("위치 quota 원자 trigger에 서버 확정 현지 날짜 반영", /COALESCE\(NEW.ingest_date_key/u.test(read("worker/db/global-location-ingest-time-zone.sql")));
const spring = dayWindowAt(Date.parse("2026-03-08T12:00Z"), "America/Los_Angeles");
const autumn = dayWindowAt(Date.parse("2026-11-01T12:00Z"), "America/Los_Angeles");
check("DST 23·25시간 날짜 경계", spring.endMs - spring.startMs === 23 * 3600000 && autumn.endMs - autumn.startMs === 25 * 3600000);
check("DST 반복 시각은 첫 발생으로 고정", wallTimeToEpoch("2026-10-1",90,"America/Los_Angeles") === Date.parse("2026-11-01T08:30Z"));
check("Android 가족 시간대·수신자 시간대 분리", /refreshFamilyTimeZone/u.test(read("android/app/src/main/java/com/hyeni/calendar/LocationService.java")) && /isValidTimeZone/u.test(read("android/app/src/main/java/com/hyeni/calendar/NotificationQuietHoursPolicy.java")));

const failedChecks = checks.filter((item) => !item.passed);
const externalBlockers = [
  "BLOCKED_BY_RELEASE_CI_EVIDENCE",
  "BLOCKED_BY_NOTIFICATION_CONTENT_LOCALIZATION",
  "BLOCKED_BY_ANDROID_TIMEZONE_RELEASE",
  "BLOCKED_BY_GOOGLE_ROUTES_OAUTH_SCOPE_PROOF",
  "BLOCKED_BY_LIVE_NON_KR_DEVICE_E2E",
];
const releaseMode = process.argv.includes("--release");
const result = {
  status: failedChecks.length > 0 ? "FAIL" : releaseMode ? "HOLD" : "READY_FOR_EXTERNAL_VALIDATION",
  checks,
  enabledCountries: [...GOOGLE_MAP_RELEASE_COUNTRIES],
  enabledCountryCount: GOOGLE_MAP_RELEASE_COUNTRIES.length,
  coverageReviewedAt: GOOGLE_MAPS_CORE_COVERAGE_REVIEWED_AT,
  coverageSource: GOOGLE_MAPS_CORE_COVERAGE_SOURCE,
  blockers: failedChecks.length > 0 ? [] : externalBlockers,
};

process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
if (failedChecks.length > 0 || releaseMode) process.exitCode = 1;
