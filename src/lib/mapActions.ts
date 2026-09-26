import {
  mapsApi,
  type EphemeralMapSearchCandidate,
  type MapSelectedPlace,
  type MapSearchSession,
} from "@/lib/api/endpoints/maps";

export async function findMapPlaces(familyId: string, query: string, locale: string): Promise<{
  session: MapSearchSession;
  candidates: EphemeralMapSearchCandidate[];
}> {
  const session = await mapsApi.startSearch(familyId);
  const candidates = await mapsApi.search({ familyId, sessionHandle: session.sessionHandle, query, locale });
  return { session, candidates };
}

export function selectMapPlace(familyId: string, sessionHandle: string, candidate: EphemeralMapSearchCandidate): Promise<MapSelectedPlace> {
  return mapsApi.select({ familyId, sessionHandle, providerPlaceId: candidate.providerPlaceId });
}

export async function searchMapPlace(familyId: string, query: string, locale: string): Promise<MapSelectedPlace | null> {
  const { session, candidates } = await findMapPlaces(familyId, query, locale);
  const first = candidates[0];
  if (!first) return null;
  return selectMapPlace(familyId, session.sessionHandle, first);
}

const COORDINATE_UNITS = 10_000_000;

/**
 * 원좌표 역지오코딩은 소수점 7자리(약 1cm)까지만 받는다. 지도 탭 좌표는 15자리라 그대로 보내면
 * 400(map_coordinates_invalid)으로 주소 칸이 늘 비었다(2026-09-26 S25 장소 등록 실측).
 * 이전 서버 검사(`value*1e7` 이 정수와 1e-7 이내)는 경도 127 부근에서 부동소수 오차로 올바른
 * 7자리 값도 약 8% 거부하므로, 1cm 이내 이웃 값 중 그 검사를 통과하는 값을 고른다.
 */
export function toReverseCoordinate(value: number): number {
  const units = Math.round(value * COORDINATE_UNITS);
  for (const offset of [0, 1, -1, 2, -2, 3, -3]) {
    const candidate = (units + offset) / COORDINATE_UNITS;
    if (Math.abs(candidate * COORDINATE_UNITS - Math.round(candidate * COORDINATE_UNITS)) < 1e-7) return candidate;
  }
  return units / COORDINATE_UNITS;
}

export async function reverseRawMapLabel(
  familyId: string,
  point: { lat: number; lng: number },
  locale: string,
  kind: "picker_pin" | "memo_share",
): Promise<string> {
  const result = await mapsApi.reverse({
    familyId,
    locale,
    source: { kind, lat: toReverseCoordinate(point.lat), lng: toReverseCoordinate(point.lng) },
  });
  return result.label ?? "";
}
