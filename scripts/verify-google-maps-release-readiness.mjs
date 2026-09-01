import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { GOOGLE_MAP_RELEASE_COUNTRIES } from "../shared/mapPolicy.ts";

const root = resolve(import.meta.dirname, "..");
const read = (path) => readFileSync(resolve(root, path), "utf8");
const pkg = JSON.parse(read("package.json"));
const checks = [];
const check = (name, passed) => checks.push({ name, passed: Boolean(passed) });
const expectedCountries = ["JP", "TW", "HK", "SG", "VN", "TH", "ID", "MY", "PH"];

check("Google 웹 SDK 버전 고정", pkg.dependencies?.["@googlemaps/js-api-loader"] === "2.1.1");
check("Google Android SDK 버전 고정", pkg.dependencies?.["@capacitor/google-maps"] === "8.0.1");
check("가족 국가 migration 존재", /ALTER TABLE families ADD COLUMN country_code/u.test(read("worker/db/global-family-country.sql")));
check("지도 요청 제어 migration 존재", /map_autocomplete_sessions/u.test(read("worker/db/maps-request-control.sql")));
check("Android key는 Gradle placeholder", /android:value="\$\{MAPS_API_KEY\}"/u.test(read("android/app/src/main/AndroidManifest.xml")));
check("release key 누락 fail-closed", /릴리즈 Google Maps API key Gradle property가 누락되었습니다/u.test(read("android/app/build.gradle")));
check(
  "운영 Google 국가 allowlist는 검증 대상 9개국만 포함",
  JSON.stringify(GOOGLE_MAP_RELEASE_COUNTRIES) === JSON.stringify(expectedCountries),
);
check(
  "한국·중국·미확정 국가는 Google allowlist에서 제외",
  ["KR", "CN", "ZZ"].every((countryCode) => !GOOGLE_MAP_RELEASE_COUNTRIES.includes(countryCode)),
);
check("Google CSP가 허용됨", /maps\.googleapis\.com/u.test(read("public/_headers")) && /maps\.gstatic\.com/u.test(read("public/_headers")));

const failedChecks = checks.filter((item) => !item.passed);
const externalBlockers = [
  "BLOCKED_BY_TIMEZONE_GATE",
  "BLOCKED_BY_GOOGLE_ROUTES_OAUTH_SCOPE_PROOF",
  "BLOCKED_BY_LIVE_NON_KR_DEVICE_E2E",
];
const releaseMode = process.argv.includes("--release");
const result = {
  status: failedChecks.length > 0 ? "FAIL" : releaseMode ? "HOLD" : "READY_FOR_EXTERNAL_VALIDATION",
  checks,
  enabledCountries: [...GOOGLE_MAP_RELEASE_COUNTRIES],
  blockers: failedChecks.length > 0 ? [] : externalBlockers,
};

process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
if (failedChecks.length > 0 || releaseMode) process.exitCode = 1;
