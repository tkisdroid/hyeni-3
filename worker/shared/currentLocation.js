// 현재 위치 행의 시각 계약. child_locations.updated_at은 서버 수신 시각이 아니라
// 기기가 실제로 좌표를 얻은 시각이며, 이전 fix가 늦게 도착해 최신 좌표를 덮으면 안 된다.

export const LOCATION_FIX_FUTURE_SKEW_MS = 60_000;
export const LOCATION_FIX_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export const CURRENT_LOCATION_UPSERT_SQL = `
    INSERT INTO child_locations (user_id, family_id, lat, lng, updated_at, accuracy_m)
    VALUES (?,?,?,?,?,?)
    ON CONFLICT(user_id) DO UPDATE SET
      family_id=excluded.family_id,
      lat=excluded.lat,
      lng=excluded.lng,
      updated_at=excluded.updated_at,
      accuracy_m=excluded.accuracy_m
    WHERE child_locations.updated_at IS NULL
       OR length(trim(child_locations.updated_at)) < 19
       OR replace(substr(child_locations.updated_at,1,23),'T',' ') < ?`;

function parseTimestampMs(value) {
    const raw = String(value ?? "").trim();
    if (!raw) return NaN;
    let iso = raw.replace(" ", "T");
    if (/[+-]\d{2}$/.test(iso)) iso += ":00";
    else if (/[+-]\d{4}$/.test(iso)) iso = `${iso.slice(0, -2)}:${iso.slice(-2)}`;
    else if (!/[+-]\d{2}:\d{2}$/.test(iso) && !iso.endsWith("Z")) iso += "Z";
    return Date.parse(iso);
}

export function formatCurrentLocationFixTime(atMs) {
    return new Date(atMs).toISOString().replace("T", " ").replace("Z", "+00");
}

/**
 * 명시 시각이 없으면 레거시 클라이언트 호환으로 수신 시각을 사용한다.
 * 명시 시각은 파싱 가능하고 미래 1분 이내여야 하며, 작은 기기 시계 오차는 now로 clamp한다.
 * @param {unknown} rawValue
 * @param {number} nowMs
 * @param {unknown} rawAgeMs
 */
export function normalizeCurrentLocationFixTime(rawValue, nowMs = Date.now(), rawAgeMs = null) {
    const explicit = rawValue != null && String(rawValue).trim() !== "";
    const parsedMs = explicit ? parseTimestampMs(rawValue) : NaN;

    // 정상 provider 시각은 네트워크 재시도 지연과 무관한 사건 시각이므로 그대로 보존한다.
    // age 기반 serverNow-age는 단말 wall clock이 미래로 틀렸거나 시각이 없는 경우의 안전 폴백이다.
    if (Number.isFinite(parsedMs) && parsedMs <= nowMs + LOCATION_FIX_FUTURE_SKEW_MS) {
        const atMs = Math.min(parsedMs, nowMs);
        return { atMs, timestamp: formatCurrentLocationFixTime(atMs), explicit: true };
    }

    if (rawAgeMs != null && String(rawAgeMs).trim() !== "") {
        const ageMs = Number(rawAgeMs);
        if (!Number.isFinite(ageMs) || ageMs < 0 || ageMs > LOCATION_FIX_MAX_AGE_MS || ageMs > nowMs) return null;
        const atMs = nowMs - Math.round(ageMs);
        return { atMs, timestamp: formatCurrentLocationFixTime(atMs), explicit: true };
    }
    if (!explicit) {
        return { atMs: nowMs, timestamp: formatCurrentLocationFixTime(nowMs), explicit: false };
    }
    return null;
}

/** 기존 current보다 엄격히 새로운 fix만 교체한다. */
export function shouldReplaceCurrentLocation(existingTimestamp, incomingAtMs) {
    if (!Number.isFinite(incomingAtMs)) return false;
    const existingMs = parseTimestampMs(existingTimestamp);
    return !Number.isFinite(existingMs) || incomingAtMs > existingMs;
}

/** SQLite 문자열 비교용 UTC millisecond key(YYYY-MM-DD HH:mm:ss.SSS). */
export function currentLocationComparisonKey(timestamp) {
    return String(timestamp || "").replace("T", " ").slice(0, 23);
}
