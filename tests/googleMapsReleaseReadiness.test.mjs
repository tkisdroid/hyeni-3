import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

test("준비 검사는 활성 9개국과 남은 출시 외부 게이트를 명시한다", () => {
  const result = spawnSync(process.execPath, ["scripts/verify-google-maps-release-readiness.mjs"], {
    cwd: new URL("..", import.meta.url),
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.status, "READY_FOR_EXTERNAL_VALIDATION");
  assert.ok(report.checks.every((item) => item.passed));
  assert.deepEqual(report.enabledCountries, ["JP", "TW", "HK", "SG", "VN", "TH", "ID", "MY", "PH"]);
  assert.ok(!report.blockers.includes("BLOCKED_BY_USER_CREDENTIALS"));
  assert.ok(report.blockers.includes("BLOCKED_BY_TIMEZONE_GATE"));
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
