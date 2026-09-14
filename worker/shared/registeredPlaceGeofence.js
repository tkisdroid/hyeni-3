// 서버 사이드(Edge) 등록장소 도착·이탈 판정 — 순수 모듈 (Deno + Vitest 공용).
//
// (Phase B, 2026-06-02) 장소 출입 알림이 자녀 WebView 에만 있어 백그라운드/종료
// 시 전무하던 문제를 server cron 백업으로 보강한다. 상태 머신은 클라이언트
// (src/lib/registeredPlaceGeofence.js)와 100% 동일해야 하므로 그대로 포팅했고,
// tests/serverRegisteredPlaceGeofence.test.js 의 parity 테스트가 드리프트를 차단한다.
//
// Supabase/Deno import 없음 → Vitest 단위 테스트 가능. haversineM 은 trailMath.js
// 와 동일 구현을 인라인(edge 는 src/ 를 import 할 수 없으므로).
//
// 서버 차이: child_locations 업로드 fix 에는 accuracy 가 없다(null). 5층 방어
// Layer1(정확도 게이트)은 Number.isFinite(accuracy) 가 false 면 자동 통과하므로
// 동일 로직이 서버에서도 안전하게 동작한다. tMs 는 fix 의 실제 시각(updated_at)
// 을 쓰며, edge 는 fix 가 stale(예: >10분) 하면 평가를 건너뛴다(가짜 트랜지션 방지).

/** @typedef {{ lat:number, lng:number, accuracy?:(number|null), tMs:number }} Fix */
/** @typedef {{ lat:number, lng:number, alertRadiusM?:(number|null) }} Place */

export function haversineM(la1, lo1, la2, lo2) {
    const R = 6371000, p1 = la1 * Math.PI / 180, p2 = la2 * Math.PI / 180;
    const dp = (la2 - la1) * Math.PI / 180, dl = (lo2 - lo1) * Math.PI / 180;
    const a = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export const INITIAL_REGISTERED_PLACE_STATE = Object.freeze({
    phase: "out",
    firstInsideAtMs: null,
    departureArmedAtMs: null,
    lastDepartedAtMs: null,
});

export const REGISTERED_PLACE_STATE_FRESH_MS = 6 * 60 * 60_000;

export const REGISTERED_PLACE_ACTIONS = Object.freeze({
    IGNORE_LOW_ACCURACY: "ignore_low_accuracy",
    PENDING_DWELL: "pending_dwell",
    PENDING_CONTINUE: "pending_continue",
    PENDING_ABORTED: "pending_aborted",
    ENTER: "enter",
    SILENT_RE_ENTER: "silent_re_enter",
    INSIDE_NO_CHANGE: "inside_no_change",
    DEPARTURE_CANCELLED: "departure_cancelled",
    OUTSIDE_ARMED: "outside_armed",
    OUTSIDE_PENDING_TIMER: "outside_pending_timer",
    LEAVE: "leave",
    // 조용한 재진입(SILENT_RE_ENTER) 에피소드에서 다시 나가는 전이. 부모는 재도착
    // 알림을 받은 적이 없으므로 두 번째 "출발" 알림은 GPS 지터 소음이다(2026-07-15
    // "집 출발"·"피아노 학원 출발" 중복 실사고). 상태(쿨다운 앵커)만 갱신하고 알림은
    // 발사하지 않는다. 판별 불변식: 정상 ENTER 는 lastDepartedAtMs 를 null 로 지우고
    // SILENT_RE_ENTER 만 이전 출발 시각을 보존한다.
    SILENT_LEAVE: "silent_leave",
    OUTSIDE_NO_CHANGE: "outside_no_change",
});

// 서버 cron 평가용 표준 config. 클라이언트 상수(locationConstants.js)와 동일 값.
// maxAccuracyM 는 fix.accuracy 가 null 이면 무시되므로 서버에선 사실상 비활성.
export const SERVER_GEOFENCE_CONFIG = Object.freeze({
    entryRadiusM: 30,
    exitRadiusM: 50,
    maxAccuracyM: 75,
    dwellMs: 180_000,
    cooldownMs: 10 * 60_000,
    departureTimeoutMs: 180_000,
    // 심부 진입 dwell 단축: 반경 경계(옆 건물 통과)가 아니라 반경 중심부에 들어온 fix 는
    // 확실한 방문이므로 90초만 머물면 도착으로 승격한다(도착 알림 지연 개선, 2026-07-10).
    // 엣지 fix 는 기존 180초 유지 — 학원가 통과 오탐 방지 설계를 보존한다.
    deepDwellMs: 90_000,
    deepInsideRatio: 0.6,
    // 확실한 이탈 즉시 확정: 이탈 타이머 180초는 경계 근처 GPS 지터(반경 밖으로 잠깐
    // 튀었다 돌아오는 것)를 걸러내려는 값이다. 정확도를 뺀 거리가 이탈 반경의 2배를
    // 넘으면 지터로 설명되지 않는 실제 이동이므로 타이머를 기다리지 않는다
    // (출발 알림 지연 개선, 2026-07-24 실측 재생 기준 약 2분 단축).
    farExitRatio: 2,
});

// 타이머 전용 재평가에서 마지막 fix 를 신뢰하는 최대 나이. 좌표가 frozen 인데 wall-clock
// 만 흘러 가짜 도착/출발이 나는 것을 막는다(fix 기반 평가의 15분 게이트보다 보수적).
export const REGISTERED_PLACE_TIMER_FIX_FRESH_MS = 5 * 60_000;

// 이름 기반 기본 알림 반경 — 학교류는 부지가 넓고, 조부모댁 같은 가족 주거지는
// 레거시 주소 핀과 실제 출입 동선이 어긋날 수 있다. 장소에 명시 반경
// (alertRadiusM)이 없을 때만 적용하므로 사용자가 고른 반경은 항상 우선한다.
export function defaultRegisteredPlaceRadiusM(name) {
    const n = String(name || "");
    if (/학교|초등|중학교|고등학교|유치원|어린이집/.test(n)) return 100;
    if (/할머니|할아버지|조부모|외가|친가/.test(n)) return 150;
    return null;
}

export const SAME_PHYSICAL_REGISTERED_PLACE_RADIUS_M = 20;

export function canonicalizeRegisteredPlaces(places) {
    if (!Array.isArray(places) || !places.length) return [];
    const out = [];
    for (const raw of places) {
        const place = normalizeRegisteredPlace(raw);
        if (!place) continue;
        const dupIndex = out.findIndex((candidate) =>
            haversineM(candidate.lat, candidate.lng, place.lat, place.lng) <= SAME_PHYSICAL_REGISTERED_PLACE_RADIUS_M);
        if (dupIndex < 0) {
            out.push(place);
            continue;
        }
        if (isPreferredRegisteredPlace(place, out[dupIndex])) {
            out[dupIndex] = place;
        }
    }
    return out;
}

function normalizeRegisteredPlace(place) {
    if (!place || typeof place !== "object") return null;
    const lat = Number(place.lat);
    const lng = Number(place.lng);
    const placeKey = String(place.placeKey || "");
    if (!placeKey || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    // 사용자 지정 알림 반경(30~300m 클램프). 없으면 undefined — 호출부가 이름 기본을 적용.
    const rawRadius = Number(place.alertRadiusM);
    const alertRadiusM = Number.isFinite(rawRadius) && rawRadius > 0
        ? Math.min(300, Math.max(30, rawRadius))
        : undefined;
    return {
        ...place,
        placeKey,
        source: normalizeRegisteredPlaceSource(place.source, placeKey),
        name: String(place.name || "등록된 장소"),
        lat,
        lng,
        ...(alertRadiusM != null ? { alertRadiusM } : {}),
    };
}

function normalizeRegisteredPlaceSource(source, placeKey) {
    const s = String(source || "");
    if (s === "saved_place" || s === "academy") return s;
    const key = String(placeKey || "");
    if (key.includes(":saved_place:")) return "saved_place";
    if (key.includes(":academy:")) return "academy";
    return "";
}

function registeredPlaceSourceRank(source) {
    if (source === "saved_place") return 0;
    if (source === "academy") return 1;
    return 2;
}

function isPreferredRegisteredPlace(next, current) {
    const nextRank = registeredPlaceSourceRank(next.source);
    const currentRank = registeredPlaceSourceRank(current.source);
    if (nextRank !== currentRank) return nextRank < currentRank;
    return String(next.name || "").length > String(current.name || "").length;
}

export function evaluateRegisteredPlaceTransition({ state, fix, place, config }) {
    const prev = normalizeState(state);
    const A = REGISTERED_PLACE_ACTIONS;

    if (!isValidFix(fix)) return { action: A.INSIDE_NO_CHANGE, nextState: prev };
    if (!isValidPlace(place)) return { action: A.OUTSIDE_NO_CHANGE, nextState: prev };

    // Layer 1: 정확도 게이트. accuracy 가 숫자고 임계값 초과면 평가 skip.
    if (Number.isFinite(fix.accuracy) && fix.accuracy > config.maxAccuracyM) {
        return { action: A.IGNORE_LOW_ACCURACY, nextState: prev };
    }

    const dist = haversineM(fix.lat, fix.lng, place.lat, place.lng);
    const { entryR, exitR } = resolveRadii(place, config);
    const inside = prev.phase === "in" ? dist <= exitR : dist <= entryR;
    // 심부 진입 판정 — 경계 통과(dist ≈ entryR)와 구분되는 확실한 방문 신호.
    const deepRatio = Number.isFinite(config.deepInsideRatio) ? config.deepInsideRatio : 0;
    const deepInside = deepRatio > 0 && dist <= entryR * deepRatio;
    const farOutside = isFarOutsideExitRadius(dist, fix.accuracy, exitR, config);

    switch (prev.phase) {
        case "out":     return transitionFromOut(prev, fix, inside, config);
        case "pending": return transitionFromPending(prev, fix, inside, config, deepInside);
        case "in":      return transitionFromIn(prev, fix, inside, config, farOutside);
        default:        return { action: A.OUTSIDE_NO_CHANGE, nextState: { ...INITIAL_REGISTERED_PLACE_STATE } };
    }
}

// 이탈 반경 밖으로 "지터로는 설명되지 않을 만큼" 멀어졌는가. 정확도만큼 보수적으로 뺀
// 거리를 쓰므로 오차가 큰 fix 는 자동으로 조기 확정 대상에서 빠진다.
function isFarOutsideExitRadius(dist, accuracy, exitR, config) {
    const ratio = Number.isFinite(config?.farExitRatio) ? config.farExitRatio : 0;
    if (!(ratio > 0)) return false;
    const margin = Number.isFinite(accuracy) && accuracy > 0 ? accuracy : 0;
    return (dist - margin) >= exitR * ratio;
}

/**
 * 타이머 전용 재평가 — 새 fix 가 없어도 dwell/이탈 타이머를 wall-clock 으로 진행시킨다.
 *
 * 왜 필요한가: 정지 중에는 위치 업로드가 120초 간격이라 fix 사이 공백이 3~4분씩 생긴다.
 * 도착·출발 판정을 fix 도착에만 걸어두면 타이머가 이미 만족했는데도 다음 fix 가 올
 * 때까지 알림이 밀린다(2026-07-24 실측: 도착 4.5분·출발 4.4분 지연).
 *
 * 안전장치: 마지막 fix 가 fixFreshMs 안쪽일 때만 진행한다. 좌표가 frozen 인 채 시간만
 * 흐르는 상황(기기 절전·위치 끊김)에서 가짜 도착/출발을 만들지 않기 위해서다.
 * episode 시각(firstInsideAtMs)은 실측 fix 시각을 그대로 보존한다.
 *
 * fix: 마지막으로 관측한 fix {lat,lng,accuracy?,tMs}. nowMs: 평가 시각(wall-clock).
 */
export function evaluateRegisteredPlaceTimer({
    state,
    fix,
    place,
    nowMs,
    config,
    fixFreshMs = REGISTERED_PLACE_TIMER_FIX_FRESH_MS,
}) {
    const prev = normalizeState(state);
    const A = REGISTERED_PLACE_ACTIONS;
    const noChange = { action: prev.phase === "in" ? A.INSIDE_NO_CHANGE : A.OUTSIDE_NO_CHANGE, nextState: prev };

    if (!isValidFix(fix) || !isValidPlace(place) || !Number.isFinite(nowMs)) return noChange;
    if (prev.phase !== "pending" && prev.phase !== "in") return noChange;
    // 시간이 뒤로 가거나(시계 조정) fix 가 오래됐으면 타이머를 진행시키지 않는다.
    if (nowMs <= fix.tMs) return noChange;
    if (nowMs - fix.tMs > fixFreshMs) return noChange;
    if (Number.isFinite(fix.accuracy) && fix.accuracy > config.maxAccuracyM) return noChange;

    const dist = haversineM(fix.lat, fix.lng, place.lat, place.lng);
    const { entryR, exitR } = resolveRadii(place, config);
    const inside = prev.phase === "in" ? dist <= exitR : dist <= entryR;

    if (prev.phase === "pending") {
        if (!inside) return noChange; // 밖으로 나간 판정은 실제 fix 가 담당한다.
        const deepRatio = Number.isFinite(config.deepInsideRatio) ? config.deepInsideRatio : 0;
        const deepInside = deepRatio > 0 && dist <= entryR * deepRatio;
        const requiredDwellMs = deepInside && Number.isFinite(config.deepDwellMs)
            ? config.deepDwellMs
            : config.dwellMs;
        const dwellSatisfied = prev.firstInsideAtMs != null
            && (nowMs - prev.firstInsideAtMs) >= requiredDwellMs;
        if (!dwellSatisfied) return { action: A.PENDING_CONTINUE, nextState: prev };
        return {
            action: A.ENTER,
            nextState: {
                phase: "in",
                firstInsideAtMs: prev.firstInsideAtMs,
                departureArmedAtMs: null,
                lastDepartedAtMs: null,
            },
        };
    }

    // phase === "in": 이탈 타이머만 진행한다(재진입 취소는 실제 fix 가 담당).
    if (inside || prev.departureArmedAtMs == null) return noChange;
    if ((nowMs - prev.departureArmedAtMs) < config.departureTimeoutMs) {
        return { action: A.OUTSIDE_PENDING_TIMER, nextState: prev };
    }
    const enteredSilently = prev.lastDepartedAtMs != null;
    return {
        action: enteredSilently ? A.SILENT_LEAVE : A.LEAVE,
        nextState: {
            phase: "out",
            firstInsideAtMs: null,
            departureArmedAtMs: null,
            lastDepartedAtMs: nowMs,
        },
    };
}

export function resolveRegisteredPlaceStateForEvaluation({
    state,
    updatedAtMs,
    nowMs = Date.now(),
    maxAgeMs = REGISTERED_PLACE_STATE_FRESH_MS,
}) {
    const normalized = normalizeState(state);
    if (!Number.isFinite(updatedAtMs) || !Number.isFinite(nowMs) || !Number.isFinite(maxAgeMs)) {
        return { ...INITIAL_REGISTERED_PLACE_STATE };
    }
    if (nowMs - updatedAtMs > maxAgeMs) return { ...INITIAL_REGISTERED_PLACE_STATE };
    return normalized;
}

function resolveRadii(place, config) {
    const userRadius = Number.isFinite(place.alertRadiusM) && place.alertRadiusM > 0
        ? place.alertRadiusM
        : null;
    if (userRadius == null) {
        return { entryR: config.entryRadiusM, exitR: config.exitRadiusM };
    }
    const entryR = Math.max(userRadius, config.entryRadiusM);
    const ratio = config.exitRadiusM / config.entryRadiusM;
    const exitR = Math.max(userRadius * ratio, config.exitRadiusM);
    return { entryR, exitR };
}

function transitionFromOut(prev, fix, inside, config) {
    const A = REGISTERED_PLACE_ACTIONS;
    if (!inside) return { action: A.OUTSIDE_NO_CHANGE, nextState: prev };

    const cooldownActive = prev.lastDepartedAtMs != null
        && (fix.tMs - prev.lastDepartedAtMs) < config.cooldownMs;
    if (cooldownActive) {
        return {
            action: A.SILENT_RE_ENTER,
            nextState: {
                phase: "in",
                firstInsideAtMs: fix.tMs,
                departureArmedAtMs: null,
                lastDepartedAtMs: prev.lastDepartedAtMs,
            },
        };
    }
    return {
        action: A.PENDING_DWELL,
        nextState: {
            phase: "pending",
            firstInsideAtMs: fix.tMs,
            departureArmedAtMs: null,
            lastDepartedAtMs: prev.lastDepartedAtMs,
        },
    };
}

function transitionFromPending(prev, fix, inside, config, deepInside = false) {
    const A = REGISTERED_PLACE_ACTIONS;
    if (!inside) {
        return {
            action: A.PENDING_ABORTED,
            nextState: {
                phase: "out",
                firstInsideAtMs: null,
                departureArmedAtMs: null,
                lastDepartedAtMs: prev.lastDepartedAtMs,
            },
        };
    }
    // 심부 진입이면 단축 dwell(90s), 경계 근처면 기존 dwell(180s).
    const requiredDwellMs = deepInside && Number.isFinite(config.deepDwellMs)
        ? config.deepDwellMs
        : config.dwellMs;
    const dwellSatisfied = prev.firstInsideAtMs != null
        && (fix.tMs - prev.firstInsideAtMs) >= requiredDwellMs;
    if (!dwellSatisfied) return { action: A.PENDING_CONTINUE, nextState: prev };

    return {
        action: A.ENTER,
        nextState: {
            phase: "in",
            firstInsideAtMs: prev.firstInsideAtMs,
            departureArmedAtMs: null,
            lastDepartedAtMs: null,
        },
    };
}

function transitionFromIn(prev, fix, inside, config, farOutside = false) {
    const A = REGISTERED_PLACE_ACTIONS;
    if (inside) {
        if (prev.departureArmedAtMs != null) {
            return {
                action: A.DEPARTURE_CANCELLED,
                nextState: { ...prev, departureArmedAtMs: null },
            };
        }
        return { action: A.INSIDE_NO_CHANGE, nextState: prev };
    }
    // 확실히 멀어졌으면 이탈 타이머(180초)를 기다리지 않고 바로 확정한다. 타이머는 경계
    // 지터를 거르려는 장치이고, 이 거리는 지터로 설명되지 않는다.
    if (prev.departureArmedAtMs == null && !farOutside) {
        return {
            action: A.OUTSIDE_ARMED,
            nextState: { ...prev, departureArmedAtMs: fix.tMs },
        };
    }
    const departureSatisfied = farOutside
        || (prev.departureArmedAtMs != null
            && (fix.tMs - prev.departureArmedAtMs) >= config.departureTimeoutMs);
    if (!departureSatisfied) return { action: A.OUTSIDE_PENDING_TIMER, nextState: prev };

    // phase=in 인데 lastDepartedAtMs 가 남아 있으면 이 에피소드는 SILENT_RE_ENTER 로
    // 시작한 것(정상 ENTER 는 null 로 지움) → 출발도 조용히 처리한다.
    const enteredSilently = prev.lastDepartedAtMs != null;
    return {
        action: enteredSilently ? A.SILENT_LEAVE : A.LEAVE,
        nextState: {
            phase: "out",
            firstInsideAtMs: null,
            departureArmedAtMs: null,
            lastDepartedAtMs: fix.tMs,
        },
    };
}

function isValidFix(fix) {
    return fix
        && Number.isFinite(fix.lat)
        && Number.isFinite(fix.lng)
        && Number.isFinite(fix.tMs);
}

function isValidPlace(place) {
    return place
        && Number.isFinite(place.lat)
        && Number.isFinite(place.lng);
}

function normalizeState(state) {
    if (!state || typeof state !== "object") return { ...INITIAL_REGISTERED_PLACE_STATE };
    const phase = state.phase === "in" || state.phase === "pending" || state.phase === "out"
        ? state.phase
        : "out";
    return {
        phase,
        firstInsideAtMs: Number.isFinite(state.firstInsideAtMs) ? state.firstInsideAtMs : null,
        departureArmedAtMs: Number.isFinite(state.departureArmedAtMs) ? state.departureArmedAtMs : null,
        lastDepartedAtMs: Number.isFinite(state.lastDepartedAtMs) ? state.lastDepartedAtMs : null,
    };
}

// ── 서버 전용 헬퍼 ─────────────────────────────────────────────────────────

// cyrb128: compact non-cryptographic hash → 128 bits. (locationStaleness.js 와 동일.)
function cyrb128(str) {
    let h1 = 1779033703, h2 = 3144134277, h3 = 1013904242, h4 = 2773480762;
    for (let i = 0; i < str.length; i++) {
        const k = str.charCodeAt(i);
        h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
        h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
        h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
        h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
    }
    h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
    h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
    h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
    h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
    return [h1 >>> 0, h2 >>> 0, h3 >>> 0, h4 >>> 0];
}

// 결정적 UUID v4-형식 멱등키. 같은 (kind, child, placeKey, episodeMs) → 같은 키라
// cron 재시도가 push_idempotency(uuid 컬럼)에서 dedup 된다.
export function placePresenceIdempotencyKey(kind, childUserId, placeKey, episodeMs) {
    const [a, b, c, d] = cyrb128(`${kind}:${childUserId}:${placeKey}:${episodeMs}`);
    const hex = [a, b, c, d].map((n) => n.toString(16).padStart(8, "0")).join("");
    const timeHiVer = "4" + hex.slice(13, 16);
    const variantNibble = ((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
    const clockSeq = variantNibble + hex.slice(17, 20);
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${timeHiVer}-${clockSeq}-${hex.slice(20, 32)}`;
}

// 부모-facing 카피 → 존댓말 (copy-tone 규칙). 클라 App.jsx 의 place_arrived/left 문구와 일관.
// fromPlaceName: 같은 평가 배치에서 병합된 출발 장소 — "학교 출발" 직후 "집 도착"이
// 몇 초 간격으로 연달아 오던 사고(2026-07-15)를 이동 한 건으로 합쳐 전한다.
export function buildPlaceArrivedAlert(childName, placeName, fromPlaceName) {
    const name = (childName || "아이").trim() || "아이";
    const place = (placeName || "등록된 장소").trim() || "등록된 장소";
    const from = typeof fromPlaceName === "string" ? fromPlaceName.trim() : "";
    return {
        alertType: "place_arrived",
        metadata: { notificationCopy: { v: 1, id: from && from !== place ? "arrivedFrom" : "arrived", args: { child: childName || "", place: placeName || "", from } } },
        severity: "info",
        title: `✅ ${place} 도착`,
        message: from && from !== place
            ? `${name}가 ${from}에서 출발해서 ${place}에 도착했어요.`
            : `${name}가 ${place}에 도착했어요.`,
    };
}

export function buildPlaceLeftAlert(childName, placeName) {
    const name = (childName || "아이").trim() || "아이";
    const place = (placeName || "등록된 장소").trim() || "등록된 장소";
    return {
        alertType: "place_left",
        metadata: { notificationCopy: { v: 1, id: "left", args: { child: childName || "", place: placeName || "" } } },
        severity: "info",
        title: `🚶 ${place} 출발`,
        message: `${name}가 ${place}에서 출발했어요.`,
    };
}

// ── 배치 전달 계획 (서버 cron 전용) ──────────────────────────────────────────
//
// 위치 미보고 구간 뒤 이력이 한꺼번에 재생되면 "학교 출발"과 "집 도착"이 같은 tick 에
// 몇 초 간격으로(장소 배열 순서라 시간 역전까지) 연달아 발사된다(2026-07-15 실사고).
// 같은 자녀의 한 평가 배치에서 나온 도착/출발 전이를 받아:
//   1) episodeMs 오름차순 정렬 — 실제 이동 순서대로 전달.
//   2) 배치에 "다른 장소 도착"이 함께 있으면 출발은 별도 알림 대신 그 도착 알림에
//      "○○에서 출발해서" 로 병합(deliver=false + 도착의 fromPlaceName 설정).
// 같은 장소의 도착↔출발(정상 방문 사이클)은 병합하지 않는다.
//
// transitions: [{ kind:"enter"|"leave", placeKey, placeName, episodeMs, ... }]
// returns: episodeMs 오름차순 [{ ...t, deliver, fromPlaceName? }]
export function planRegisteredPlacePresenceDelivery(transitions) {
    const sorted = [...(Array.isArray(transitions) ? transitions : [])]
        .filter((t) => t && (t.kind === "enter" || t.kind === "leave") && Number.isFinite(t.episodeMs))
        .sort((a, b) => a.episodeMs - b.episodeMs)
        .map((t) => ({ ...t, deliver: true }));
    for (const leave of sorted) {
        if (leave.kind !== "leave") continue;
        let nearest = null;
        let nearestGap = Infinity;
        for (const enter of sorted) {
            if (enter.kind !== "enter" || enter.placeKey === leave.placeKey) continue;
            const gap = Math.abs(enter.episodeMs - leave.episodeMs);
            if (gap < nearestGap) { nearestGap = gap; nearest = enter; }
        }
        if (nearest) {
            leave.deliver = false;
            leave.mergedIntoPlaceKey = nearest.placeKey;
            if (!nearest.fromPlaceName) nearest.fromPlaceName = leave.placeName;
        }
    }
    return sorted;
}

// 이전 tick 에서 이미 "다른 장소 도착"을 전달했는데 뒤늦게 이탈 확정이 흘러온
// 출발 알림(순서 역전 — "피아노 도착" 뒤 "학교 출발", 2026-07-15 실사고)을 억제한다.
// recentArrival: { title, createdAtMs } | null — 자녀의 최근 place_arrived/arrived 알림.
// 같은 장소 재출발("집 도착" 후 "집 출발")은 정상이므로 억제하지 않는다.
export const STALE_LEAVE_ARRIVAL_WINDOW_MS = 15 * 60_000;
export function isStaleRegisteredPlaceLeave({ placeName, recentArrival, nowMs, windowMs = STALE_LEAVE_ARRIVAL_WINDOW_MS }) {
    if (!recentArrival) return false;
    const createdAtMs = Number(recentArrival.createdAtMs);
    if (!Number.isFinite(createdAtMs) || !Number.isFinite(nowMs)) return false;
    if (nowMs - createdAtMs > windowMs) return false;
    const title = String(recentArrival.title || "");
    const name = String(placeName || "").trim();
    if (!name || !title) return false;
    return !title.includes(name);
}
