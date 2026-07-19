/**
 * 위치 도메인 TanStack Query 훅.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { qk } from "./keys";
import { useAuth } from "@/auth/AuthContext";
import {
  fetchChildLocations,
  fetchLocationPreferences,
  fetchLocationHistory,
  fetchDangerZones,
  fetchSavedPlaces,
  createDangerZone,
  updateDangerZone,
  deleteDangerZone,
  createSavedPlace,
  deleteSavedPlace,
  saveLocationPreferences,
  type DangerZoneInput,
  type LocationPreferencesInput,
  type NewSavedPlace,
} from "@/lib/api/endpoints/location";

export function useChildLocations() {
  const { familyId, status } = useAuth();
  return useQuery({
    queryKey: qk.childLocations(familyId ?? ""),
    queryFn: () => fetchChildLocations(familyId as string),
    enabled: status === "authenticated" && !!familyId,
    // 위치는 자주 갱신 — 30s마다 폴링(WS invalidate 보완)
    refetchInterval: 30_000,
  });
}

/** 가족 단위 위치 전송 주기·백그라운드 설정. */
export function useLocationPreferences() {
  const { familyId, status } = useAuth();
  return useQuery({
    queryKey: qk.locationPreferences(familyId ?? ""),
    queryFn: () => fetchLocationPreferences(familyId as string),
    enabled: status === "authenticated" && !!familyId,
  });
}

/** 위치 설정 저장 후 동일 가족의 설정 캐시를 서버 응답으로 즉시 맞춘다. */
interface SaveLocationPreferencesVariables {
  familyId: string;
  prefs: LocationPreferencesInput;
}

export function useSaveLocationPreferences() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ familyId, prefs }: SaveLocationPreferencesVariables) => {
      if (!familyId) throw new Error("가족 정보를 확인하지 못했어요");
      return saveLocationPreferences(familyId, prefs);
    },
    onSuccess: (saved, { familyId }) => {
      if (saved.family_id !== familyId) {
        throw new Error("저장된 위치 설정의 가족 범위가 일치하지 않아요");
      }
      qc.setQueryData(qk.locationPreferences(familyId), saved);
    },
  });
}

export function useLocationHistory(start: string, end: string, enabled = true) {
  const { familyId, status } = useAuth();
  return useQuery({
    queryKey: qk.locationHistory(familyId ?? "", start, end),
    queryFn: () => fetchLocationHistory(familyId as string, start, end),
    enabled: enabled && status === "authenticated" && !!familyId,
  });
}

export function useDangerZones() {
  const { familyId, status } = useAuth();
  return useQuery({
    queryKey: qk.dangerZones(familyId ?? ""),
    queryFn: () => fetchDangerZones(familyId as string),
    enabled: status === "authenticated" && !!familyId,
  });
}

export function useSavedPlaces() {
  const { familyId, status } = useAuth();
  return useQuery({
    queryKey: qk.savedPlaces(familyId ?? ""),
    queryFn: () => fetchSavedPlaces(familyId as string),
    enabled: status === "authenticated" && !!familyId,
  });
}

export function useCreateDangerZone() {
  const qc = useQueryClient();
  const { familyId } = useAuth();
  return useMutation({
    mutationFn: (zone: DangerZoneInput) => createDangerZone(familyId as string, zone),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.dangerZones(familyId ?? "") }),
  });
}

/** 위험구역 편집(부분수정). 편집 폼에서 delete+create 교체 대신 id 를 실어 in-place 갱신. */
export function useUpdateDangerZone() {
  const qc = useQueryClient();
  const { familyId } = useAuth();
  return useMutation({
    mutationFn: ({ id, zone }: { id: string; zone: DangerZoneInput }) =>
      updateDangerZone(familyId as string, id, zone),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.dangerZones(familyId ?? "") }),
  });
}

export function useDeleteDangerZone() {
  const qc = useQueryClient();
  const { familyId } = useAuth();
  return useMutation({
    mutationFn: (id: string) => deleteDangerZone(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.dangerZones(familyId ?? "") }),
  });
}

export function useCreateSavedPlace() {
  const qc = useQueryClient();
  const { familyId } = useAuth();
  return useMutation({
    mutationFn: (row: Omit<NewSavedPlace, "family_id">) =>
      createSavedPlace({ ...row, family_id: familyId as string }),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.savedPlaces(familyId ?? "") }),
  });
}

export function useDeleteSavedPlace() {
  const qc = useQueryClient();
  const { familyId } = useAuth();
  return useMutation({
    mutationFn: (id: string) => deleteSavedPlace(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.savedPlaces(familyId ?? "") }),
  });
}
