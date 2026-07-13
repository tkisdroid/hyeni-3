import type { AuthRole, AuthStatus } from "@/auth/AuthContext";
import type { Tier } from "@/transform/tierPolicy";

export interface ReviewRewardQueryScopeInput {
  status: AuthStatus;
  role: AuthRole | null;
  familyId: string | null;
}

export interface ReviewRewardQueryScope {
  enabled: boolean;
  readyWithoutFetch: boolean;
}

export interface ReviewRewardClaimScopeInput extends ReviewRewardQueryScopeInput {
  ready: boolean;
  tier: Tier;
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

/** 지급 CTA와 mutation의 공통 권한 가드. 확정된 무료 부모 가족만 지급을 시도한다. */
export function resolveReviewRewardClaimScope(
  input: ReviewRewardClaimScopeInput,
): Pick<ReviewRewardQueryScope, "enabled"> {
  return {
    enabled:
      input.status === "authenticated" &&
      input.role === "parent" &&
      !!input.familyId &&
      input.ready &&
      input.tier === "free",
  };
}
