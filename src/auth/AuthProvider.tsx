/**
 * 인증 상태 프로바이더.
 * - session.ts 가 import 시점에 localStorage 세션을 동기 복원 → 초기 상태 즉시 확정.
 * - 토큰 회전(refresh) 시 session.ts 의 onTokensChanged 로 상태 재동기화.
 * - 로그아웃/계정삭제 시 queryClient.clear() 로 이전 사용자 캐시 제거.
 */
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { setOnApiTokensChanged } from "@/lib/api/session";
import { logout as apiLogout, deleteAccount as apiDeleteAccount } from "@/lib/api/endpoints/auth";
import { stopLocationTracking } from "@/lib/native/location";
import { queryClient } from "@/queries/QueryProvider";
import { AuthContext, deriveAuthState, type AuthContextValue } from "./AuthContext";

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState(deriveAuthState);

  const syncFromSession = useCallback(() => {
    setState(deriveAuthState());
  }, []);

  // 토큰 회전(client.ts refreshAccess → notifyTokens) 시 상태 반영.
  useEffect(() => {
    setOnApiTokensChanged(() => syncFromSession());
    return () => setOnApiTokensChanged(null);
  }, [syncFromSession]);

  const logout = useCallback(async () => {
    await stopLocationTracking({ clearSession: true });
    apiLogout();
    queryClient.clear();
    syncFromSession();
  }, [syncFromSession]);

  const deleteAccount = useCallback(async () => {
    await stopLocationTracking({ clearSession: true });
    await apiDeleteAccount();
    queryClient.clear();
    syncFromSession();
  }, [syncFromSession]);

  const value: AuthContextValue = {
    ...state,
    syncFromSession,
    logout,
    deleteAccount,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
