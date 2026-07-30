/**
 * 지도 선택 화면의 기본 중심(단일 출처).
 *
 * 장소·위험구역 등록 화면이 서울시청을 기본으로 띄워, 서울 밖에 사는 가족은 매번 지도를 끌어야 했다
 * (2026-07-30 A17 실기기 확인 — 용인 거주 가족인데 시청 기준). 우선순위는
 * ①현재 기기 위치(호출부가 geolocation 으로 잡은 값) ②집으로 저장한 장소 ③아이 마지막 확인 위치
 * ④서울 기본값이다. 없는 좌표를 만들어내지 않고 있는 값만 순서대로 고른다.
 */
export interface MapCenterPoint {
  lat: number;
  lng: number;
}

export const SEOUL_CENTER: MapCenterPoint = { lat: 37.5665, lng: 126.978 };

interface SavedPlaceLike {
  is_home?: boolean;
  location?: { lat?: number | null; lng?: number | null } | null;
}

interface ChildLocationLike {
  lat?: number | null;
  lng?: number | null;
}

function toPoint(lat: unknown, lng: unknown): MapCenterPoint | null {
  // Number(null) === 0 이라 null 을 유효 좌표로 착각하면 적도(0,0)로 튄다
  // (원격청취 ended_at_ms 실사고와 같은 함정 — typeof 로 먼저 막는다).
  const nextLat = typeof lat === "number" ? lat : typeof lat === "string" && lat.trim() ? Number(lat) : NaN;
  const nextLng = typeof lng === "number" ? lng : typeof lng === "string" && lng.trim() ? Number(lng) : NaN;
  if (!Number.isFinite(nextLat) || !Number.isFinite(nextLng)) return null;
  if (nextLat === 0 && nextLng === 0) return null;
  return { lat: nextLat, lng: nextLng };
}

/** 집으로 저장한 장소의 좌표. 없으면 첫 저장 장소, 그것도 없으면 null. */
export function homePlaceCenter(places: readonly SavedPlaceLike[] | undefined): MapCenterPoint | null {
  const list = places ?? [];
  const home = list.find((p) => p.is_home === true);
  return (
    toPoint(home?.location?.lat, home?.location?.lng)
    ?? toPoint(list[0]?.location?.lat, list[0]?.location?.lng)
  );
}

/** 지도 초기 중심 — 현재 위치 > 집 > 아이 위치 > 서울. */
export function resolveMapCenter(input: {
  current?: MapCenterPoint | null;
  places?: readonly SavedPlaceLike[];
  childLocations?: readonly ChildLocationLike[];
}): MapCenterPoint {
  const current = toPoint(input.current?.lat, input.current?.lng);
  if (current) return current;
  const home = homePlaceCenter(input.places);
  if (home) return home;
  for (const loc of input.childLocations ?? []) {
    const point = toPoint(loc?.lat, loc?.lng);
    if (point) return point;
  }
  return SEOUL_CENTER;
}
