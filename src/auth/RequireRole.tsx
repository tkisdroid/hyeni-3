/**
 * role 가드. 미인증→/onboarding, role 불일치→해당 role 홈으로.
 * (라우터 삽입은 Slice 2.)
 */
import { Navigate, Outlet } from "react-router-dom";
import { useAuth } from "./AuthContext";
import { needsOnboarding, homePathForRole } from "./guards";
import type { AuthRole } from "./AuthContext";

export function RequireRole({ role }: { role: AuthRole }) {
  const auth = useAuth();
  if (needsOnboarding(auth)) return <Navigate to="/onboarding" replace />;
  if (auth.role === role) return <Outlet />;
  // 인증됐지만 다른 role → 해당 role 홈. role 미확정(null: 페어링/설정 전) → 온보딩으로.
  if (auth.role) return <Navigate to={homePathForRole(auth.role)} replace />;
  return <Navigate to="/onboarding" replace />;
}
