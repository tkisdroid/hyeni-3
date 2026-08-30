import type { AuthRole } from "@/auth/AuthContext";

export function resolveMathMiniAppDestination(role: AuthRole): string | null {
  if (role === "parent") return "/study";
  if (role === "child") return "/study/learn";
  return null;
}
