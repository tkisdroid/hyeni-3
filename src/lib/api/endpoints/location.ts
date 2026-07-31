/**
 * 위치 도메인 엔드포인트(자녀 현재위치/이력, 위험구역, 저장장소).
 */
import { apiGet, apiPost, apiPatch, apiDelete } from "../client";

export interface ChildLocation {
  user_id: string;
  lat: number;
  lng: number;
  updated_at: string; // "YYYY-MM-DD HH:MM:SS.mmm+00"
  /** 마지막 GPS fix의 수평 오차(m). 레거시 행은 null/미제공. */
  accuracy_m?: number | null;
}

export interface ReverseGeocodeResult {
  ok: boolean;
  label: string;
  address: string;
  buildingName: string | null;
}

export interface LocationHistoryPoint {
  user_id: string;
  lat: number;
  lng: number;
  recorded_at: string;
  /** 해당 실제 GPS fix의 수평 오차(m). 추정점·레거시 행은 null/미제공. */
  accuracy_m?: number | null;
  /** true/1이면 실제 GPS점 사이를 메운 추정 좌표. */
  is_estimated?: boolean | number;
}

export interface DangerZone {
  id: string;
  family_id: string;
  name: string;
  lat: number;
  lng: number;
  radius_m: number;
  zone_type: string; // "custom" 등
  alert_on_entry?: boolean;
  alert_on_exit?: boolean;
  created_at?: string;
}

function toFlag(value: unknown, fallback: boolean): boolean {
  if (value == null) return fallback;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") return value !== "0" && value.toLowerCase() !== "false";
  return fallback;
}

export interface SavedPlaceLocation {
  lat: number;
  lng: number;
  address?: string;
  kakao_place_id?: string | null;
  category?: "home" | "academy" | "frequent" | string;
  /** 도착/출발 알림 반경 m(30~300). 없으면 기본 30m(학교 100m·조부모댁 등 가족 주거지 150m 자동 적용). */
  alertRadiusM?: number;
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

export type LocationIntervalMode = "live" | "balanced" | "saver";

export interface LocationPreferences {
  family_id: string;
  background_enabled: boolean;
  interval_mode: LocationIntervalMode;
  battery_saver_exception: boolean;
  updated_by: string | null;
  updated_at: string | null;
}

export interface LocationPreferencesInput {
  background_enabled: boolean;
  interval_mode: LocationIntervalMode;
  battery_saver_exception: boolean;
}

/** 자녀 현재 위치 목록. */
export function fetchChildLocations(familyId: string): Promise<ChildLocation[]> {
  return apiGet<ChildLocation[]>(`/api/location/children?family_id=${encodeURIComponent(familyId)}`);
}

/** 가족 위치 전송 설정(부모 저장, 아이 기기 반영). */
export function fetchLocationPreferences(familyId: string): Promise<LocationPreferences> {
  return apiGet<LocationPreferences>(`/api/location-prefs?family_id=${encodeURIComponent(familyId)}`);
}

export function saveLocationPreferences(
  familyId: string,
  prefs: LocationPreferencesInput,
): Promise<LocationPreferences> {
  return apiPost<LocationPreferences>("/api/location-prefs", {
    family_id: familyId,
    background_enabled: prefs.background_enabled,
    interval_mode: prefs.interval_mode,
    battery_saver_exception: prefs.battery_saver_exception,
  });
}

/** 좌표 → 사용자 표시용 건물명/주소. */
export function reverseGeocodeLocation(point: { lat: number; lng: number }): Promise<ReverseGeocodeResult> {
  return apiPost<ReverseGeocodeResult>("/api/kakao/reverse-geocode", {
    lat: point.lat,
    lng: point.lng,
  });
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
  return apiGet<Array<DangerZone & { alert_on_entry?: unknown; alert_on_exit?: unknown }>>(
    `/api/danger-zones?family_id=${encodeURIComponent(familyId)}`,
  ).then((rows) =>
    (rows ?? []).map((z) => ({
      ...z,
      alert_on_entry: toFlag(z.alert_on_entry, true),
      alert_on_exit: toFlag(z.alert_on_exit, false),
    })),
  );
}

export type DangerZoneInput = {
  name: string;
  lat: number;
  lng: number;
  radius_m: number;
  zone_type?: string;
  alert_on_entry?: boolean;
  alert_on_exit?: boolean;
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
