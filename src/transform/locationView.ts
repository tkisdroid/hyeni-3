/**
 * 위치 표시 파생(순수). 신선도 라벨 + 가까운 저장장소.
 */
import type { SavedPlace, ChildLocation } from "@/lib/api/endpoints/location";

/** 서버 타임스탬프("YYYY-MM-DD HH:MM:SS.mmm+00") → Date. */
export function parseServerTimestamp(ts: string | null | undefined): Date | null {
  if (!ts) return null;
  const iso = ts.replace(" ", "T").replace(/\+00$/, "+00:00");
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

export interface Freshness {
  label: string;
  /** 90초 이내 = 실시간(민트). 10분 이내 = 최근. 그 외 = 오래됨(앰버). */
  status: "live" | "recent" | "stale";
}

export function formatFreshness(updatedAt: string | null | undefined, now: Date = new Date()): Freshness {
  const d = parseServerTimestamp(updatedAt);
  if (!d) return { label: "위치 정보 없음", status: "stale" };
  const diffSec = Math.max(0, Math.round((now.getTime() - d.getTime()) / 1000));
  if (diffSec < 90) return { label: "방금 업데이트", status: "live" };
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return { label: `${diffMin}분 전`, status: diffMin <= 10 ? "recent" : "stale" };
  const diffHour = Math.round(diffMin / 60);
  if (diffHour < 24) return { label: `${diffHour}시간 전`, status: "stale" };
  return { label: `${Math.round(diffHour / 24)}일 전`, status: "stale" };
}

export function hasNewerLocationUpdate(
  before: Pick<ChildLocation, "updated_at"> | null | undefined,
  after: Pick<ChildLocation, "updated_at"> | null | undefined,
): boolean {
  if (!after) return false;
  if (!before) return true;
  const beforeMs = parseServerTimestamp(before.updated_at)?.getTime();
  const afterMs = parseServerTimestamp(after.updated_at)?.getTime();
  if (beforeMs == null || !Number.isFinite(beforeMs)) return afterMs != null && Number.isFinite(afterMs);
  return afterMs != null && Number.isFinite(afterMs) && afterMs > beforeMs;
}

const EARTH_R = 6371000;
function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/** 두 좌표 간 거리(m) — haversine. */
export function distanceMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_R * Math.asin(Math.sqrt(a));
}

export interface NearestPlace {
  place: SavedPlace;
  distanceM: number;
}

/** 자녀 위치에서 가장 가까운 저장장소(반경 무관, 최단). */
export function nearestPlace(loc: ChildLocation, places: SavedPlace[]): NearestPlace | null {
  let best: NearestPlace | null = null;
  for (const p of places) {
    if (typeof p.location?.lat !== "number" || typeof p.location?.lng !== "number") continue;
    const dist = distanceMeters(loc.lat, loc.lng, p.location.lat, p.location.lng);
    if (!best || dist < best.distanceM) best = { place: p, distanceM: dist };
  }
  return best;
}

/** 주소 조회가 아직 끝나지 않았을 때의 사용자용 fallback. 좌표는 기본 UI에 노출하지 않는다. */
export function coordinateLabel(loc: ChildLocation): string {
  void loc;
  return "주소 확인 중";
}

/** 자녀 위치 → 현위치 라벨: 200m 이내 저장장소명, 아니면 주소 조회 대기. */
export function placeLabel(loc: ChildLocation, places: SavedPlace[]): string {
  const near = nearestPlace(loc, places);
  if (near && near.distanceM <= 200) return near.place.name;
  return coordinateLabel(loc);
}
