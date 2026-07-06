/**
 * 리뷰 보상 티어 TanStack Query 훅(조회 전용).
 * 컴포넌트는 이 훅(또는 이를 합성한 useEntitlement)만 사용 — endpoints 직접 호출 금지.
 *
 * ready=false(첫 조회 중 / 캐시 없음) 동안에는 reviewed 를 신뢰하지 말 것.
 * useEntitlement 가 tier 판정에서 이 ready 를 함께 본다(비프리미엄일 때 free/reviewed 구분).
 *
 * ※ queryKey 는 keys.ts(qk) 소유 밖이라 로컬 키(["reviewReward", familyId])로 조준한다.
 */
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/auth/AuthContext";
import { fetchReviewReward } from "@/lib/api/endpoints/reviewReward";

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
  const { familyId, status } = useAuth();
  const query = useQuery({
    queryKey: ["reviewReward", familyId ?? ""],
    queryFn: () => fetchReviewReward(familyId as string),
    enabled: status === "authenticated" && !!familyId,
  });

  const ready = query.data !== undefined;
  return {
    rewarded: ready && query.data?.rewarded === true,
    ready,
    isLoading: query.isLoading,
    isError: query.isError,
  };
}
