// 서버 사이드(Edge) 위험지역(danger_zone) 진입 판정 — danger 전용 상수·문구 모듈.
//
// (geofence-3, 2026-06-09) 위험지역 근접(emergency)은 기존에 오직 부모 기기의
// 포그라운드 useEffect 에서만 평가돼, 부모/자녀 앱이 백그라운드/종료면 가장 심각한
// 안전 신호가 전혀 발사되지 않았다. 등록장소(info)·미등록 체류(info)에는 서버 cron
// 백업이 있는데 정작 위험지역엔 없던 "신뢰성 역전"을 메운다.
//
// 상태 머신(evaluateRegisteredPlaceTransition)·멱등키(placePresenceIdempotencyKey)는
// registeredPlaceGeofence.js 를 그대로 재사용한다 — danger 는 config(짧은 dwell·가변
// 반경)와 alert 문구(emergency)만 다르다. place.alertRadiusM 에 zone.radius_m 를 넘기면
// resolveRadii 가 진입=radius_m, 이탈=radius_m*1.5(exit/entry ratio) 히스테리시스를
// 자동 적용한다. 클라(src/App.jsx danger effect)도 동일 멱등키를 써서 3발사원
// (부모FG/서버cron/자녀네이티브)이 (event_id, alert_type) 으로 1행 dedup 된다.

import { placePresenceIdempotencyKey } from "./registeredPlaceGeofence.js";

// danger 전용 config. registered(SERVER_GEOFENCE_CONFIG)와 차이:
//   - dwellMs 30s(60s→30s): emergency 라 빠르되 GPS 단발 노이즈는 거른다.
//   - exit/entry ratio 1.5(50/30=1.667→45/30=1.5): 클라 effect(dist>radius*1.5
//     이탈)와 정확히 일치하는 히스테리시스.
//   - entryRadiusM/exitRadiusM 는 zone.radius_m 가 없을 때만 쓰이는 floor.
//     실 위험지역은 radius_m(기본 200)이 항상 있어 가변 반경이 우선한다.
export const DANGER_GEOFENCE_CONFIG = Object.freeze({
    entryRadiusM: 30,
    exitRadiusM: 45,
    maxAccuracyM: 75,
    dwellMs: 30_000,
    cooldownMs: 10 * 60_000,
    departureTimeoutMs: 180_000,
});

export function isUsableDangerFixAccuracy(value) {
    const accuracy = Number(value);
    return value != null
        && Number.isFinite(accuracy)
        && accuracy >= 0
        && accuracy <= DANGER_GEOFENCE_CONFIG.maxAccuracyM;
}

// place_key 네임스페이스 — registered("registered:*")와 분리해 child_place_presence
// 를 공유 테이블로 재사용한다.
export function dangerZonePlaceKey(zoneId) {
    return `danger:${zoneId}`;
}

// 주격 조사 이/가 — 한글 받침 여부로 분기(클라 withParticle 과 동일 규칙).
// _shared 모듈은 src/ 를 import 할 수 없어 인라인.
function subjectParticle(word) {
    const s = String(word || "");
    if (!s) return "이";
    const last = s.charCodeAt(s.length - 1);
    if (last < 0xac00 || last > 0xd7a3) return "이"; // 한글 음절이 아니면 기본값
    return (last - 0xac00) % 28 !== 0 ? "이" : "가";
}

// 부모-facing emergency 카피. 클라 App.jsx danger effect 의 title/message 톤과 일관:
//   title  "⚠️ 조심할 곳 접근 알림"
//   message "{childName}{이/가} '{zone}' 근처에 있어요!"
// 서버는 매 fix 평가라 클라처럼 거리(m)를 넣지 않는다.
export function buildDangerZoneAlert(childName, zoneName) {
    const name = (childName || "아이").trim() || "아이";
    const zone = (zoneName || "조심할 곳").trim() || "조심할 곳";
    const subject = `${name}${subjectParticle(name)}`;
    return {
        alertType: "danger_zone",
        metadata: { notificationCopy: { v: 1, id: "dangerEnter", args: { child: childName || "", place: zoneName || "" } } },
        severity: "emergency",
        title: "⚠️ 조심할 곳 접근 알림",
        message: `${subject} '${zone}' 근처에 있어요!`,
    };
}

export function buildDangerZoneExitAlert(childName, zoneName) {
    const name = (childName || "아이").trim() || "아이";
    const zone = (zoneName || "조심할 곳").trim() || "조심할 곳";
    const subject = `${name}${subjectParticle(name)}`;
    return {
        alertType: "danger_exit",
        metadata: { notificationCopy: { v: 1, id: "dangerExit", args: { child: childName || "", place: zoneName || "" } } },
        severity: "info",
        title: "✅ 조심할 곳 벗어남",
        message: `${subject} '${zone}' 근처에서 벗어났어요.`,
    };
}

// ── cross-process dedup (클라 FG + 서버 cron 10분 버킷 straddle) ───────────────
// 부모 FG 클라는 실시간 첫 inside fix 로, 서버 cron 은 dwell(30s)+폴링으로 더 늦은
// fix 로 같은 진입을 키잉한다(child_locations 가 단일 최신행이라 서버가 본 "첫
// inside"가 더 늦음). 둘이 10분 경계를 straddle 하면 다른 멱등키 → (event_id,
// alert_type)·push dedup 회피 → emergency 2발사. 서버는 항상 클라보다 늦으므로
// (서버 bucket ≥ 클라 bucket), 서버가 ENTER 발사 전 직전 버킷(bucket-1, bucket-2)의
// danger_enter 키가 최근(window) 내 이미 발사됐는지 확인해 중복을 막는다.
// window(5분)는 클·서버 발사 skew(~3분)를 흡수하되 재진입 cooldown(10분)보다 짧아
// 정상 재진입(옛 에피소드 알림)은 억제하지 않는다.
export const CROSS_PROCESS_DEDUP_WINDOW_MS = 5 * 60_000;

export function dangerDedupCandidateKeys(childUserId, placeKey, currentBucket) {
    const b = Math.floor(Number(currentBucket));
    if (!Number.isFinite(b)) return [];
    return [b - 1, b - 2].map((bk) =>
        placePresenceIdempotencyKey("danger_enter", childUserId, placeKey, bk));
}

// priorAlerts: [{ eventId, createdAtMs }] — 최근 danger_zone parent_alerts.
// candidateKeys 중 하나와 일치하고 nowMs 기준 windowMs 이내(미래 아님)면 중복.
export function isRecentDuplicateDangerAlert(priorAlerts, candidateKeys, nowMs, windowMs = CROSS_PROCESS_DEDUP_WINDOW_MS) {
    if (!Array.isArray(priorAlerts) || !priorAlerts.length) return false;
    const keys = new Set(candidateKeys || []);
    if (!keys.size) return false;
    return priorAlerts.some((a) => {
        if (!a || !keys.has(a.eventId) || !Number.isFinite(a.createdAtMs)) return false;
        const age = nowMs - a.createdAtMs;
        return age >= 0 && age <= windowMs;
    });
}
