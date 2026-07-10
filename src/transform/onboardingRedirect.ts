type OnboardingRole = "parent" | "child" | "teacher" | null;

interface AuthenticatedOnboardingRedirectInput {
  role: OnboardingRole;
  familyId: string | null;
  hasOAuthCallback: boolean;
  /**
   * QR 딥링크(?pair=)로 진입했는지. 인증 상태에서는 리다이렉트를 막지 않는다.
   * (예전엔 pair 파라미터가 있으면 온보딩에 머물렀고, 그 자리에서 딥링크 핸들러의
   *  anonymousLogin 이 기존 세션을 익명으로 덮어써 로그아웃됐다 — 2026-07-10 실사고.)
   */
  hasPairParam?: boolean;
}

/**
 * 이미 가족에 연결된 세션이 온보딩에 진입하면 역할 홈으로 되돌린다.
 * OAuth 콜백 처리 중(?code&state)일 때만 예외 — 콜백이 세션을 완성해야 하기 때문.
 *
 * 부모가 아이 초대 QR 을 자기 폰으로 스캔하거나 잘못된 링크를 눌러도 세션이 살아남아야 한다.
 * 다른 가족으로 옮기려면 명시적 로그아웃이 선행돼야 한다.
 */
export function resolveAuthenticatedOnboardingRedirect({
  role,
  familyId,
  hasOAuthCallback,
}: AuthenticatedOnboardingRedirectInput): string | null {
  if (hasOAuthCallback) return null;
  if (!role || !familyId) return null;
  if (role === "child") return "/child/home";
  if (role === "teacher") return "/teacher/home";
  return "/parent/home";
}
