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
import { deriveEntitlement, type EntitlementView } from "@/transform/entitlement";
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

/** 현재 가족의 엔타이틀먼트(/api/entitlement + /api/review-rewards). 프리미엄·리뷰 티어 판정. */
export function useEntitlement(): UseEntitlementResult {
  const { familyId, status } = useAuth();
  const query = useQuery({
    queryKey: qk.entitlement(familyId ?? ""),
    queryFn: () => fetchEntitlement(familyId as string),
    enabled: status === "authenticated" && !!familyId,
  });
  const review = useReviewReward();

  // data(캐시 포함)가 있을 때만 프리미엄을 확정한다. refetch 가 실패해도 TanStack 이 마지막
  // 성공값을 유지하므로 프리미엄이 free 로 강등되지 않는다(R9).
  const view = query.data ? deriveEntitlement(query.data) : null;
  const entReady = view !== null;
  const isPremium = view ? view.isPremium : false;

  // tier 확정 조건:
  //  - 프리미엄이면 리뷰 여부와 무관하게 premium 이므로 리뷰 조회를 기다리지 않는다.
  //  - 비프리미엄이면 free/reviewed 구분에 리뷰 조회가 필요하나, review-rewards 는 서버가
  //    대부분 graceful(rewarded=false)이므로 조회가 영구 실패(isError)해도 reviewed=false 로
  //    안전 확정한다(그렇지 않으면 tier 가 unknown 에 갇혀 free 게이트가 앱 전역에서 미확정).
  //    R9: 프리미엄 강등은 여전히 없음 — entReady=false 일 때만 unknown.
  const reviewSettled = review.ready || review.isError;
  const tierReady = entReady && (isPremium || reviewSettled);
  const tier = tierFrom({ ready: tierReady, isPremium, reviewed: review.rewarded });

  return {
    ready: entReady,
    isPremium,
    reviewed: tier === TIERS.REVIEWED,
    tier,
    view,
    isLoading: query.isLoading,
    isError: query.isError,
    isFetching: query.isFetching,
    refetch: async () => {
      await query.refetch();
    },
  };
}
