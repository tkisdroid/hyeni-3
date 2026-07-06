/**
 * 인증 상태 → 라우팅 판정 헬퍼(순수).
 * claim 기반: role/familyId/isAnonymous 로 다음 단계를 정한다.
 */
import type { AuthState, AuthRole } from "./AuthContext";

/** 미인증 → 온보딩으로. */
export function needsOnboarding(state: AuthState): boolean {
  return state.status !== "authenticated";
}

/** 아이(익명) 로그인했지만 아직 가족 미연결 → 페어링 단계. */
export function needsPairing(state: AuthState): boolean {
  return state.status === "authenticated" && state.isAnonymous && !state.familyId;
}

/** 부모 로그인했지만 가족 미생성 → 가족 설정 단계(선생님 제외). */
export function needsFamilySetup(state: AuthState): boolean {
  return (
    state.status === "authenticated" &&
    !state.isAnonymous &&
    state.role !== "teacher" &&
    !state.familyId
  );
}

/** role 별 홈 경로. */
export function homePathForRole(role: AuthRole | null): string {
  if (role === "child") return "/child/home";
  if (role === "teacher") return "/teacher/home";
  return "/parent/home";
}
