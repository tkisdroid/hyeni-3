/**
 * 위치 도메인 엔드포인트(자녀 현재위치/이력, 위험구역, 저장장소).
 */
import { apiGet, apiPost, apiPatch, apiDelete } from "../client";

export interface ChildLocation {
  user_id: string;
  lat: number;
  lng: number;
  updated_at: string; // "YYYY-MM-DD HH:MM:SS.mmm+00"
}

export interface LocationHistoryPoint {
  user_id: string;
  lat: number;
  lng: number;
  recorded_at: string;
}

export interface DangerZone {
  id: string;
  family_id: string;
  name: string;
  lat: number;
  lng: number;
  radius_m: number;
  zone_type: string; // "custom" 등
  created_at?: string;
}

export interface SavedPlaceLocation {
  lat: number;
  lng: number;
  address?: string;
  kakao_place_id?: string | null;
}

export interface SavedPlace {
  id: string;
  family_id: string;
  name: string;
  location: SavedPlaceLocation;
  is_home?: boolean;
  is_playdate_safe?: boolean;
  public_place_id?: string | null;
}

/** 자녀 현재 위치 목록. */
export function fetchChildLocations(familyId: string): Promise<ChildLocation[]> {
  return apiGet<ChildLocation[]>(`/api/location/children?family_id=${encodeURIComponent(familyId)}`);
}

/** 위치 이력(기간). */
export function fetchLocationHistory(
  familyId: string,
  start: string,
  end: string,
): Promise<LocationHistoryPoint[]> {
  return apiGet<LocationHistoryPoint[]>(
    `/api/location/history?family_id=${encodeURIComponent(familyId)}&start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`,
  );
}

// ── 위험구역 ──
export function fetchDangerZones(familyId: string): Promise<DangerZone[]> {
  return apiGet<DangerZone[]>(`/api/danger-zones?family_id=${encodeURIComponent(familyId)}`);
}

export type DangerZoneInput = {
  name: string;
  lat: number;
  lng: number;
  radius_m: number;
  zone_type?: string;
};

export function createDangerZone(familyId: string, zone: DangerZoneInput): Promise<DangerZone> {
  return apiPost<DangerZone>("/api/danger-zones", { familyId, zone });
}

/**
 * 위험구역 부분수정. 서버(worker/routes/danger-zones.ts)는 별도 PATCH 라우트 없이
 * 동일 `POST /api/danger-zones` 에서 `zone.id` 유무로 UPDATE/INSERT 를 분기한다.
 * → 편집은 delete+create 교체가 아니라 같은 행을 in-place 로 갱신한다(id·created_at 보존).
 */
export function updateDangerZone(
  familyId: string,
  id: string,
  zone: DangerZoneInput,
): Promise<DangerZone> {
  return apiPost<DangerZone>("/api/danger-zones", { familyId, zone: { id, ...zone } });
}

export function deleteDangerZone(id: string): Promise<unknown> {
  return apiDelete(`/api/danger-zones/${encodeURIComponent(id)}`);
}

// ── 저장장소 ──
export function fetchSavedPlaces(familyId: string): Promise<SavedPlace[]> {
  return apiGet<SavedPlace[]>(`/api/saved-places?family_id=${encodeURIComponent(familyId)}`);
}

export type NewSavedPlace = {
  family_id: string;
  name: string;
  location: SavedPlaceLocation;
  is_home?: boolean;
};

export function createSavedPlace(row: NewSavedPlace): Promise<unknown> {
  return apiPost("/api/saved-places", row);
}

export function updateSavedPlace(id: string, fields: Partial<NewSavedPlace>): Promise<unknown> {
  return apiPatch(`/api/saved-places/${encodeURIComponent(id)}`, fields);
}

export function deleteSavedPlace(id: string): Promise<unknown> {
  return apiDelete(`/api/saved-places/${encodeURIComponent(id)}`);
}
