type OnboardingRole = "parent" | "child" | "teacher" | null;

interface AuthenticatedOnboardingRedirectInput {
  role: OnboardingRole;
  familyId: string | null;
  hasOAuthCallback: boolean;
  hasPairParam: boolean;
}

export function resolveAuthenticatedOnboardingRedirect({
  role,
  familyId,
  hasOAuthCallback,
  hasPairParam,
}: AuthenticatedOnboardingRedirectInput): string | null {
  if (hasOAuthCallback || hasPairParam) return null;
  if (!role || !familyId) return null;
  if (role === "child") return "/child/home";
  if (role === "teacher") return "/teacher/home";
  return "/parent/home";
}
