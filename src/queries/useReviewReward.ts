/**
 * 기존 스토어 방문 혜택 TanStack Query 조회 훅.
 * 컴포넌트는 이 훅(또는 이를 합성한 useEntitlement)만 사용 — endpoints 직접 호출 금지.
 *
 * ready=false(첫 조회 중 / 캐시 없음) 동안에는 reviewed 를 신뢰하지 말 것.
 * useEntitlement 가 tier 판정에서 이 ready 를 함께 본다(비프리미엄일 때 free/reviewed 구분).
 *
 */
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/auth/AuthContext";
import { fetchReviewReward } from "@/lib/api/endpoints/reviewReward";
import { resolveReviewRewardQueryScope } from "@/transform/reviewRewardScope";
import { qk } from "./keys";

export interface UseReviewRewardResult {
  /** 과거 스토어 방문 혜택이 부여되었는가. 사용자에게 별도 티어로 노출하지 않으며 ready=false면 항상 false. */
  rewarded: boolean;
  /** 조회가 확정되었는가(성공 data 또는 캐시 존재). false면 reviewed 판단 보류. */
  ready: boolean;
  isLoading: boolean;
  isError: boolean;
  isFetching: boolean;
  refetch: () => Promise<void>;
}

export interface UseReviewRewardOptions {
  /** effective 정본이 없는 구버전 Worker 호환 판정에서만 true로 연다. */
  enabled?: boolean;
}

/** 현재 가족의 기존 보상 여부(/api/review-rewards). 이미 받은 가족의 한도 유지 판정에 사용. */
export function useReviewReward(options: UseReviewRewardOptions = {}): UseReviewRewardResult {
  const { familyId, status, role } = useAuth();
  const scope = resolveReviewRewardQueryScope({ status, role, familyId });
  const queryEnabled = scope.enabled && options.enabled !== false;
  const query = useQuery({
    queryKey: qk.reviewReward(familyId ?? ""),
    queryFn: () => fetchReviewReward(familyId as string),
    enabled: queryEnabled,
  });

  const ready = scope.readyWithoutFetch || (queryEnabled && query.data !== undefined);
  return {
    rewarded: queryEnabled && ready && query.data?.rewarded === true,
    ready,
    isLoading: queryEnabled && query.isLoading,
    isError: queryEnabled && query.isError,
    isFetching: queryEnabled && query.isFetching,
    refetch: async () => {
      if (queryEnabled) await query.refetch();
    },
  };
}
