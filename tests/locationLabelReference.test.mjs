import "./helpers/appModuleResolve.mjs";
import test from "node:test";
import assert from "node:assert/strict";
const { labelForMeasuredLocation, locationLabelReferenceKey, stayLocationReference } = await import("../src/transform/locationLabelReference.ts");

const location = { user_id: "child", lat: 37.5, lng: 127, updated_at: "2026-09-13 01:00:00.000+00" };

test("응답의 실측 시각이 다른 장소명은 과거 위치에 붙이지 않는다", () => {
  assert.equal(labelForMeasuredLocation(location, { label: "이전 도착지", measuredAt: "2026-09-13T01:00:00.000Z" }), "이전 도착지");
  assert.equal(labelForMeasuredLocation(location, { label: "현재 다른 곳", measuredAt: "2026-09-13T02:00:00.000Z" }), null);
  assert.equal(labelForMeasuredLocation(location, { label: "시각 미상", measuredAt: null }), null);
  assert.notEqual(locationLabelReferenceKey(location), locationLabelReferenceKey({ ...location, user_id: "sibling" }));
  assert.notEqual(locationLabelReferenceKey(location), locationLabelReferenceKey({ ...location, updated_at: "2026-09-13T02:00:00Z" }));
});

test("머문 곳 조회는 같은 아이의 체류 시간 안 실측점만 선택하고 합성 중심점을 보내지 않는다", () => {
  const arrivalMs = Date.parse("2026-09-13T01:00:00Z");
  const stay = { lat: 37.5, lng: 127, arrivalMs, departureMs: arrivalMs + 10 * 60_000, dwellMs: 10 * 60_000, pointCount: 3 };
  const evidence = { user_id: "child", lat: 37.5001, lng: 127.0001, accuracy_m: 12, recorded_at: "2026-09-13 01:05:00.000+00" };
  const history = [
    { ...evidence, user_id: "sibling", lat: 37.5, lng: 127 },
    { ...evidence, lat: 37.5, lng: 127, is_estimated: 1 },
    { ...evidence, lat: 37.5, lng: 127, accuracy_m: 800 },
    { ...evidence, lat: 37.5, lng: 127, recorded_at: "2026-09-13T02:00:00Z" },
    evidence,
  ];
  assert.deepEqual(stayLocationReference(stay, history, "child"), {
    user_id: "child", lat: evidence.lat, lng: evidence.lng, accuracy_m: 12, updated_at: evidence.recorded_at,
  });
  assert.equal(stayLocationReference(stay, history, null), null);
  assert.equal(stayLocationReference(stay, history.slice(0, 4), "child"), null);
});
