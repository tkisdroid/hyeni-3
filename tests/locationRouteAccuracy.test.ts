import test from "node:test";
import assert from "node:assert/strict";

import { isInterpolatedFillPoint } from "../src/transform/locationRoute.ts";
import { isReliableLocationEvidence } from "../src/transform/locationAccuracy.ts";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("직선 보간 채움점만 경로에서 제외하고 저정확도 실측점은 남긴다", () => {
  assert.equal(isInterpolatedFillPoint({ is_estimated: true }), true);
  assert.equal(isInterpolatedFillPoint({ is_estimated: 1 }), true);
  assert.equal(isInterpolatedFillPoint({ is_estimated: false }), false);
  assert.equal(isInterpolatedFillPoint({ is_estimated: 0 }), false);
  assert.equal(isInterpolatedFillPoint({}), false);
});

test("오늘 경로 폴리라인은 전 구간 실선 하나로 그린다(점선 강등 없음)", () => {
  const map = read("src/components/KakaoMap.tsx");
  const routeBlock = map.slice(map.indexOf("// 경로 폴리라인"), map.indexOf("// 스테이포인트"));

  assert.match(routeBlock, /strokeStyle: "solid"/);
  assert.doesNotMatch(routeBlock, /shortdash/);
  assert.doesNotMatch(routeBlock, /estimated/);
  // 경로가 있으면 머문 곳 순서 연결선을 겹쳐 그리지 않는다(두 겹 선 방지).
  assert.match(map, /if \(stays\.length >= 2 && !\(route && route\.length >= 2\)\)/);
  assert.ok(!/strokeStyle: "shortdash"/.test(map), "지도에 점선 폴리라인이 남아 있다");
});

test("부모 오늘 경로는 실측점만 이어 그린다", () => {
  const trail = read("src/transform/locationHistoryScrub.ts");
  const location = read("src/screens/parent/ParentLocation.tsx");
  assert.match(trail, /\.filter\(\(p\) => !isInterpolatedFillPoint\(p\)\)/);
  assert.match(location, /buildTrailPoints\(visibleHistory, selected\?\.user_id \?\? null\)/);
  assert.doesNotMatch(location, /추정 구간/);
});

test("추정 채움점은 머문 곳·일정 방문의 실측 증거로 사용하지 않는다", () => {
  const stay = read("src/transform/stayPoints.ts");
  const visit = read("src/transform/visitVerify.ts");
  assert.match(stay, /p\.is_estimated !== true && p\.is_estimated !== 1/);
  assert.match(visit, /p\.is_estimated !== true && p\.is_estimated !== 1/);
});

test("정확도 미보고·75m 초과 위치는 머문 곳과 일정 방문 근거로 쓰지 않는다", () => {
  assert.equal(isReliableLocationEvidence({ accuracy_m: null }), false);
  assert.equal(isReliableLocationEvidence({}), false);
  assert.equal(isReliableLocationEvidence({ accuracy_m: -1 }), false);
  assert.equal(isReliableLocationEvidence({ accuracy_m: 75 }), true);
  assert.equal(isReliableLocationEvidence({ accuracy_m: 75.1 }), false);
  assert.equal(isReliableLocationEvidence({ accuracy_m: 10, is_estimated: true }), false);

  const stay = read("src/transform/stayPoints.ts");
  const visit = read("src/transform/visitVerify.ts");
  assert.match(stay, /isReliableLocationEvidence\(p\)/);
  assert.match(visit, /isReliableLocationEvidence\(p\)/);
});
