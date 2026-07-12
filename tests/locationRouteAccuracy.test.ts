import test from "node:test";
import assert from "node:assert/strict";

import { splitLocationRouteSegments } from "../src/transform/locationRoute.ts";
import { isReliableLocationEvidence } from "../src/transform/locationAccuracy.ts";
import { readFileSync } from "node:fs";

test("오늘 경로의 추정 채움 구간은 실측 경로와 분리해 점선으로 그릴 수 있다", () => {
  const segments = splitLocationRouteSegments([
    { lat: 37.1, lng: 127.1, estimated: false },
    { lat: 37.2, lng: 127.2, estimated: true },
    { lat: 37.3, lng: 127.3, estimated: true },
    { lat: 37.4, lng: 127.4, estimated: false },
    { lat: 37.5, lng: 127.5, estimated: false },
  ]);

  assert.deepEqual(
    segments.map((segment) => ({ estimated: segment.estimated, count: segment.points.length })),
    [
      { estimated: true, count: 4 },
      { estimated: false, count: 2 },
    ],
  );
});

test("추정 채움점은 머문 곳·일정 방문의 실측 증거로 사용하지 않는다", () => {
  const stay = readFileSync(new URL("../src/transform/stayPoints.ts", import.meta.url), "utf8");
  const visit = readFileSync(new URL("../src/transform/visitVerify.ts", import.meta.url), "utf8");
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

  const stay = readFileSync(new URL("../src/transform/stayPoints.ts", import.meta.url), "utf8");
  const visit = readFileSync(new URL("../src/transform/visitVerify.ts", import.meta.url), "utf8");
  const location = readFileSync(new URL("../src/screens/parent/ParentLocation.tsx", import.meta.url), "utf8");
  assert.match(stay, /isReliableLocationEvidence\(p\)/);
  assert.match(visit, /isReliableLocationEvidence\(p\)/);
  assert.match(location, /estimated: !isReliableLocationEvidence\(p\)/);
});
