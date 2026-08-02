// supabase/functions/_shared/dwellCluster.js
// Pure dwell-clustering for the SERVER (Deno + Vitest). Parity copy of the
// ALGORITHM in src/lib/trailMath.js buildTrailDwellPlaces (50m radius / 10min min /
// 15min max sample gap). The edge runtime cannot import src/, so this is a faithful
// port; tests/serverDwellClusterParity.test.js guards against drift (same pattern as
// _shared/registeredPlaceGeofence.js).
// NOTE: parity is at the ALGORITHM level (identical points → identical output). The
// client first runs an 8m jitter compaction (compactLocationTrailPoints) on its
// input while this cron clusters raw location_history; dwell DETECTION (50m/10min) is
// robust to that, but pointCount/startMs/medoid can differ slightly vs the client UI.
//
// 사용자 정책(2026-06-02): 반경 50m 안에서 10분 이상 머무르면 '체류'.

export const SERVER_DWELL_RADIUS_M = 50;
export const SERVER_DWELL_MIN_MS = 10 * 60_000;
export const SERVER_DWELL_MAX_SAMPLE_GAP_MS = 15 * 60_000;

// 미등록 체류 *알림* 전용 즉시성 임계(2026-06-12). trail 렌더(SERVER_DWELL_MIN_MS
// =10분, src/lib/trailMath.js 와 parity)와 달리 알림은 더 빨라야 하므로 5분으로
// 둔다. 5분 미만 금지 — 신호등/건널목 대기(~2분)가 오발하지 않게 하한선이다.
// buildServerDwellPlaces(points, { minDwellMs }) 로 주입한다(미지정 시 parity 기본).
export const STAY_ALERT_DWELL_MIN_MS = 5 * 60_000;

export function haversineM(la1, lo1, la2, lo2) {
    const R = 6371000, p1 = la1 * Math.PI / 180, p2 = la2 * Math.PI / 180;
    const dp = (la2 - la1) * Math.PI / 180, dl = (lo2 - lo1) * Math.PI / 180;
    const a = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// 클러스터 내 점들 중 나머지 점들과의 거리합이 가장 작은 실제 점(medoid).
// centroid 와 달리 항상 입력 점 중 하나라 도로 한복판에 핀이 박히지 않는다.
export function medoidTrailPoint(points) {
    if (!points.length) return null;
    let best = points[0];
    let bestSum = Infinity;
    points.forEach((candidate) => {
        const sum = points.reduce(
            (acc, other) => acc + haversineM(candidate.lat, candidate.lng, other.lat, other.lng),
            0,
        );
        if (sum < bestSum) {
            bestSum = sum;
            best = candidate;
        }
    });
    return { lat: best.lat, lng: best.lng };
}

// 클러스터가 정지인지: 모든 점 쌍의 거리가 반경 이내여야 한다. 한 방향으로
// 천천히 흘러가는(drift) 이동 경로는 인접 거리는 작아도 첫↔끝 쌍거리가 반경을
// 넘으므로 정지(dwell)로 인정하지 않는다.
function clusterSpanWithinRadius(cluster, radiusM) {
    for (let i = 0; i < cluster.length; i += 1) {
        for (let j = i + 1; j < cluster.length; j += 1) {
            if (haversineM(cluster[i].lat, cluster[i].lng, cluster[j].lat, cluster[j].lng) > radiusM) {
                return false;
            }
        }
    }
    return true;
}

// 동일 알고리즘(src/lib/trailMath.buildTrailDwellPlaces), UI 라벨 필드
// (label/timeLabel/timeRangeLabel = KST 시계 포맷)만 제외. 지역 라벨은 서버
// 역지오코딩으로 따로 붙이므로 서버는 geometric 필드만 산출한다.
// opts.minDwellMs: 체류로 인정할 최소 체류 시간. 미지정 시 SERVER_DWELL_MIN_MS
// (=10분, trail parity). 미등록 체류 알림 경로는 STAY_ALERT_DWELL_MIN_MS(=5분)를
// 주입한다. 인자 무전달 호출은 parity 기본을 그대로 유지(parity 테스트 불변).
export function buildServerDwellPlaces(points, opts = {}) {
    const minDwellMs = Number.isFinite(opts?.minDwellMs) ? opts.minDwellMs : SERVER_DWELL_MIN_MS;
    const timedPoints = (points || []).filter((point) => Number.isFinite(point?.recordedMs));
    const places = [];
    let cluster = [];

    const flush = () => {
        if (cluster.length < 2) {
            cluster = [];
            return;
        }
        const startMs = cluster[0].recordedMs;
        const endMs = cluster[cluster.length - 1].recordedMs;
        const durationMs = endMs - startMs;
        if (durationMs >= minDwellMs && clusterSpanWithinRadius(cluster, SERVER_DWELL_RADIUS_M)) {
            const center = medoidTrailPoint(cluster);
            if (center) {
                places.push({
                    id: `dwell-${places.length}-${startMs}`,
                    ...center,
                    startMs,
                    endMs,
                    durationMs,
                    pointCount: cluster.length,
                });
            }
        }
        cluster = [];
    };

    timedPoints.forEach((point) => {
        if (!cluster.length) {
            cluster = [point];
            return;
        }
        const previous = cluster[cluster.length - 1];
        const sampleGapMs = point.recordedMs - previous.recordedMs;
        if (sampleGapMs > SERVER_DWELL_MAX_SAMPLE_GAP_MS) {
            flush();
            cluster = [point];
            return;
        }
        // 멤버십은 직전 점(인접) 기준 반경. drift 는 flush 의 span 가드로 제외.
        const distanceFromPrevious = haversineM(previous.lat, previous.lng, point.lat, point.lng);
        if (distanceFromPrevious <= SERVER_DWELL_RADIUS_M) {
            cluster.push(point);
            return;
        }
        flush();
        cluster = [point];
    });
    flush();

    return places;
}

// dwell 중심이 등록 장소(saved_places/academies/danger_zones) 반경 내면 true.
// Phase D 는 미등록 체류만 알리므로 이걸로 등록장소를 제외 → Phase B 등록장소
// geofence 와 이중발사 차단. place.radiusM 이 있으면 max(place.radiusM, radiusM).
export function isNearRegisteredPlace(center, places, radiusM) {
    if (!center || !Array.isArray(places)) return false;
    return places.some((p) => {
        const lat = Number(p?.lat);
        const lng = Number(p?.lng);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
        const r = Number.isFinite(p?.radiusM) && p.radiusM > 0 ? Math.max(p.radiusM, radiusM) : radiusM;
        return haversineM(center.lat, center.lng, lat, lng) <= r;
    });
}

// dwell 중심을 ~11m 그리드로 양자화해 안정 키 생성(medoid 가 tick 마다 미세하게
// 흔들려도 같은 체류가 같은 키로 매핑). lat/lng 소수 4자리.
export function dwellGridKey(lat, lng) {
    const q = (n) => Number(n).toFixed(4);
    return `${q(lat)},${q(lng)}`;
}
