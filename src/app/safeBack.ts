import type { AuthRole } from "../auth/AuthContext.tsx";
import { homePathForRole } from "../auth/guards.ts";

export interface SafeBackInput {
  historyIndex: number | null | undefined;
  explicitFallback?: string;
  role: AuthRole | null;
}

export type SafeBackTarget =
  | { kind: "history" }
  | { kind: "route"; to: string };

const PARENT_DETAIL_FALLBACKS = new Set(["/notifications"]);
const CHILD_DETAIL_FALLBACKS = new Set(["/playdate-accept"]);

function isSameRoleRoute(route: string, role: AuthRole | null): boolean {
  if (!route.startsWith("/") || route.startsWith("//") || route.includes("?") || route.includes("#")) {
    return false;
  }
  if (role === "parent") {
    return route.startsWith("/parent/") || PARENT_DETAIL_FALLBACKS.has(route);
  }
  if (role === "child") {
    return route.startsWith("/child/") || CHILD_DETAIL_FALLBACKS.has(route);
  }
  if (role === "teacher") return route.startsWith("/teacher/");
  return false;
}

/**
 * 앱 내부 이동 이력이 있으면 그 이력을 사용하고, 콜드 스타트에서는 현재 역할을
 * 벗어나지 않는 화면 fallback 또는 역할 홈으로 이동한다.
 */
export function resolveSafeBackTarget({
  historyIndex,
  explicitFallback,
  role,
}: SafeBackInput): SafeBackTarget {
  if (Number.isInteger(historyIndex) && Number(historyIndex) >= 1) {
    return { kind: "history" };
  }
  if (explicitFallback && isSameRoleRoute(explicitFallback, role)) {
    return { kind: "route", to: explicitFallback };
  }
  return { kind: "route", to: homePathForRole(role) };
}
