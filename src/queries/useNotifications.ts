/**
 * 알림(parent-alerts) 도메인 TanStack Query 훅.
 * 컴포넌트는 이 훅만 import(endpoints/notifications 직접 호출 금지).
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { qk } from "./keys";
import { useAuth } from "@/auth/AuthContext";
import {
  fetchParentAlerts,
  markAlertRead,
  fetchNotifSettings,
  saveNotifSettings,
  type NotifSettings,
} from "@/lib/api/endpoints/notifications";

/** 가족 부모 알림 목록(최신순). limit 기본 50. */
export function useParentAlerts(limit = 50) {
  const { familyId, status } = useAuth();
  return useQuery({
    queryKey: qk.parentAlerts(familyId ?? ""),
    queryFn: () => fetchParentAlerts(familyId as string, limit),
    enabled: status === "authenticated" && !!familyId,
  });
}

/** 단일 알림 읽음 처리 → 알림 캐시 무효화. 사용자 액션(탭·버튼)에서만 mutate 호출. */
export function useMarkAlertRead() {
  const qc = useQueryClient();
  const { familyId } = useAuth();
  return useMutation({
    mutationFn: (alertId: string) => markAlertRead(alertId),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.parentAlerts(familyId ?? "") }),
  });
}

/** 알림 설정 queryKey(per-user). keys.ts 공유 팩토리를 건드리지 않도록 로컬 정의. */
function notifSettingsKey(userId: string) {
  return ["notif-settings", userId] as const;
}

/** 호출자 알림 설정 조회. 미저장이면 data=null → 화면이 기본값으로 시작. */
export function useNotifSettings() {
  const { userId, status } = useAuth();
  return useQuery({
    queryKey: notifSettingsKey(userId ?? ""),
    queryFn: () => fetchNotifSettings(),
    enabled: status === "authenticated" && !!userId,
  });
}

/**
 * 알림 설정 저장(upsert) → 성공 시 캐시 반영. familyId 는 다른 기기 fan-out 통지용.
 * 컴포넌트가 낙관적 초안을 들고 있고, 실패는 onError 로 표면화한다.
 */
export function useSaveNotifSettings() {
  const qc = useQueryClient();
  const { userId, familyId } = useAuth();
  return useMutation<void, Error, NotifSettings>({
    mutationFn: (settings) => saveNotifSettings(familyId ?? null, settings),
    onSuccess: (_data, settings) => {
      qc.setQueryData(notifSettingsKey(userId ?? ""), settings);
    },
  });
}
