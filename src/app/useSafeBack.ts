import { useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/auth/AuthContext";
import { homePathForRole } from "@/auth/guards";
import { resolveSafeBackTarget } from "./safeBack";

/** HashRouter의 현재 세션 history를 확인해 안전하게 뒤로 이동한다. */
export function useSafeBack(explicitFallback?: string): () => void {
  const navigate = useNavigate();
  const { role } = useAuth();

  return useCallback(() => {
    const historyIndex = window.history.state?.idx;
    const target = resolveSafeBackTarget({
      historyIndex: typeof historyIndex === "number" ? historyIndex : undefined,
      explicitFallback: explicitFallback ?? homePathForRole(role),
      role,
    });

    if (target.kind === "history") {
      navigate(-1);
      return;
    }
    navigate(target.to, { replace: true });
  }, [explicitFallback, navigate, role]);
}
