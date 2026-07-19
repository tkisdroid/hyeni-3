/**
 * 알림(parent-alerts) 도메인 TanStack Query 훅.
 * 컴포넌트는 이 훅만 import(endpoints/notifications 직접 호출 금지).
 */
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";
import { qk } from "./keys";
import { deriveAuthState, useAuth } from "@/auth/AuthContext";
import { getApiSessionInstanceId, getApiUser } from "@/lib/api/session";
import {
  DEFAULT_NOTIF_SETTINGS,
  fetchFamilyNotificationQuietHours,
  fetchParentAlerts,
  markAlertRead,
  markAllAlertsRead,
  fetchChildNotifSettingsStatus,
  fetchNotifSettings,
  saveNotificationQuietHours,
  saveNotifSettings,
  type FamilyNotificationQuietHours,
  type NotifSettings,
  type ParentAlert,
  type SavedNotificationQuietHours,
} from "@/lib/api/endpoints/notifications";
import type { NotificationQuietHoursDraft } from "@/transform/notificationQuietHours";

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

function assertCurrentQuietHoursParentSession(
  expectedParentUserId: string,
  expectedFamilyId: string,
  expectedSessionInstanceId: string,
): void {
  const current = deriveAuthState();
  if (
    current.status !== "authenticated"
    || current.userId !== expectedParentUserId
    || current.familyId !== expectedFamilyId
    || current.role !== "parent"
    || getApiSessionInstanceId() !== expectedSessionInstanceId
  ) {
    throw new Error("계정 또는 가족이 변경되어 알림 조용한 시간 작업을 중단했어요");
  }
}

/** 부모 본인과 같은 가족 활성 아이들의 조용한 시간 조회. */
export function useFamilyNotificationQuietHours(): UseQueryResult<
  FamilyNotificationQuietHours,
  Error
> {
  const { familyId, role, status, userId } = useAuth();
  const expectedParentUserId = userId;
  const expectedFamilyId = familyId;
  const expectedSessionInstanceId = getApiSessionInstanceId();
  const enabled = status === "authenticated"
    && role === "parent"
    && !!expectedParentUserId
    && !!expectedFamilyId
    && !!expectedSessionInstanceId;

  return useQuery<FamilyNotificationQuietHours, Error>({
    queryKey: qk.familyNotificationQuietHours(expectedFamilyId ?? ""),
    queryFn: () => {
      if (!expectedParentUserId || !expectedFamilyId || !expectedSessionInstanceId) {
        throw new Error("알림 조용한 시간을 조회할 부모 세션이 없어요");
      }
      assertCurrentQuietHoursParentSession(
        expectedParentUserId,
        expectedFamilyId,
        expectedSessionInstanceId,
      );
      return fetchFamilyNotificationQuietHours(expectedFamilyId, expectedParentUserId);
    },
    enabled,
  });
}

export interface SaveNotificationQuietHoursVariables {
  targetUserId: string;
  quietHours: NotificationQuietHoursDraft;
}

/** 부모 본인 또는 활성 아이 한 명의 조용한 시간을 target별로 직렬 저장한다. */
export function useSaveNotificationQuietHours(): UseMutationResult<
  SavedNotificationQuietHours,
  Error,
  SaveNotificationQuietHoursVariables
> {
  const qc = useQueryClient();
  const { familyId, role, status, userId } = useAuth();
  const expectedParentUserId = userId;
  const expectedFamilyId = familyId;
  const expectedSessionInstanceId = getApiSessionInstanceId();

  return useMutation<SavedNotificationQuietHours, Error, SaveNotificationQuietHoursVariables>({
    mutationFn: (variables) => {
      if (
        status !== "authenticated"
        || role !== "parent"
        || !expectedParentUserId
        || !expectedFamilyId
        || !expectedSessionInstanceId
      ) {
        throw new Error("알림 조용한 시간을 저장할 부모 세션이 없어요");
      }
      const scopeId = `notif-quiet-hours:${expectedFamilyId}:${variables.targetUserId}`;
      return qc.getMutationCache().build<
        SavedNotificationQuietHours,
        Error,
        SaveNotificationQuietHoursVariables,
        unknown
      >(
        qc,
        {
          scope: { id: scopeId },
          mutationFn: async (scopedVariables) => {
            assertCurrentQuietHoursParentSession(
              expectedParentUserId,
              expectedFamilyId,
              expectedSessionInstanceId,
            );
            const data = await saveNotificationQuietHours(
              expectedFamilyId,
              expectedParentUserId,
              scopedVariables.targetUserId,
              scopedVariables.quietHours,
            );
            if (data.targetUserId !== variables.targetUserId) {
              throw new Error("저장 대상이 달라져 알림 조용한 시간을 반영하지 않았어요");
            }
            return data;
          },
        },
      ).execute(variables);
    },
    onSuccess: (data) => {
      if (!expectedFamilyId) return;
      qc.setQueryData<FamilyNotificationQuietHours>(
        qk.familyNotificationQuietHours(expectedFamilyId),
        (current) => {
          if (!current || current.familyId !== expectedFamilyId) return current;
          let changed = false;
          const recipients = current.recipients.map((recipient) => {
            if (recipient.targetUserId === data.targetUserId) {
              changed = true;
              return { ...recipient, quietHours: data.quietHours };
            }
            return recipient;
          });
          return changed ? { ...current, recipients } : current;
        },
      );
      if (data.targetUserId === expectedParentUserId && expectedParentUserId) {
        qc.setQueryData<NotifSettings | null>(
          qk.notifSettings(expectedParentUserId),
          (current) => {
            if (current === undefined) return current;
            if (current === null) {
              return { ...DEFAULT_NOTIF_SETTINGS, quietHours: data.quietHours };
            }
            return { ...current, quietHours: data.quietHours };
          },
        );
      }
    },
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
