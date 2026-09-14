import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

test("앱·Android CI는 Google 웹 키를 전달하고 누락을 차단한다", () => {
  const workflow = readFileSync(new URL("../.github/workflows/release-candidate.yml", import.meta.url), "utf8");
  assert.equal(workflow.match(/VITE_GOOGLE_MAPS_WEB_KEY: \$\{\{ vars\.VITE_GOOGLE_MAPS_WEB_KEY \|\| secrets\.VITE_GOOGLE_MAPS_WEB_KEY \}\}/g)?.length, 2);
  assert.equal(workflow.match(/if \[ -z "\$VITE_GOOGLE_MAPS_WEB_KEY" \]; then/g)?.length, 2);
});

test("준비 검사는 Google 지원 ISO 248개국과 남은 출시 외부 게이트를 명시한다", () => {
  const result = spawnSync(process.execPath, ["scripts/verify-google-maps-release-readiness.mjs"], {
    cwd: new URL("..", import.meta.url),
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.status, "READY_FOR_EXTERNAL_VALIDATION");
  assert.ok(report.checks.every((item) => item.passed));
  assert.equal(report.enabledCountryCount, 248);
  assert.equal(report.coverageReviewedAt, "2026-09-01");
  assert.equal(report.coverageSource, "https://developers.google.com/maps/coverage");
  assert.equal(report.enabledCountries.length, 248);
  for (const countryCode of ["JP", "US", "CN", "MO", "DE", "BR", "ZA"]) {
    assert.ok(report.enabledCountries.includes(countryCode), countryCode);
  }
  for (const countryCode of ["KR", "ZZ", "AC"]) {
    assert.ok(!report.enabledCountries.includes(countryCode), countryCode);
  }
  assert.ok(!report.blockers.includes("BLOCKED_BY_USER_CREDENTIALS"));
  assert.ok(report.blockers.includes("BLOCKED_BY_RELEASE_CI_EVIDENCE"));
  assert.ok(!report.blockers.includes("BLOCKED_BY_NOTIFICATION_CONTENT_LOCALIZATION"));
  assert.ok(report.checks.some(item => item.name === "위치·안전 알림 10개 언어 표시 계약" && item.passed));
  assert.ok(report.blockers.includes("BLOCKED_BY_ANDROID_TIMEZONE_RELEASE"));
  assert.ok(report.blockers.includes("BLOCKED_BY_GOOGLE_ROUTES_OAUTH_SCOPE_PROOF"));
  assert.ok(report.blockers.includes("BLOCKED_BY_LIVE_NON_KR_DEVICE_E2E"));
});

test("release 모드는 외부 출시 증거가 완료되기 전까지 HOLD exit를 반환한다", () => {
  const result = spawnSync(process.execPath, ["scripts/verify-google-maps-release-readiness.mjs", "--release"], {
    cwd: new URL("..", import.meta.url),
    encoding: "utf8",
  });
  assert.equal(result.status, 1);
  assert.equal(JSON.parse(result.stdout).status, "HOLD");
});

test("사용자 승인 기기 생략은 통과로 표시하지 않고 다른 제출 gate를 유지한다", () => {
  const result = spawnSync(process.execPath, ["scripts/verify-google-maps-release-readiness.mjs", "--release", "--device-e2e-waived"], { cwd: new URL("..", import.meta.url), encoding: "utf8" });
  const report = JSON.parse(result.stdout);
  assert.equal(result.status, 1);
  assert.deepEqual(report.waivedChecks, ["LIVE_NON_KR_DEVICE_E2E_NOT_PERFORMED"]);
  assert.ok(!report.blockers.includes("BLOCKED_BY_LIVE_NON_KR_DEVICE_E2E"));
  assert.ok(report.blockers.includes("BLOCKED_BY_ANDROID_TIMEZONE_RELEASE"));
});

test("Android 출시 빌드는 Google 웹 키 누락을 사전 검사와 실제 빌드에서 차단한다", () => {
  const source = readFileSync(new URL("../scripts/build-android-release.ps1", import.meta.url), "utf8");
  assert.match(source, /GoogleMapsConfigured = \$values\.ContainsKey\(\$googleMapsName\)/);
  assert.match(source, /viteGoogleMapsKeyConfigured/);
  assert.match(source, /-or -not \$viteReleaseEnvironmentState\.GoogleMapsConfigured/);
  assert.match(source, /if \(-not \$viteReleaseEnvironmentState\.GoogleMapsConfigured\)/);
  assert.ok(source.indexOf("if (-not $viteReleaseEnvironmentState.GoogleMapsConfigured)") < source.indexOf("Write-Host '1/6"));
});
