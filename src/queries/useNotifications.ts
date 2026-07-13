/**
 * 알림(parent-alerts) 도메인 TanStack Query 훅.
 * 컴포넌트는 이 훅만 import(endpoints/notifications 직접 호출 금지).
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { qk } from "./keys";
import { useAuth } from "@/auth/AuthContext";
import { getApiSessionInstanceId, getApiUser } from "@/lib/api/session";
import {
  fetchParentAlerts,
  markAlertRead,
  markAllAlertsRead,
  fetchChildNotifSettingsStatus,
  fetchNotifSettings,
  saveNotifSettings,
  type NotifSettings,
  type ParentAlert,
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

/**
 * "모두 읽음" — 서버 1요청(read-all) + 낙관적 업데이트로 UI 즉시 반영.
 * onMutate 에서 캐시의 read 를 전부 true 로 바꿔 목록·배지가 바로 지워지고,
 * 실패 시 스냅샷으로 원복한다(정직: 실패를 숨기지 않음). 완료 후 서버 기준 재검증.
 */
export function useMarkAllAlertsRead() {
  const qc = useQueryClient();
  const { familyId } = useAuth();
  const key = qk.parentAlerts(familyId ?? "");
  return useMutation<{ ok: boolean; updated: number }, Error, void, { prev?: ParentAlert[] }>({
    mutationFn: () => markAllAlertsRead(familyId as string),
    onMutate: async () => {
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<ParentAlert[]>(key);
      if (prev) qc.setQueryData<ParentAlert[]>(key, prev.map((a) => (a.read ? a : { ...a, read: true })));
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(key, ctx.prev);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: key }),
  });
}

/** 호출자 알림 설정 조회. 미저장이면 data=null → 화면이 기본값으로 시작. */
export function useNotifSettings() {
  const { userId, status } = useAuth();
  return useQuery({
    queryKey: qk.notifSettings(userId ?? ""),
    queryFn: () => fetchNotifSettings(),
    enabled: status === "authenticated" && !!userId,
  });
}

/** 부모가 현재 선택한 아이의 일정 알림 허용 상태만 조회한다. */
export function useChildNotifSettingsStatus(childUserId: string | null | undefined) {
  const { familyId, role, status } = useAuth();
  return useQuery({
    queryKey: qk.childNotifSettings(familyId ?? "", childUserId ?? ""),
    queryFn: () => fetchChildNotifSettingsStatus(familyId as string, childUserId as string),
    enabled:
      status === "authenticated"
      && role === "parent"
      && !!familyId
      && !!childUserId,
  });
}

/**
 * 알림 설정 저장(upsert) → 성공 시 캐시 반영. familyId 는 다른 기기 fan-out 통지용.
 * 컴포넌트가 낙관적 초안을 들고 있고, 실패는 onError 로 표면화한다.
 */
export function useSaveNotifSettings() {
  const qc = useQueryClient();
  const { userId, familyId } = useAuth();
  const expectedUserId = userId;
  const expectedSessionInstanceId = getApiSessionInstanceId();
  return useMutation<void, Error, NotifSettings>({
    // notif-settings POST는 전체 객체 upsert다. 같은 사용자의 빠른 연속 변경을
    // 병렬 실행하면 늦게 끝난 과거 요청이 최신 초안을 덮으므로 반드시 직렬화한다.
    scope: { id: `notif-settings:${userId ?? "anonymous"}` },
    mutationFn: (settings) => {
      if (!expectedUserId || !expectedSessionInstanceId) {
        throw new Error("알림 설정을 저장할 로그인 세션이 없어요");
      }
      if (
        getApiUser()?.id !== expectedUserId
        || getApiSessionInstanceId() !== expectedSessionInstanceId
      ) {
        throw new Error("계정이 변경되어 이전 알림 설정 저장을 중단했어요");
      }
      return saveNotifSettings(familyId ?? null, expectedUserId, settings);
    },
    onSuccess: (_data, settings) => {
      if (expectedUserId) qc.setQueryData(qk.notifSettings(expectedUserId), settings);
    },
  });
}
