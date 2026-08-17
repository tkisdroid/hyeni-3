/**
 * 부모 오늘경로(시간대별 경로) 순수 계산.
 *
 * 화면(ParentLocation)은 여기서 나온 결과만 지도·라벨에 연결한다. 실기기 없이도 회귀할 수 있게
 * 좌표/시각 판단을 UI 밖으로 뺀다.
 */
import { distanceMeters, parseServerTimestamp } from "./locationView.ts";
import { isInterpolatedFillPoint } from "./locationRoute.ts";
import type { LocationHistoryPoint } from "@/lib/api/endpoints/location";

/** hyeni-1 LOCATION_TRAIL_JITTER_M — 정지 중 GPS 지터(≈8m)를 한 점으로 압축. */
export const TRAIL_JITTER_M = 8;

export interface TrailPoint {
  lat: number;
  lng: number;
  ms: number;
}

export interface LatLngPointLike {
  lat: number;
  lng: number;
}

export interface StayWindowLike {
  arrivalMs: number;
  departureMs: number;
}

export function findStayIndexAtMs(
  stays: readonly StayWindowLike[],
  atMs: number,
): number | null {
  if (!Number.isFinite(atMs)) return null;
  const index = stays.findIndex((stay) => stay.arrivalMs <= atMs && atMs <= stay.departureMs);
  return index >= 0 ? index : null;
}

/**
 * 하루 위치 이력 → 이동선 좌표(시간순).
 * 선택 자녀만 · 8m 이내 인접 중복 제거 · 직선 보간 채움점(`is_estimated`) 제외.
 * 채움점은 두 실측점 사이 직선 위의 합성점이라 제외해도 이동선 기하가 같고, 전 구간을 실선
 * 하나로 그릴 수 있다(2026-07-29 TK 제보 — 차량 이동 구간만 점선으로 끊겨 보였다).
 */
export function buildTrailPoints(
  points: LocationHistoryPoint[] | undefined,
  userId: string | null,
): TrailPoint[] {
  const rows = (points ?? [])
    .filter(
      (p) => (!userId || p.user_id === userId) && Number.isFinite(p.lat) && Number.isFinite(p.lng),
    )
    .filter((p) => !isInterpolatedFillPoint(p))
    .map((p) => ({
      lat: p.lat,
      lng: p.lng,
      ms: parseServerTimestamp(p.recorded_at)?.getTime() ?? 0,
    }))
    .sort((a, b) => a.ms - b.ms);
  const out: TrailPoint[] = [];
  for (const r of rows) {
    const prev = out[out.length - 1];
    if (prev && distanceMeters(prev.lat, prev.lng, r.lat, r.lng) < TRAIL_JITTER_M) continue;
    out.push(r);
  }
  return out;
}

/**
 * 지도 중심.
 * 목록에서 고른 머문 곳 > 부모가 고른 시각의 마지막 확인 위치 > null(하루 경로 전체 bounds).
 * 최신 따라가기 상태에서 null 을 돌려줘야 하루 경로 전체가 보인다.
 */
export function resolveHistoryMapCenter(input: {
  followsLatest: boolean;
  stayCenter: LatLngPointLike | null;
  scrubChildPoint: LatLngPointLike | null;
}): LatLngPointLike | null {
  if (input.stayCenter) return { lat: input.stayCenter.lat, lng: input.stayCenter.lng };
  if (input.followsLatest || !input.scrubChildPoint) return null;
  return { lat: input.scrubChildPoint.lat, lng: input.scrubChildPoint.lng };
}

/**
 * 고른 시각에 아이가 어디였는지 한 줄 설명.
 * 판정 시각은 마지막 기록 시각으로 clamp 한다 — 기록이 끊긴 뒤 시각을 골라도
 * "이동 중"으로 단정하지 않고 마지막으로 확인된 상태를 말한다.
 * 머문 곳 창(도착~출발) 안이면 그 장소명, 기록이 있는데 머문 곳이 아니면 이동 중,
 * 그 시각까지 기록이 없으면 기록 없음. 없는 사실을 만들지 않는다.
 */
export function resolveScrubWhereLabel(input: {
  stays: StayWindowLike[];
  stayLabels: (string | null)[];
  scrubMs: number;
  /** 그 시각까지의 마지막 실측 기록 시각. 없으면 null. */
  lastPointMs: number | null;
}): string {
  if (input.lastPointMs == null) return "기록 없음";
  const at = Math.min(input.scrubMs, input.lastPointMs);
  const index = findStayIndexAtMs(input.stays, at);
  if (index == null) return "이동 중";
  return input.stayLabels[index] ?? "머문 장소";
}
