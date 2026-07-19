import type { QueryClient } from "@tanstack/react-query";
import type { NotifSettings } from "@/lib/api/endpoints/notifications";

export interface NotificationQuietHoursSessionSnapshot {
  readonly parentUserId: string;
  readonly familyId: string;
  readonly sessionInstanceId: string;
}

export interface NotificationQuietHoursSessionState {
  readonly status: "authenticated" | "unauthenticated";
  readonly userId: string | null;
  readonly familyId: string | null;
  readonly role: string | null;
  readonly sessionInstanceId: string | null;
}

interface NotificationQuietHoursTargetVariables {
  readonly targetUserId: string;
}

/** 일반 설정 POST는 quiet 컬럼을 저장하지 않으므로 최신 quiet 캐시를 덮지 않는다. */
export function mergeNotifSettingsPreservingQuietHours(
  current: NotifSettings | null | undefined,
  submitted: NotifSettings,
): NotifSettings | null | undefined {
  if (current === undefined) return undefined;
  if (current === null) return submitted;
  return { ...submitted, quietHours: current.quietHours };
}

export function isNotificationQuietHoursSessionCurrent(
  snapshot: NotificationQuietHoursSessionSnapshot,
  current: NotificationQuietHoursSessionState,
): boolean {
  return current.status === "authenticated"
    && current.userId === snapshot.parentUserId
    && current.familyId === snapshot.familyId
    && current.role === "parent"
    && current.sessionInstanceId === snapshot.sessionInstanceId;
}

function assertNotificationQuietHoursSessionCurrent(
  snapshot: NotificationQuietHoursSessionSnapshot,
  readCurrentSession: () => NotificationQuietHoursSessionState,
): void {
  if (!isNotificationQuietHoursSessionCurrent(snapshot, readCurrentSession())) {
    throw new Error("계정 또는 가족이 변경되어 알림 조용한 시간 작업을 중단했어요");
  }
}

export async function runNotificationQuietHoursSessionBound<T>(
  snapshot: NotificationQuietHoursSessionSnapshot,
  readCurrentSession: () => NotificationQuietHoursSessionState,
  request: () => Promise<T>,
): Promise<T> {
  assertNotificationQuietHoursSessionCurrent(snapshot, readCurrentSession);
  const data = await request();
  assertNotificationQuietHoursSessionCurrent(snapshot, readCurrentSession);
  return data;
}

export function commitNotificationQuietHoursIfSessionCurrent(
  snapshot: NotificationQuietHoursSessionSnapshot,
  readCurrentSession: () => NotificationQuietHoursSessionState,
  commit: () => void,
): boolean {
  if (!isNotificationQuietHoursSessionCurrent(snapshot, readCurrentSession())) return false;
  commit();
  return true;
}

export function executeNotificationQuietHoursScopedMutation<
  TData,
  TVariables extends NotificationQuietHoursTargetVariables,
>(
  queryClient: QueryClient,
  familyId: string,
  variables: TVariables,
  mutationFn: (variables: TVariables) => Promise<TData>,
): Promise<TData> {
  return queryClient.getMutationCache().build<TData, Error, TVariables, unknown>(
    queryClient,
    {
      scope: { id: `notif-quiet-hours:${familyId}:${variables.targetUserId}` },
      mutationFn,
    },
  ).execute(variables);
}
