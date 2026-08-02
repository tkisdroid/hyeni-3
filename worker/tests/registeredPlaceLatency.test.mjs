// 등록장소 도착 지연 개선 검증 — node --test worker/tests/registeredPlaceLatency.test.mjs
import test from "node:test";
import assert from "node:assert/strict";

import {
  evaluateRegisteredPlaceTransition,
  INITIAL_REGISTERED_PLACE_STATE,
  REGISTERED_PLACE_ACTIONS as A,
  SERVER_GEOFENCE_CONFIG,
  defaultRegisteredPlaceRadiusM,
  canonicalizeRegisteredPlaces,
} from "../shared/registeredPlaceGeofence.js";

const PLACE = { lat: 37.33, lng: 127.116 };
// 위도 1도 ≈ 111km → 1m ≈ 0.000009도
const mLat = (m) => m / 111_000;

function fixAt(distanceM, tMs) {
  return { lat: PLACE.lat + mLat(distanceM), lng: PLACE.lng, accuracy: null, tMs };
}

function run(fixes, place = PLACE) {
  let state = { ...INITIAL_REGISTERED_PLACE_STATE };
  const actions = [];
  for (const f of fixes) {
    const r = evaluateRegisteredPlaceTransition({
      state, fix: f, place, config: SERVER_GEOFENCE_CONFIG,
    });
    actions.push(r.action);
    state = r.nextState;
  }
  return { actions, state };
}

test("심부 진입(반경 60% 이내)은 90초 체류로 도착 승격된다", () => {
  const t0 = 1_000_000;
  const { actions } = run([
    fixAt(10, t0),            // 심부 진입(30m 반경의 10m) → pending
    fixAt(10, t0 + 95_000),   // 95초 뒤 여전히 심부 → ENTER(90s 단축)
  ]);
  assert.equal(actions[0], A.PENDING_DWELL);
  assert.equal(actions[1], A.ENTER);
});

test("경계 근처(반경 60% 밖)는 기존 180초 체류를 유지한다(옆 건물 통과 오탐 방지)", () => {
  const t0 = 1_000_000;
  const { actions } = run([
    fixAt(25, t0),             // 경계 근처 진입(30m 의 25m) → pending
    fixAt(25, t0 + 95_000),    // 95초 — 아직 아님
    fixAt(25, t0 + 185_000),   // 185초 → ENTER
  ]);
  assert.deepEqual(actions, [A.PENDING_DWELL, A.PENDING_CONTINUE, A.ENTER]);
});

test("학교류는 100m, 조부모댁은 레거시 핀 오차를 흡수하는 150m 기본 반경을 쓴다", () => {
  assert.equal(defaultRegisteredPlaceRadiusM("OO초등학교"), 100);
  assert.equal(defaultRegisteredPlaceRadiusM("학교"), 100);
  assert.equal(defaultRegisteredPlaceRadiusM("햇살 유치원"), 100);
  assert.equal(defaultRegisteredPlaceRadiusM("할머니댁"), 150);
  assert.equal(defaultRegisteredPlaceRadiusM("외할머니 집"), 150);
  assert.equal(defaultRegisteredPlaceRadiusM("할아버지댁"), 150);
  assert.equal(defaultRegisteredPlaceRadiusM("피아노 학원"), null);
  assert.equal(defaultRegisteredPlaceRadiusM("집"), null);
});

test("할머니댁 레거시 핀에서 101m 떨어진 고정밀 fix도 도착 판정을 시작한다", () => {
  const t0 = 1_000_000;
  const place = { ...PLACE, alertRadiusM: defaultRegisteredPlaceRadiusM("할머니댁") };
  const { actions } = run([fixAt(101, t0)], place);
  assert.equal(actions[0], A.PENDING_DWELL);
});

test("장소별 반경(alertRadiusM=100)이면 70m 지점도 진입으로 본다", () => {
  const t0 = 1_000_000;
  const place = { ...PLACE, alertRadiusM: 100 };
  const { actions } = run([
    fixAt(70, t0),             // 100m 반경의 70m → pending (30m 기본이면 밖)
    fixAt(20, t0 + 95_000),    // 심부(60m 이내)로 이동 + 95초 → ENTER
  ], place);
  assert.equal(actions[0], A.PENDING_DWELL);
  assert.equal(actions[1], A.ENTER);
});

test("canonicalize 는 명시 반경을 30~300 으로 클램프해 보존한다", () => {
  const out = canonicalizeRegisteredPlaces([
    { placeKey: "registered:saved_place:1", source: "saved_place", name: "학교", lat: 37.33, lng: 127.116, alertRadiusM: 1000 },
    { placeKey: "registered:saved_place:2", source: "saved_place", name: "집", lat: 37.34, lng: 127.117, alertRadiusM: 5 },
  ]);
  assert.equal(out[0].alertRadiusM, 300);
  assert.equal(out[1].alertRadiusM, 30);
});

test("출발은 기존 설계 유지 — 이탈 후 180초 뒤 LEAVE", () => {
  const t0 = 1_000_000;
  const { actions } = run([
    fixAt(5, t0),
    fixAt(5, t0 + 95_000),      // ENTER (deep 90s)
    fixAt(80, t0 + 200_000),    // 50m 밖 → OUTSIDE_ARMED
    fixAt(80, t0 + 290_000),    // 90초 — 아직
    fixAt(80, t0 + 385_000),    // 185초 → LEAVE
  ]);
  assert.deepEqual(actions, [A.PENDING_DWELL, A.ENTER, A.OUTSIDE_ARMED, A.OUTSIDE_PENDING_TIMER, A.LEAVE]);
});

// ── 2026-07-24 TK 제보 실사고 재생 (혜니, 집) ────────────────────────────────
// 프로덕션 D1 location_history 의 실제 fix 거리·정확도·시각을 그대로 재생해
// "도착·출발 알림이 실시간에 가까워졌는지"를 숫자로 고정한다.
import { evaluateRegisteredPlaceTimer } from "../shared/registeredPlaceGeofence.js";

const KST = (hhmmss) => Date.parse(`2026-07-24T${hhmmss}+09:00`);

// 실측: 07:15~07:26 집 진입 구간 (거리 m, 정확도 m, 시각 KST)
const MORNING_ARRIVAL_FIXES = [
  [15.8, 100, "07:15:08"], [15.2, 18.5, "07:15:14"], [15.5, 18.9, "07:15:20"],
  [37.5, 19.3, "07:15:35"], [47.2, 22.9, "07:15:42"], [66.2, 16.2, "07:15:58"],
  [48.9, 21.6, "07:16:10"], [39.9, 29.2, "07:16:29"], [27.0, 30.0, "07:16:44"],
  [23.3, 26.0, "07:16:58"], [25.2, 22.6, "07:17:13"], [30.7, 21.8, "07:17:28"],
  [33.9, 31.2, "07:17:43"], [31.8, 19.9, "07:18:57"], [27.7, 14.9, "07:19:31"],
  [25.5, 20.2, "07:20:01"], [23.1, 13.7, "07:20:16"], [19.3, 27.7, "07:22:16"],
  // ── 정지 상태라 업로드가 120초 간격 → 여기서 3분 46초 공백 ──
  [17.5, 18.5, "07:26:02"],
];

// 실측: 08:25~08:28 집 이탈 구간
const MORNING_DEPARTURE_FIXES = [
  [22.4, 17.9, "08:25:40"], [38.9, 20.1, "08:25:55"], [77.1, 4.1, "08:26:03"],
  [77.9, 7.9, "08:26:10"], [70.9, 13.2, "08:26:17"], [40.2, 8.3, "08:26:24"],
  [33.4, 9.3, "08:26:31"], [44.3, 4.8, "08:26:38"], [49.1, 4.4, "08:26:42"],
  [52.2, 3.4, "08:26:45"], [58.3, 4.6, "08:26:52"], [62.2, 3.4, "08:26:58"],
  [69.4, 4.7, "08:27:06"], [75.2, 3.1, "08:27:13"], [83.1, 4.3, "08:27:20"],
  [90.6, 5.1, "08:27:27"], [100.2, 3.7, "08:27:34"], [109.0, 5.3, "08:27:41"],
  [117.5, 6.3, "08:27:47"], [125.3, 8.0, "08:27:55"], [133.0, 6.4, "08:28:02"],
];

function replayReal(rows, initialState = { ...INITIAL_REGISTERED_PLACE_STATE }) {
  let state = initialState;
  for (const [distanceM, accuracy, hhmmss] of rows) {
    const tMs = KST(hhmmss);
    const r = evaluateRegisteredPlaceTransition({
      state,
      fix: { lat: PLACE.lat + mLat(distanceM), lng: PLACE.lng, accuracy, tMs },
      place: PLACE,
      config: SERVER_GEOFENCE_CONFIG,
    });
    state = r.nextState;
    if (r.action === A.ENTER || r.action === A.LEAVE) return { action: r.action, atMs: tMs, state };
  }
  return { action: null, atMs: null, state };
}

// 출발 재생은 "집에 머무는 중"(phase=in)에서 시작한다 — 아침 도착 에피소드의 연장.
const AT_HOME_STATE = Object.freeze({
  phase: "in",
  firstInsideAtMs: KST("07:19:31"),
  departureArmedAtMs: null,
  lastDepartedAtMs: null,
});

test("실사고 재생: 집 출발이 이탈 확정 타이머보다 2분 가까이 빨라진다", () => {
  const settled = replayReal(MORNING_DEPARTURE_FIXES, { ...AT_HOME_STATE });
  assert.equal(settled.action, A.LEAVE);
  // 08:26:45 에 armed → 기존 계약이면 180초 뒤 08:29:45 확정이었다.
  const legacySettleAtMs = KST("08:26:45") + SERVER_GEOFENCE_CONFIG.departureTimeoutMs;
  // 08:27:41 fix = 109.0m, 정확도 5.3m → 103.7m ≥ 100m(이탈반경 50m × 2)로 첫 확정.
  // 직전 08:27:34 는 100.2m − 3.7m = 96.5m 라 아직 확정하지 않는다.
  assert.equal(settled.atMs, KST("08:27:41"), "정확도를 뺀 거리가 100m 를 넘는 첫 fix 에서 확정해야 합니다");
  const savedMs = legacySettleAtMs - settled.atMs;
  assert.ok(savedMs >= 120_000, `출발 확정이 최소 120초 빨라져야 합니다(실제 ${Math.round(savedMs / 1000)}초)`);
});

test("실사고 재생: 경계 지터로 되돌아온 구간은 여전히 출발로 단정하지 않는다", () => {
  // 08:26:03~08:26:17 은 반경 밖이지만 08:26:24 에 다시 40m 로 돌아온다(지터).
  // 이 구간만 재생하면 어떤 알림도 나오면 안 된다.
  const jitterOnly = replayReal(MORNING_DEPARTURE_FIXES.slice(0, 7), { ...AT_HOME_STATE });
  assert.equal(jitterOnly.action, null, "돌아온 지터 구간에서 출발 알림이 나가면 안 됩니다");
});

test("실사고 재생: fix 공백 중에도 wall-clock 으로 도착이 확정된다", () => {
  // 마지막으로 관측한 fix 는 07:22:16(19.3m, 반경 안)이고 그 뒤 3분 46초간 fix 가 없었다.
  // 기존 계약은 다음 fix(07:26:02)까지 도착을 미뤘다.
  let state = { ...INITIAL_REGISTERED_PLACE_STATE };
  const upToGap = MORNING_ARRIVAL_FIXES.filter(([, , t]) => KST(t) <= KST("07:22:16"));
  for (const [distanceM, accuracy, hhmmss] of upToGap) {
    const r = evaluateRegisteredPlaceTransition({
      state,
      fix: { lat: PLACE.lat + mLat(distanceM), lng: PLACE.lng, accuracy, tMs: KST(hhmmss) },
      place: PLACE,
      config: SERVER_GEOFENCE_CONFIG,
    });
    state = r.nextState;
  }
  assert.equal(state.phase, "pending", "07:19:31 진입이 아직 dwell 중이어야 합니다");
  assert.equal(state.firstInsideAtMs, KST("07:19:31"));

  const lastFix = { lat: PLACE.lat + mLat(19.3), lng: PLACE.lng, accuracy: 27.7, tMs: KST("07:22:16") };
  // dwell 만족 직전(07:22:30)에는 아직 도착이 아니다.
  const early = evaluateRegisteredPlaceTimer({
    state, fix: lastFix, place: PLACE, nowMs: KST("07:22:30"), config: SERVER_GEOFENCE_CONFIG,
  });
  assert.equal(early.action, A.PENDING_CONTINUE);

  // 180초를 채운 07:22:31 에 도착 확정 — 실제 알림(07:24:04)보다 빠르고,
  // episode 시각은 실측 fix 시각(07:19:31)을 그대로 보존한다.
  const settled = evaluateRegisteredPlaceTimer({
    state, fix: lastFix, place: PLACE, nowMs: KST("07:22:31"), config: SERVER_GEOFENCE_CONFIG,
  });
  assert.equal(settled.action, A.ENTER);
  assert.equal(settled.nextState.firstInsideAtMs, KST("07:19:31"));
  assert.equal(settled.nextState.phase, "in");
});

test("타이머 진행은 오래된 fix 를 신뢰하지 않는다(좌표 frozen 가짜 전이 금지)", () => {
  const state = { phase: "pending", firstInsideAtMs: KST("07:19:31"), departureArmedAtMs: null, lastDepartedAtMs: null };
  const staleFix = { lat: PLACE.lat + mLat(19.3), lng: PLACE.lng, accuracy: 20, tMs: KST("07:22:16") };
  const result = evaluateRegisteredPlaceTimer({
    state, fix: staleFix, place: PLACE, nowMs: KST("07:40:00"), config: SERVER_GEOFENCE_CONFIG,
  });
  assert.equal(result.action, A.OUTSIDE_NO_CHANGE);
  assert.equal(result.nextState.phase, "pending", "상태를 진행시키면 안 됩니다");
});

test("타이머 진행은 이탈 확정도 wall-clock 으로 처리한다", () => {
  const armedAt = KST("08:26:45");
  const state = { phase: "in", firstInsideAtMs: KST("07:19:31"), departureArmedAtMs: armedAt, lastDepartedAtMs: null };
  const outFix = { lat: PLACE.lat + mLat(60), lng: PLACE.lng, accuracy: 10, tMs: armedAt + 60_000 };

  const pending = evaluateRegisteredPlaceTimer({
    state, fix: outFix, place: PLACE, nowMs: armedAt + 170_000, config: SERVER_GEOFENCE_CONFIG,
  });
  assert.equal(pending.action, A.OUTSIDE_PENDING_TIMER);

  const settled = evaluateRegisteredPlaceTimer({
    state, fix: outFix, place: PLACE, nowMs: armedAt + 181_000, config: SERVER_GEOFENCE_CONFIG,
  });
  assert.equal(settled.action, A.LEAVE);
  assert.equal(settled.nextState.lastDepartedAtMs, armedAt + 181_000);
});

test("조용한 재진입 에피소드는 타이머 확정에서도 SILENT_LEAVE 다", () => {
  const armedAt = KST("08:26:45");
  const state = { phase: "in", firstInsideAtMs: KST("08:20:00"), departureArmedAtMs: armedAt, lastDepartedAtMs: KST("08:10:00") };
  const outFix = { lat: PLACE.lat + mLat(60), lng: PLACE.lng, accuracy: 10, tMs: armedAt + 60_000 };
  const settled = evaluateRegisteredPlaceTimer({
    state, fix: outFix, place: PLACE, nowMs: armedAt + 181_000, config: SERVER_GEOFENCE_CONFIG,
  });
  assert.equal(settled.action, A.SILENT_LEAVE);
});
