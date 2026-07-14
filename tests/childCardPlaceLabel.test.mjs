/**
 * 아이 현황 현재위치 라벨 우선순위 가드 (2026-07-14 TK 제보).
 * 일정 장소("X 근처")는 등록 장소보다 **더 가까울 때만** 이긴다.
 * 등록 장소(100m 반경)가 더 가깝거나 동률이면 등록 장소명이 자연스럽다
 * (실사례: 학교가 더 가까운데 다음 일정인 피아노 학원 근처로 표시됨).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const home = readFileSync(resolve(rootDir, "src/screens/parent/ParentHome.tsx"), "utf8");

test("일정 장소 라벨은 거리와 함께 판정된다", () => {
  assert.match(home, /function schedulePlaceHit\(/);
  assert.match(home, /\{ label: `\$\{eventTitleForPlace\(hit\.raw, hit\.view\)\} 근처`, distanceM: hit\.distance \}/);
});

test("등록 장소가 더 가깝거나 동률이면 일정 장소 라벨을 쓰지 않는다", () => {
  assert.match(home, /nearestPlace\(kidLoc, places \?\? \[\]\)/);
  assert.match(home, /savedHit\.distanceM <= EXACT_SAVED_PLACE_LABEL_RADIUS_M/);
  // 엄격 부등호(<) — 동률이면 등록 장소명 우선.
  assert.match(home, /eventHit && \(!savedNearby \|\| eventHit\.distanceM < savedNearby\.distanceM\)/);
});
