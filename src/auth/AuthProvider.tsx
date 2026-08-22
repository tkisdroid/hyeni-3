/**
 * 인증 상태 프로바이더.
 * - session.ts 가 import 시점에 localStorage 세션을 동기 복원 → 초기 상태 즉시 확정.
 * - 토큰 회전(refresh) 시 session.ts 의 onTokensChanged 로 상태 재동기화.
 * - 로그아웃/계정삭제 시 queryClient.clear() 로 이전 사용자 캐시 제거.
 */
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { getApiSessionInstanceId, setOnApiTokensChanged } from "@/lib/api/session";
import { logout as apiLogout, deleteAccount as apiDeleteAccount } from "@/lib/api/endpoints/auth";
import { stopLocationTracking, syncNativeLocationToken } from "@/lib/native/location";
import { unregisterPushBeforeLogout } from "@/lib/native/push";
import { syncWebPushSessionContext, unsubscribeWebPush } from "@/lib/webPush";
import { beginPushSessionCleanup } from "@/lib/pushSessionBarrier";
import { queryClient } from "@/queries/QueryProvider";
import { AuthContext, deriveAuthState, type AuthContextValue } from "./AuthContext";

async function cleanupPushBeforeSessionEnd(userId: string | null): Promise<void> {
  const registrationInstanceId = getApiSessionInstanceId()?.trim() ?? "";
  const cleanup = beginPushSessionCleanup();
  // 진행 중 등록이 끝난 뒤에만 해제한다. UI는 3초 후 로그아웃을 계속하지만,
  // 실제 정리가 끝날 때까지 새 세션의 등록은 장벽 뒤에서 기다린다.
  const cleanupTask = (async () => {
    await cleanup.waitForRegistrations();
    await Promise.allSettled([
      unregisterPushBeforeLogout(userId, {
        signal: cleanup.signal,
        registrationInstanceId,
      }),
      unsubscribeWebPush({
        signal: cleanup.signal,
        registrationInstanceId,
      }),
      syncWebPushSessionContext(null),
    ]);
  })().finally(() => cleanup.finish());

  let timeoutId: number | undefined;
  const timeout = new Promise<void>((resolve) => {
    timeoutId = window.setTimeout(() => {
      cleanup.abort();
      resolve();
    }, 3_000);
  });
  await Promise.race([cleanupTask, timeout]);
  if (timeoutId !== undefined) window.clearTimeout(timeoutId);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState(deriveAuthState);

  const syncFromSession = useCallback(() => {
    setState(deriveAuthState());
  }, []);

  // 토큰 회전(client.ts refreshAccess → notifyTokens) 시 상태 반영.
  useEffect(() => {
    setOnApiTokensChanged((tokens) => {
      if (!tokens.access) {
        queryClient.clear();
        void stopLocationTracking({ clearSession: true });
        void syncWebPushSessionContext(null);
      }
      syncFromSession();
      void syncNativeLocationToken();
    });
    return () => setOnApiTokensChanged(null);
  }, [syncFromSession]);

  const logout = useCallback(async () => {
    await cleanupPushBeforeSessionEnd(state.userId);
    await stopLocationTracking({ clearSession: true });
    await apiLogout();
    queryClient.clear();
    syncFromSession();
  }, [state.userId, syncFromSession]);

  const deleteAccount = useCallback(async () => {
    await cleanupPushBeforeSessionEnd(state.userId);
    await stopLocationTracking({ clearSession: true });
    await apiDeleteAccount();
    queryClient.clear();
    syncFromSession();
  }, [state.userId, syncFromSession]);

  const value: AuthContextValue = {
    ...state,
    syncFromSession,
    logout,
    deleteAccount,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
