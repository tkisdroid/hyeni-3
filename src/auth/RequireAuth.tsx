/**
 * 인증 가드. 미인증이면 /onboarding 으로.
 * (라우터 삽입은 Slice 2 — 온보딩 로그인이 실제 동작할 때 활성화.)
 */
import { Navigate, Outlet } from "react-router-dom";
import { useAuth } from "./AuthContext";
import { needsOnboarding } from "./guards";

export function RequireAuth() {
  const auth = useAuth();
  if (needsOnboarding(auth)) return <Navigate to="/onboarding" replace />;
  return <Outlet />;
}
