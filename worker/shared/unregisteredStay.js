// supabase/functions/_shared/unregisteredStay.js
// Phase D copy + idempotency for the unregistered-stay (체류 역지오코딩) alert.
// Parent-facing copy is 존댓말 (copy-tone rule), consistent with
// _shared/registeredPlaceGeofence.js buildPlaceArrivedAlert. Idempotency reuses the
// deterministic cyrb128 UUID generator so a re-tick dedups on push_idempotency.
//
// 도착/출발 대칭(2026-06-12): 등록장소 place_arrived/place_left 와 짝을 맞춰
// 미등록 체류도 진입(unregistered_stay) + 종료(unregistered_stay_left) 두 알림을 낸다.
// 에피소드 상태는 child_stay_presence.last_episode_start_ms 의 부호로 인코딩한다
// (스키마 무변경 제약). 양수 = OPEN(진입 알림만 발사, 출발 알림 대기),
// 음수/null = CLOSED(진입·출발 모두 발사 완료 또는 진입 전). 부호 인코딩은
// resolveStayEpisode()/closedEpisodeStartMarker() 로 단일화한다.

import { placePresenceIdempotencyKey } from "./registeredPlaceGeofence.js";

// 같은 (childUserId, gridKey, episode N분 버킷) → 동일 UUID. namespace "unregistered_stay"
// 로 등록장소 geofence 멱등키(arrived/left)와 충돌하지 않는다.
export function stayEpisodeIdempotencyKey(childUserId, gridKey, episodeBucket) {
    return placePresenceIdempotencyKey("unregistered_stay", childUserId, gridKey, episodeBucket);
}

// 출발(체류 종료) 멱등키. namespace "unregistered_stay_left" 로 진입 멱등키와도
// 분리 → 같은 에피소드의 진입/출발이 각각 정확히 1회 dedup 된다.
export function stayLeftEpisodeIdempotencyKey(childUserId, gridKey, episodeBucket) {
    return placePresenceIdempotencyKey("unregistered_stay_left", childUserId, gridKey, episodeBucket);
}

// ── 에피소드 상태 (last_episode_start_ms 부호 인코딩, 순수 함수) ─────────────
// 양수 startMs  → OPEN  (진입 알림 발사됨, 출발 알림 대기)
// 음수 / null   → CLOSED(진입 전이거나 진입·출발 모두 발사 완료)
// 부호로 인코딩하는 이유: child_stay_presence 에 별도 상태 컬럼을 추가하지 않고
// (마이그레이션 범위 밖) 기존 컬럼 하나로 2-state 머신을 표현하기 위함.

// OPEN 에피소드의 startMs 를 돌려준다(OPEN 이 아니면 null). startMs 는 항상 양수
// epoch ms 이므로 음수/0/null 은 OPEN 이 아니다.
export function openEpisodeStartMs(lastEpisodeStartMs) {
    const v = Number(lastEpisodeStartMs);
    return Number.isFinite(v) && v > 0 ? v : null;
}

// CLOSED 마커(=출발 알림까지 발사 완료)로 저장할 값. 원래 startMs 의 음수.
// 부호만 뒤집으므로 |마커| 로 어떤 에피소드였는지도 복원 가능하다.
export function closedEpisodeStartMarker(episodeStartMs) {
    const v = Number(episodeStartMs);
    if (!Number.isFinite(v) || v === 0) return -1;
    return -Math.abs(v);
}

// 진입(arrival) 알림을 또 내야 하는 같은 에피소드인지: OPEN 이고, 그 startMs 가
// 현재 dwell.startMs 와 같은 버킷(EPISODE_BUCKET_MS) 안에 있으면 같은 에피소드다.
// CLOSED(음수/null)면 항상 false → 출발 뒤 진짜 재방문은 (cooldown 게이트 하에)
// 다시 진입 알림을 받을 수 있다.
export function isSameOpenArrivalEpisode(lastEpisodeStartMs, dwellStartMs, episodeBucketMs) {
    const openStart = openEpisodeStartMs(lastEpisodeStartMs);
    if (openStart == null) return false;
    return Math.abs(openStart - Number(dwellStartMs)) < Number(episodeBucketMs);
}

// 부모-facing 존댓말 카피. areaLabel 이 있으면 "○○동 근처", 없으면 좌표 폴백 라벨을
// 호출부에서 넣는다(여기선 빈 라벨이면 '한 곳' 으로 표기).
export function buildUnregisteredStayAlert(childName, areaLabel, durationLabel) {
    const name = (childName || "아이").trim() || "아이";
    const area = (areaLabel || "").trim();
    const duration = (durationLabel || "").trim();
    const place = area || "한 곳";
    const durationPart = duration ? `${duration} 째 ` : "";
    return {
        alertType: "unregistered_stay",
        severity: "info",
        title: area ? `📍 ${area} 근처 도착` : "📍 새로운 장소 도착",
        message: `${name}가 ${place} 근처에 ${durationPart}머물고 있어요.`,
    };
}

// 부모-facing 존댓말 출발 카피. 진입 카피와 톤 일관(등록장소 place_left 와도 일관).
// areaLabel 이 있으면 "○○동 근처에서", 없으면 "머물던 곳에서".
function distanceM(aLat, aLng, bLat, bLng) {
    const toRad = (deg) => (deg * Math.PI) / 180;
    const dLat = toRad(bLat - aLat);
    const dLng = toRad(bLng - aLng);
    const h = Math.sin(dLat / 2) ** 2
        + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
    return 2 * 6371000 * Math.asin(Math.sqrt(h));
}

// OPEN 체류 뒤 현재의 away episode가 시작된 첫 실측 fix. 추정 보간점은 사건 시각
// 근거로 쓰지 않으며, 잠깐 이탈 후 복귀가 있으면 마지막 inside 뒤의 이탈만 선택한다.
export function findConfirmedDepartureFix(points, center, radiusM = 120) {
    const actual = (Array.isArray(points) ? points : [])
        .filter((p) => p && !p.isEstimated
            && Number.isFinite(Number(p.lat)) && Number.isFinite(Number(p.lng))
            && Number.isFinite(Number(p.recordedMs)))
        .map((p) => ({ ...p, recordedMs: Number(p.recordedMs) }))
        .sort((a, b) => a.recordedMs - b.recordedMs);
    if (!actual.length || !center) return null;

    let lastInsideIndex = -1;
    for (let i = 0; i < actual.length; i += 1) {
        if (distanceM(actual[i].lat, actual[i].lng, center.lat, center.lng) <= radiusM) {
            lastInsideIndex = i;
        }
    }
    for (let i = lastInsideIndex + 1; i < actual.length; i += 1) {
        if (distanceM(actual[i].lat, actual[i].lng, center.lat, center.lng) > radiusM) {
            return actual[i];
        }
    }
    return null;
}

function formatKstClock(ms) {
    const d = new Date(ms + 9 * 60 * 60 * 1000);
    const h = d.getUTCHours();
    const m = d.getUTCMinutes();
    const ampm = h < 12 ? "오전" : "오후";
    const h12 = h % 12 === 0 ? 12 : h % 12;
    return `${ampm} ${h12}시${m > 0 ? ` ${m}분` : ""}`;
}

function formatPgTimestamp(ms) {
    return new Date(ms).toISOString().replace("T", " ").replace("Z", "+00");
}

export function buildUnregisteredStayLeftAlert(childName, areaLabel, options = {}) {
    const name = (childName || "아이").trim() || "아이";
    const area = (areaLabel || "").trim();
    const fromPart = area ? `${area} 근처에서` : "머물던 곳에서";
    const confirmedAtMs = Number(options.confirmedAtMs);
    const detectedAtMs = Number(options.detectedAtMs);
    const hasEventTime = Number.isFinite(confirmedAtMs);
    const delayed = hasEventTime && Number.isFinite(detectedAtMs)
        && detectedAtMs - confirmedAtMs > 10 * 60 * 1000;
    const currentTitle = area ? `🚶 ${area} 근처 출발` : "🚶 머물던 곳에서 출발";
    const delayedTitle = area ? `🕘 ${area} 근처 이전 출발 기록` : "🕘 이전 출발 기록";
    return {
        alertType: "unregistered_stay_left",
        severity: "info",
        title: delayed ? delayedTitle : currentTitle,
        message: delayed
            ? `${name}가 ${formatKstClock(confirmedAtMs)}경 ${fromPart} 출발한 것으로 확인됐어요. 위치 연결이 복구된 뒤 늦게 확인된 기록이에요.`
            : `${name}가 ${fromPart} 출발했어요.`,
        ...(hasEventTime ? {
            metadata: {
                event_at: formatPgTimestamp(confirmedAtMs),
                detected_at: Number.isFinite(detectedAtMs) ? formatPgTimestamp(detectedAtMs) : null,
                delayed,
                event_time_kind: "first_confirmed_away_fix",
            },
        } : {}),
    };
}

// durationMs → "약 N분"/"약 N시간 M분" (부모 카피용 간단 표기).
export function formatStayDuration(durationMs) {
    const totalMin = Math.max(0, Math.round(Number(durationMs || 0) / 60000));
    if (totalMin < 60) return `약 ${totalMin}분`;
    const h = Math.floor(totalMin / 60);
    const m = totalMin % 60;
    return m > 0 ? `약 ${h}시간 ${m}분` : `약 ${h}시간`;
}
