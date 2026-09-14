import type { ChildLocation, LocationHistoryPoint } from "@/lib/api/endpoints/location";
import type { MapReverseResult } from "@/lib/api/endpoints/maps";
import type { StayPoint } from "./stayPoints";
import { distanceMeters, parseServerTimestamp } from "./locationView";
import { isReliableLocationEvidence } from "./locationAccuracy";

/** 같은 좌표에 있어도 아이·측정 시각이 다르면 서로의 라벨을 재사용하지 않는다. */
export function locationLabelReferenceKey(location: ChildLocation): string {
  return JSON.stringify([location.user_id, location.updated_at, location.lat, location.lng]);
}

export function labelForMeasuredLocation(location: ChildLocation, result: MapReverseResult | undefined): string | null {
  const expectedMs = parseServerTimestamp(location.updated_at)?.getTime();
  const measuredMs = parseServerTimestamp(result?.measuredAt)?.getTime();
  if (expectedMs == null || measuredMs == null || expectedMs !== measuredMs) return null;
  return result?.label?.trim() || null;
}

/** 체류 중심점 대신 그 시간대에 실제 측정된 대표 위치를 서버 조회의 근거로 사용한다. */
export function stayLocationReference(
  stay: StayPoint,
  history: readonly LocationHistoryPoint[] | undefined,
  childUserId: string | null,
): ChildLocation | null {
  if (!childUserId) return null;
  let best: LocationHistoryPoint | null = null;
  let bestDistance = Infinity;
  for (const point of history ?? []) {
    if (point.user_id !== childUserId || point.is_estimated === true || point.is_estimated === 1
      || !isReliableLocationEvidence(point)) continue;
    const atMs = parseServerTimestamp(point.recorded_at)?.getTime();
    if (atMs == null || atMs < stay.arrivalMs || atMs > stay.departureMs) continue;
    const distance = distanceMeters(stay.lat, stay.lng, point.lat, point.lng);
    if (distance < bestDistance) { best = point; bestDistance = distance; }
  }
  return best ? { user_id: best.user_id, lat: best.lat, lng: best.lng, updated_at: best.recorded_at, accuracy_m: best.accuracy_m } : null;
}
