import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  REGISTERED_PLACE_ACTIONS,
  SERVER_GEOFENCE_CONFIG,
  canonicalizeRegisteredPlaces,
  evaluateRegisteredPlaceTransition,
} from "../shared/registeredPlaceGeofence.js";

test("등록장소는 같은 물리 장소 중복 등록을 한 번만 평가한다", () => {
  const places = canonicalizeRegisteredPlaces([
    {
      placeKey: "registered:academy:a9b9",
      source: "academy",
      name: "태권도",
      lat: 37.32863289741469,
      lng: 127.11429906950715,
    },
    {
      placeKey: "registered:saved_place:c274",
      source: "saved_place",
      name: "태권도 학원",
      lat: 37.32858118076739,
      lng: 127.11420308385253,
    },
  ]);

  assert.equal(places.length, 1);
  assert.equal(places[0].placeKey, "registered:saved_place:c274");
  assert.equal(places[0].name, "태권도 학원");
});

test("등록장소는 옆 건물까지 같은 장소로 합치지 않는다", () => {
  const places = canonicalizeRegisteredPlaces([
    {
      placeKey: "registered:saved_place:piano",
      source: "saved_place",
      name: "피아노 학원",
      lat: 37.32905577788697,
      lng: 127.11492311155779,
    },
    {
      placeKey: "registered:saved_place:taekwondo",
      source: "saved_place",
      name: "태권도 학원",
      lat: 37.32858118076739,
      lng: 127.11420308385253,
    },
  ]);

  assert.equal(places.length, 2);
});

test("등록장소는 경계 근처 3분 미만 통과를 도착으로 승격하지 않는다", () => {
  // 옆 건물 통과 오탐 시나리오 = 반경 경계 근처 fix. 2026-07-10 심부 진입은 90초로
  // 단축됐으므로(registeredPlaceLatency.test.mjs) 이 가드는 경계(25m/30m)로 검증한다.
  const state = {
    phase: "pending",
    firstInsideAtMs: 0,
    departureArmedAtMs: null,
    lastDepartedAtMs: null,
  };
  const result = evaluateRegisteredPlaceTransition({
    state,
    fix: { lat: 37.32905577788697 + 25 / 111_000, lng: 127.11492311155779, accuracy: null, tMs: 119_000 },
    place: { lat: 37.32905577788697, lng: 127.11492311155779, alertRadiusM: 30 },
    config: SERVER_GEOFENCE_CONFIG,
  });

  assert.equal(result.action, REGISTERED_PLACE_ACTIONS.PENDING_CONTINUE);
});

// ── 2026-07-16 이동 알림 현실화 회귀 (TK 제보: "학교 출발" 직후 "집 도착" 연발,
//    같은 장소 "출발" 중복, 도착 후 이전 장소 출발 순서 역전) ─────────────────────
import {
  INITIAL_REGISTERED_PLACE_STATE,
  buildPlaceArrivedAlert,
  isStaleRegisteredPlaceLeave,
  planRegisteredPlacePresenceDelivery,
} from "../shared/registeredPlaceGeofence.js";

const CFG = SERVER_GEOFENCE_CONFIG;
const P = { lat: 37.33, lng: 127.116 };
const inFix = (tMs) => ({ lat: P.lat, lng: P.lng, accuracy: null, tMs });
// 200m — 이탈 반경(50m)의 2배를 넘어 "확실한 이탈"로 즉시 확정되는 거리.
const outFix = (tMs) => ({ lat: P.lat + 200 / 111_000, lng: P.lng, accuracy: null, tMs });
// 70m — 반경 밖이지만 지터 가능 구간이라 기존 180초 이탈 타이머를 그대로 타는 거리.
const nearOutFix = (tMs) => ({ lat: P.lat + 70 / 111_000, lng: P.lng, accuracy: null, tMs });

function replay(state, fixes) {
  const actions = [];
  for (const f of fixes) {
    const r = evaluateRegisteredPlaceTransition({ state, fix: f, place: P, config: CFG });
    actions.push(r.action);
    state = r.nextState;
  }
  return { actions, state };
}

test("정상 도착 에피소드의 출발은 그대로 LEAVE 알림이다", () => {
  const t0 = 1_000_000;
  const { actions } = replay({ ...INITIAL_REGISTERED_PLACE_STATE }, [
    inFix(t0), inFix(t0 + 200_000),                     // pending → ENTER(180s dwell)
    nearOutFix(t0 + 300_000), nearOutFix(t0 + 500_000), // armed → LEAVE(180s departure)
  ]);
  assert.equal(actions[1], REGISTERED_PLACE_ACTIONS.ENTER);
  assert.equal(actions[3], REGISTERED_PLACE_ACTIONS.LEAVE);
});

test("조용한 재진입(SILENT_RE_ENTER) 에피소드의 출발은 SILENT_LEAVE — 중복 출발 알림 금지", () => {
  const t0 = 1_000_000;
  // 도착 → 출발(LEAVE) → 쿨다운 내 재진입(SILENT_RE_ENTER) → 다시 이탈 확정
  const r1 = replay({ ...INITIAL_REGISTERED_PLACE_STATE }, [
    inFix(t0), inFix(t0 + 200_000),
    nearOutFix(t0 + 300_000), nearOutFix(t0 + 500_000),  // LEAVE (lastDeparted=t0+500s)
    inFix(t0 + 560_000),                                  // 쿨다운(10분) 내 → SILENT_RE_ENTER
    nearOutFix(t0 + 600_000), nearOutFix(t0 + 800_000),   // armed → 이탈 확정
  ]);
  assert.equal(r1.actions[3], REGISTERED_PLACE_ACTIONS.LEAVE);
  assert.equal(r1.actions[4], REGISTERED_PLACE_ACTIONS.SILENT_RE_ENTER);
  assert.equal(r1.actions[6], REGISTERED_PLACE_ACTIONS.SILENT_LEAVE);
  // 상태(쿨다운 앵커)는 계속 진행된다.
  assert.equal(r1.state.phase, "out");
  assert.equal(r1.state.lastDepartedAtMs, t0 + 800_000);
});

// ── 2026-07-24 출발 알림 지연 개선 ────────────────────────────────────────────
test("확실히 멀어진 이탈은 180초 타이머를 기다리지 않고 즉시 LEAVE 한다", () => {
  const t0 = 1_000_000;
  const { actions, state } = replay({ ...INITIAL_REGISTERED_PLACE_STATE }, [
    inFix(t0), inFix(t0 + 200_000),   // ENTER
    outFix(t0 + 300_000),             // 200m — 지터로 설명 안 되는 거리 → 즉시 확정
  ]);
  assert.equal(actions[2], REGISTERED_PLACE_ACTIONS.LEAVE);
  assert.equal(state.lastDepartedAtMs, t0 + 300_000);
});

test("조기 이탈 확정도 조용한 에피소드에서는 SILENT_LEAVE 를 지킨다", () => {
  const t0 = 1_000_000;
  const { actions } = replay({ ...INITIAL_REGISTERED_PLACE_STATE }, [
    inFix(t0), inFix(t0 + 200_000),
    outFix(t0 + 300_000),      // LEAVE
    inFix(t0 + 360_000),       // 쿨다운 내 재진입 → SILENT_RE_ENTER
    outFix(t0 + 420_000),      // 멀리 이탈 — 알림 없이 상태만 진행해야 한다
  ]);
  assert.equal(actions[3], REGISTERED_PLACE_ACTIONS.SILENT_RE_ENTER);
  assert.equal(actions[4], REGISTERED_PLACE_ACTIONS.SILENT_LEAVE);
});

test("정확도가 나쁘면 조기 이탈로 단정하지 않는다(지터 보호)", () => {
  const t0 = 1_000_000;
  // 거리 120m 지만 정확도 오차가 ±60m — 실제로는 반경 밖 60m 일 수도 있어 타이머를 탄다.
  const noisyOut = (tMs) => ({ lat: P.lat + 120 / 111_000, lng: P.lng, accuracy: 60, tMs });
  const { actions } = replay({ ...INITIAL_REGISTERED_PLACE_STATE }, [
    inFix(t0), inFix(t0 + 200_000),
    noisyOut(t0 + 300_000),
  ]);
  assert.equal(actions[2], REGISTERED_PLACE_ACTIONS.OUTSIDE_ARMED);
});

test("배치 전달 계획: 출발+다른 장소 도착은 시간순 정렬 후 도착 1건으로 병합된다", () => {
  const plan = planRegisteredPlacePresenceDelivery([
    // 장소 배열 순서가 시간 역순이어도(집 도착이 먼저 수집돼도) episode 로 정렬된다.
    { kind: "enter", placeKey: "registered:saved_place:home", placeName: "집", episodeMs: 2_000 },
    { kind: "leave", placeKey: "registered:saved_place:school", placeName: "학교", episodeMs: 1_000 },
  ]);
  assert.equal(plan.length, 2);
  assert.equal(plan[0].kind, "leave");
  assert.equal(plan[0].deliver, false, "출발은 별도 알림 대신 도착에 병합");
  assert.equal(plan[1].kind, "enter");
  assert.equal(plan[1].deliver, true);
  assert.equal(plan[1].fromPlaceName, "학교");
});

test("배치 전달 계획: 같은 장소의 도착·출발(정상 방문 사이클)은 병합하지 않는다", () => {
  const plan = planRegisteredPlacePresenceDelivery([
    { kind: "enter", placeKey: "k1", placeName: "집", episodeMs: 1_000 },
    { kind: "leave", placeKey: "k1", placeName: "집", episodeMs: 2_000 },
  ]);
  assert.deepEqual(plan.map((p) => p.deliver), [true, true]);
});

test("병합된 도착 카피는 출발 장소를 함께 전한다", () => {
  const merged = buildPlaceArrivedAlert("혜니", "집", "학교");
  assert.equal(merged.title, "✅ 집 도착");
  assert.equal(merged.message, "혜니가 학교에서 출발해서 집에 도착했어요.");
  const plain = buildPlaceArrivedAlert("혜니", "집");
  assert.equal(plain.message, "혜니가 집에 도착했어요.");
});

test("늦은 출발 억제: 최근 다른 장소 도착 후의 출발만 억제하고, 같은 장소·오래된 도착은 유지", () => {
  const nowMs = 10 * 60_000 * 100;
  const arrivalOther = { title: "✅ 피아노 학원 도착", createdAtMs: nowMs - 2 * 60_000 };
  assert.equal(
    isStaleRegisteredPlaceLeave({ placeName: "학교", recentArrival: arrivalOther, nowMs }),
    true,
    "피아노 도착 직후 흘러온 학교 출발은 순서 역전 소음",
  );
  assert.equal(
    isStaleRegisteredPlaceLeave({ placeName: "피아노 학원", recentArrival: arrivalOther, nowMs }),
    false,
    "같은 장소 재출발은 정상",
  );
  const arrivalOld = { title: "✅ 피아노 학원 도착", createdAtMs: nowMs - 20 * 60_000 };
  assert.equal(
    isStaleRegisteredPlaceLeave({ placeName: "학교", recentArrival: arrivalOld, nowMs }),
    false,
    "15분 창 밖 도착은 억제 근거가 아니다",
  );
  assert.equal(isStaleRegisteredPlaceLeave({ placeName: "학교", recentArrival: null, nowMs }), false);
});

test("일반 등록장소 알림의 quiet 억제도 상태 전이 성공이다", () => {
  const deliver = readFileSync(new URL("../cron/_deliver.ts", import.meta.url), "utf8");
  const geofence = readFileSync(
    new URL("../cron/registered-place-geofence-check.ts", import.meta.url),
    "utf8",
  );
  assert.match(deliver, /suppressedQuietHours/);
  assert.match(geofence, /pushOk\s*&&\s*alertId/);
  assert.doesNotMatch(geofence, /quietHours[\s\S]*persistPlacePresence/);
});
