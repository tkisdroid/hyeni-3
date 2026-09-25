// 시간대 선택지 — IANA 이름만 400여 개 나열하던 문제(2026-09-25 브라우저 QA) 회귀 가드.
import "./helpers/appModuleResolve.mjs";
import test from "node:test";
import assert from "node:assert/strict";

const { orderedTimeZones, timeZoneOptionLabel } = await import("../src/region/timeZoneOptions.ts");

test("시간대 라벨은 현재 언어의 시간대 이름과 도시를 함께 보여 준다", () => {
  const ko = timeZoneOptionLabel("Asia/Seoul", "ko-KR");
  assert.match(ko, /Seoul$/);
  assert.notEqual(ko, "Asia/Seoul");
  assert.match(timeZoneOptionLabel("America/New_York", "en-US"), /New York$/);
});

test("현재 값과 기기 시간대를 맨 앞에 두고 중복 없이 나열한다", () => {
  const zones = orderedTimeZones("Asia/Seoul", "Europe/Paris");
  assert.deepEqual(zones.slice(0, 2), ["Asia/Seoul", "Europe/Paris"]);
  assert.equal(new Set(zones).size, zones.length);
  assert.ok(zones.includes("UTC"));
});
