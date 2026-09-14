import type { AuthRole } from "@/auth/AuthContext";
import { normalizeAccessCountry } from "../../transform/accessCountry.ts";

/** 한국 전용 미니앱 허브의 접속 국가 경계. 판정 불가 시 노출하지 않는다. */
export function isMiniAppsMarket(accessCountry: unknown): boolean {
  return normalizeAccessCountry(accessCountry) === "KR";
}

export function resolveMathMiniAppDestination(role: AuthRole): string | null {
  if (role === "parent") return "/study";
  if (role === "child") return "/study/learn";
  return null;
}

export function resolveVocabularyMiniAppDestination(role: AuthRole): string | null {
  if (role === "parent") return "/study/vocabulary";
  if (role === "child") return "/study/vocabulary/learn";
  return null;
}
