/**
 * 게스트 전용 가드 — 이미 가족에 연결된 세션은 온보딩 화면을 볼 수 없다.
 *
 * 온보딩은 세션을 새로 만드는 화면이라(anonymousLogin·로그인·가입), 인증된 사용자가
 * 여기 도달하면 딥링크·오작동 한 번으로 기존 세션이 파괴된다(2026-07-10 실사고:
 * `#/onboarding?pair=CODE` 재진입 → anonymousLogin → 아이 세션이 익명으로 덮임).
 * 컴포넌트 마운트 전에 막는 것이 가장 확실한 방어다.
 *
 * 통과 대상(온보딩이 필요한 상태):
 * - 미인증
 * - 익명 세션 + 가족 미연결(아이 페어링 대기)
 * - 부모/선생님 로그인 + 가족 미생성(가족 설정 단계)
 */
import { useSyncExternalStore, type ReactNode } from "react";
import { Navigate } from "react-router";
import { useAuth } from "./AuthContext";
import { homePathForRole } from "./guards";
import {
  getOnboardingAuthTransitionSnapshot,
  subscribeOnboardingAuthTransition,
} from "./onboardingAuthTransition";

export function RequireGuest({ children }: { children: ReactNode }) {
  const auth = useAuth();
  const authTransitionActive = useSyncExternalStore(
    subscribeOnboardingAuthTransition,
    getOnboardingAuthTransitionSnapshot,
    getOnboardingAuthTransitionSnapshot,
  );
  if (!authTransitionActive && auth.status === "authenticated" && auth.familyId) {
    return <Navigate to={homePathForRole(auth.role)} replace />;
  }
  return <>{children}</>;
}
