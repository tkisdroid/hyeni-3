/**
 * 리뷰 보상 티어 TanStack Query 조회·지급 훅.
 * 컴포넌트는 이 훅(또는 이를 합성한 useEntitlement)만 사용 — endpoints 직접 호출 금지.
 *
 * ready=false(첫 조회 중 / 캐시 없음) 동안에는 reviewed 를 신뢰하지 말 것.
 * useEntitlement 가 tier 판정에서 이 ready 를 함께 본다(비프리미엄일 때 free/reviewed 구분).
 *
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/auth/AuthContext";
import { claimReviewReward, fetchReviewReward } from "@/lib/api/endpoints/reviewReward";
import {
  resolveReviewRewardClaimScope,
  resolveReviewRewardQueryScope,
} from "@/transform/reviewRewardScope";
import type { Tier } from "@/transform/tierPolicy";
import { qk } from "./keys";

export interface UseReviewRewardResult {
  /** 스토어 리뷰 보상(리뷰 티어)이 부여되었는가. ready=false면 항상 false. */
  rewarded: boolean;
  /** 조회가 확정되었는가(성공 data 또는 캐시 존재). false면 reviewed 판단 보류. */
  ready: boolean;
  isLoading: boolean;
  isError: boolean;
}

/** 현재 가족의 리뷰 보상 여부(/api/review-rewards). 무료 한도 상향(리뷰 티어) 판정에 사용. */
export function useReviewReward(): UseReviewRewardResult {
  const { familyId, status, role } = useAuth();
  const scope = resolveReviewRewardQueryScope({ status, role, familyId });
  const query = useQuery({
    queryKey: qk.reviewReward(familyId ?? ""),
    queryFn: () => fetchReviewReward(familyId as string),
    enabled: scope.enabled,
  });

  const ready = scope.readyWithoutFetch || query.data !== undefined;
  return {
    rewarded: !scope.readyWithoutFetch && ready && query.data?.rewarded === true,
    ready,
    isLoading: query.isLoading,
    isError: query.isError,
  };
}

export interface UseClaimReviewRewardInput {
  ready: boolean;
  tier: Tier;
}

/** 인증 부모의 확정된 무료 티어만 지급하고, 성공 즉시 조회 cache를 reviewed 상태로 갱신한다. */
export function useClaimReviewReward(input: UseClaimReviewRewardInput) {
  const { familyId, status, role } = useAuth();
  const queryClient = useQueryClient();
  const scope = resolveReviewRewardClaimScope({
    status,
    role,
    familyId,
    ready: input.ready,
    tier: input.tier,
  });
  const mutation = useMutation({
    mutationFn: async () => {
      if (!scope.enabled || !familyId) throw new Error("리뷰 혜택을 받을 수 없는 상태예요");
      const claimedFamilyId = familyId;
      await claimReviewReward(claimedFamilyId);
      return { familyId: claimedFamilyId };
    },
    onSuccess: ({ familyId }) => {
      queryClient.setQueryData(qk.reviewReward(familyId), { rewarded: true });
    },
    meta: { silentError: true },
  });

  return { ...mutation, canClaim: scope.enabled };
}
