import type { AuthRole, AuthStatus } from "@/auth/AuthContext";

export interface ReviewRewardQueryScopeInput {
  status: AuthStatus;
  role: AuthRole | null;
  familyId: string | null;
}

export interface ReviewRewardQueryScope {
  enabled: boolean;
  readyWithoutFetch: boolean;
}

export function resolveReviewRewardQueryScope(
  input: ReviewRewardQueryScopeInput,
): ReviewRewardQueryScope {
  if (input.status !== "authenticated" || !input.familyId) {
    return { enabled: false, readyWithoutFetch: false };
  }
  if (input.role !== "parent") {
    return { enabled: false, readyWithoutFetch: true };
  }
  return {
    enabled: true,
    readyWithoutFetch: false,
  };
}
