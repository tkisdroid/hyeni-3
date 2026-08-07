/**
 * 구독/엔타이틀먼트 TanStack Query 훅(조회 전용).
 * 컴포넌트는 이 훅만 import(endpoints/subscription 직접 호출 금지).
 *
 * ⚠️ R9(다운그레이드 금지): 조회 실패로 프리미엄을 free 로 강등하지 않는다.
 *   - TanStack Query 는 refetch 실패 시에도 마지막 성공 data(캐시)를 유지 → 프리미엄 보존.
 *   - 캐시조차 없을 때(첫 로드 중 / 캐시 없이 에러)에는 ready=false 로 두어 tier=unknown 으로
 *     취급한다. 이 동안 consumer 는 "프리미엄 게이트"나 "무료 확정" UI 를 노출하면 안 된다.
 */
import { useQuery } from "@tanstack/react-query";
import { qk } from "./keys";
import { useAuth } from "@/auth/AuthContext";
import { fetchEntitlement } from "@/lib/api/endpoints/subscription";
import {
  resolveEntitlementResponse,
  type EntitlementView,
} from "@/transform/entitlement";
import { useReviewReward } from "./useReviewReward";
import { tierFrom, TIERS, type Tier } from "@/transform/tierPolicy";

export interface UseEntitlementResult {
  /** 프리미엄 판정이 확정되었는가(성공 data 또는 캐시 존재). false면 프리미엄 게이트/강등 금지(R9). */
  ready: boolean;
  /** ready 일 때만 true 가능. ready=false면 항상 false(프리미엄 게이트 미표시). */
  isPremium: boolean;
  /** 효과 티어가 스토어 방문 혜택인가(tier===reviewed). 프리미엄이면 false. */
  reviewed: boolean;
  /**
   * 확정 티어(unknown|free|reviewed|premium). tierFrom({ready, isPremium, reviewed}).
   * unknown = 아직 판정 불가 → 어떤 게이트/강등도 표시하면 안 됨(R9).
   */
  tier: Tier;
  /** 뷰모델(확정 시). ready=false면 null. */
  view: EntitlementView | null;
  /** 최초 로딩 여부(캐시 없이 첫 조회 중). */
  isLoading: boolean;
  /** 조회 실패 여부(캐시가 있으면 view 는 그대로 유지됨). */
  isError: boolean;
  /** 최초 조회 또는 사용자가 요청한 재조회가 진행 중인가. */
  isFetching: boolean;
  /** 현재 가족의 엔타이틀먼트를 다시 확인한다. */
  refetch: () => Promise<void>;
}

/** 현재 가족의 엔타이틀먼트. effective 정본을 쓰고 구버전 Worker에서만 리뷰 조회를 합성한다. */
export function useEntitlement(): UseEntitlementResult {
  const { familyId, status } = useAuth();
  const query = useQuery({
    queryKey: qk.entitlement(familyId ?? ""),
    queryFn: () => fetchEntitlement(familyId as string),
    enabled: status === "authenticated" && !!familyId,
  });
  const resolution = query.data !== undefined
    ? resolveEntitlementResponse(query.data)
    : null;
  const hasResolution = resolution !== null;
  const legacyReviewRequired = hasResolution
    && resolution.contract === "legacy"
    && resolution.view?.isPremium === false;
  const review = useReviewReward({ enabled: legacyReviewRequired });

  // effective가 있으면 raw와 review-rewards를 다시 합성하지 않는다. 필드가 아예 없는
  // 구버전 Worker의 무료 응답만 별도 review 조회로 grandfather 한도를 복원한다.
  const resolutionInvalid = hasResolution && resolution.contract === "invalid";
  const view = resolutionInvalid ? null : resolution?.view ?? null;
  const entReady = view !== null;
  const isPremium = entReady && view.isPremium;
  const effectiveGrandfathered = hasResolution
    && resolution.contract === "effective"
    && resolution.hasGrandfatheredReviewLimits;
  const reviewed = effectiveGrandfathered || (legacyReviewRequired && review.rewarded);
  // 구버전 review 조회도 실패 시 free로 추정하지 않고 unknown으로 닫는다.
  const tierReady = entReady && (!legacyReviewRequired || review.ready);
  const tier = tierFrom({ ready: tierReady, isPremium, reviewed });
  const reviewError = legacyReviewRequired && review.isError;

  return {
    ready: tierReady,
    isPremium,
    reviewed: tier === TIERS.REVIEWED,
    tier,
    view: tierReady ? view : null,
    isLoading: query.isLoading || (legacyReviewRequired && review.isLoading),
    isError: query.isError || resolutionInvalid || reviewError,
    isFetching: query.isFetching || (legacyReviewRequired && review.isFetching),
    refetch: async () => {
      await query.refetch();
      if (legacyReviewRequired) await review.refetch();
    },
  };
}
