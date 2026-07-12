/**
 * 스테이포인트(머무른 장소) 검출 — 하루 위치 이력에서 "이동 노이즈"를 걸러
 * 아이가 실제로 머무른 장소와 체류 시간을 뽑는다.
 *
 * 알고리즘(Li et al. 2008 stay-point detection 표준):
 *  - 시간순 GPS 점열을 순회하며, 기준점 i 로부터 거리 임계(distThresholdM) 안에 있는
 *    연속 점들을 하나의 후보 클러스터로 묶는다.
 *  - 클러스터의 체류 시간(마지막점 - 첫점)이 시간 임계(timeThresholdMs) 이상이면
 *    "머무른 장소"(centroid + 도착/출발 시각)로 확정하고 클러스터 뒤로 건너뛴다.
 *  - 임계 미만이면 그 점은 "이동 중"으로 보고 다음 점으로 넘어간다(노이즈 제거).
 *
 * 이렇게 하면 잦은 GPS 지터·이동 구간이 자동으로 걸러지고, 학교·학원·집처럼
 * 일정 시간 머문 곳만 남는다.
 */
import { distanceMeters, parseServerTimestamp } from "./locationView";
import { isReliableLocationEvidence } from "./locationAccuracy";
import type { LocationHistoryPoint } from "@/lib/api/endpoints/location";
import type { SavedPlace } from "@/lib/api/endpoints/location";

export interface StayPoint {
  /** 클러스터 중심 좌표(머무른 장소). */
  lat: number;
  lng: number;
  /** 도착 시각(epoch ms) — 클러스터 첫 점. */
  arrivalMs: number;
  /** 출발 시각(epoch ms) — 클러스터 마지막 점. */
  departureMs: number;
  /** 체류 시간(ms) = 출발 - 도착. */
  dwellMs: number;
  /** 이 스테이포인트를 구성한 GPS 점 수. */
  pointCount: number;
}

export interface StayPointOptions {
  /** 머무름으로 볼 반경(m). 이 안에서 오래 있으면 한 장소로 본다. 기본 150m. */
  distThresholdM?: number;
  /** 머무름으로 볼 최소 체류 시간(ms). 기본 8분. */
  timeThresholdMs?: number;
  /** 인접 스테이포인트 병합 반경(m) — 같은 장소를 잠깐 벗어났다 돌아온 경우 합친다. 기본 120m. */
  mergeWithinM?: number;
}

const DEFAULT_DIST_M = 150;
const DEFAULT_TIME_MS = 8 * 60 * 1000;
const DEFAULT_MERGE_M = 120;

interface TimedPoint {
  lat: number;
  lng: number;
  ms: number;
}

/** 위치 이력 → 시간순 유효 점열(선택 자녀 한정, NaN·무효 시각 제거). */
export function toTimedPoints(
  history: LocationHistoryPoint[] | undefined,
  userId: string | null,
): TimedPoint[] {
  return (history ?? [])
    .filter(
      (p) => p.is_estimated !== true && p.is_estimated !== 1
        && isReliableLocationEvidence(p)
        && (!userId || p.user_id === userId)
        && Number.isFinite(p.lat)
        && Number.isFinite(p.lng),
    )
    .map((p) => ({ lat: p.lat, lng: p.lng, ms: parseServerTimestamp(p.recorded_at)?.getTime() ?? NaN }))
    .filter((p) => Number.isFinite(p.ms))
    .sort((a, b) => a.ms - b.ms);
}

/** 시간순 점열에서 스테이포인트를 검출한다. */
export function detectStayPoints(points: TimedPoint[], opts: StayPointOptions = {}): StayPoint[] {
  const distThreshold = opts.distThresholdM ?? DEFAULT_DIST_M;
  const timeThreshold = opts.timeThresholdMs ?? DEFAULT_TIME_MS;
  const mergeWithin = opts.mergeWithinM ?? DEFAULT_MERGE_M;

  const pts = points;
  const n = pts.length;
  const stays: StayPoint[] = [];
  let i = 0;

  while (i < n) {
    // i 로부터 거리 임계 안의 연속 점을 확장.
    let j = i + 1;
    while (j < n && distanceMeters(pts[i].lat, pts[i].lng, pts[j].lat, pts[j].lng) <= distThreshold) {
      j += 1;
    }
    const clusterEnd = j - 1; // 임계 안 마지막 점.
    const dwell = pts[clusterEnd].ms - pts[i].ms;
    if (clusterEnd > i && dwell >= timeThreshold) {
      let sumLat = 0;
      let sumLng = 0;
      for (let k = i; k <= clusterEnd; k += 1) {
        sumLat += pts[k].lat;
        sumLng += pts[k].lng;
      }
      const count = clusterEnd - i + 1;
      stays.push({
        lat: sumLat / count,
        lng: sumLng / count,
        arrivalMs: pts[i].ms,
        departureMs: pts[clusterEnd].ms,
        dwellMs: dwell,
        pointCount: count,
      });
      i = j; // 클러스터 뒤로 건너뜀.
    } else {
      i += 1; // 이동 중 — 다음 점으로.
    }
  }

  return mergeAdjacent(stays, mergeWithin);
}

/** 인접(같은 장소를 잠깐 벗어났다 돌아온) 스테이포인트를 병합해 과분할을 막는다. */
function mergeAdjacent(stays: StayPoint[], mergeWithinM: number): StayPoint[] {
  if (stays.length <= 1) return stays;
  const out: StayPoint[] = [];
  for (const s of stays) {
    const prev = out[out.length - 1];
    if (prev && distanceMeters(prev.lat, prev.lng, s.lat, s.lng) <= mergeWithinM) {
      // 병합: 가중 중심 + 도착=이전 도착, 출발=현재 출발.
      const wPrev = prev.pointCount;
      const wCur = s.pointCount;
      const total = wPrev + wCur;
      prev.lat = (prev.lat * wPrev + s.lat * wCur) / total;
      prev.lng = (prev.lng * wPrev + s.lng * wCur) / total;
      prev.departureMs = s.departureMs;
      prev.dwellMs = prev.departureMs - prev.arrivalMs;
      prev.pointCount = total;
    } else {
      out.push({ ...s });
    }
  }
  return out;
}

/** 체류 시간(ms) → "1시간 20분" / "35분" 표기. */
export function formatDwell(ms: number): string {
  const totalMin = Math.max(1, Math.round(ms / 60000));
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h > 0) return m > 0 ? `${h}시간 ${m}분` : `${h}시간`;
  return `${m}분`;
}

/** epoch ms → "HH:MM"(24h). */
export function formatClockHM(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 스테이포인트에서 가장 가까운 저장장소 이름(반경 200m 이내). 없으면 null. */
export function stayPlaceLabel(stay: StayPoint, places: SavedPlace[] | undefined): string | null {
  let best: { name: string; dist: number } | null = null;
  for (const p of places ?? []) {
    const lat = p.location?.lat;
    const lng = p.location?.lng;
    if (typeof lat !== "number" || typeof lng !== "number") continue;
    const dist = distanceMeters(stay.lat, stay.lng, lat, lng);
    if (dist <= 200 && (!best || dist < best.dist)) best = { name: p.name, dist };
  }
  return best?.name ?? null;
}
