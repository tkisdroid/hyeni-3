import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { isUsableDangerFixAccuracy } from "../shared/dangerZoneGeofence.js";

test("위험구역 판정은 정확도 미보고·75m 초과 좌표를 근거로 쓰지 않는다", () => {
  assert.equal(isUsableDangerFixAccuracy(null), false);
  assert.equal(isUsableDangerFixAccuracy(undefined), false);
  assert.equal(isUsableDangerFixAccuracy(-1), false);
  assert.equal(isUsableDangerFixAccuracy(75), true);
  assert.equal(isUsableDangerFixAccuracy(75.1), false);

  const source = readFileSync(new URL("../cron/danger-zone-geofence-check.ts", import.meta.url), "utf8");
  assert.match(source, /isUsableDangerFixAccuracy\(child\.accuracyM\)/);
  assert.match(source, /accuracy:\s*child\.accuracyM/);
  assert.doesNotMatch(source, /accuracy:\s*null/);
});

test("위험구역 이탈은 긴급 전체화면 타입으로 승격하지 않는다", () => {
  const source = readFileSync(new URL("../lib/notificationRouting.ts", import.meta.url), "utf8");
  const emergencySet = source.slice(
    source.indexOf("const EMERGENCY_ALERT_TYPES"),
    source.indexOf("]);", source.indexOf("const EMERGENCY_ALERT_TYPES")) + 3,
  );
  assert.doesNotMatch(emergencySet, /danger_exit/);
  assert.match(emergencySet, /danger_zone/);
});
