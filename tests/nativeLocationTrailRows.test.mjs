import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => readFileSync(resolve(rootDir, path), "utf8");

const service = read("android/app/src/main/java/com/hyeni/calendar/LocationService.java");

test("네이티브는 합성 보간 채움점을 더 만들지 않는다", () => {
  // 2026-07-29 실사고: 12m 간격 채움점(is_estimated=1)이 하루 이력의 70%를 차지해
  // 업로드·D1 행이 3배로 불고 부모 경로가 점선으로 끊겨 보였다.
  assert.doesNotMatch(service, /interpolateLinearPath/);
  assert.doesNotMatch(service, /estimatedFill/);
  assert.doesNotMatch(service, /put\("is_estimated"/);
});

test("도로매칭 게이트(150m)와 실측 accuracy 기록은 유지한다", () => {
  assert.match(service, /ROUTE_MATCH_MIN_GAP_M = 150f/);
  assert.match(service, /distanceBetween\(lastHistoryLat, lastHistoryLng, lat, lng\) > ROUTE_MATCH_MIN_GAP_M/);
  assert.match(service, /fetchWalkingRoutePoints\(lastHistoryLat, lastHistoryLng, lat, lng\)/);
  assert.match(service, /row\.put\("accuracy_m", accuracy\)/);
  // 실측 fix 는 항상 마지막 점으로 포함된다.
  assert.match(service, /points\.add\(new RoutePoint\(lat, lng\)\)/);
});

test("클라이언트 경로 계산은 과거 채움점 데이터도 계속 걸러낸다", () => {
  // 이미 저장된 is_estimated=1 행(오늘 이전 기록)은 그대로 남으므로 화면 필터를 유지해야 한다.
  const trail = read("src/transform/locationHistoryScrub.ts");
  assert.match(trail, /isInterpolatedFillPoint/);
});
