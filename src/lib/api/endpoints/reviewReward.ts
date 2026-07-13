/**
 * 리뷰 보상 티어 엔드포인트.
 * GET /api/review-rewards?familyId= → { rewarded:boolean }.
 * 스토어 방문 혜택이 지급된 가족은 서버 family_review_rewards 행이 생겨 무료 한도가 상향된다
 * (일정·장소 1→3). hyeni-1 worker/routes/review-rewards.ts 계약 그대로 재현한다.
 *
 * 서버 graceful 계약: familyId 누락·부모아님·테이블부재·미부여는 모두 rewarded=false.
 * 조회 실패(네트워크/5xx)는 throw 되어 상위(useQuery)가 마지막 성공 캐시를 보존한다
 * — 리뷰 티어의 조회 실패로 한도를 임의 축소하지 않기 위함(여기서 삼키지 않는다).
 */
import { apiGet, apiPost } from "../client";

/** GET /api/review-rewards 응답 원형. rewarded=행 존재 + granted_at(원본 isReviewTierRewarded). */
export interface ReviewRewardResponse {
  rewarded?: boolean;
}

/** POST 지급 성공 응답. 두 필드가 모두 true여야만 혜택 적용 성공이다. */
export interface ReviewRewardClaimResponse {
  ok?: boolean;
  rewarded?: boolean;
}

/** 현재 가족의 리뷰 보상 여부 조회. rewarded=true 면 리뷰 티어(무료 한도 상향)로 취급한다. */
export function fetchReviewReward(familyId: string): Promise<ReviewRewardResponse> {
  return apiGet<ReviewRewardResponse>(
    `/api/review-rewards?familyId=${encodeURIComponent(familyId)}`,
  );
}

/** 현재 가족에 스토어 방문 혜택을 지급한다. HTTP 200의 실패 본문도 명시적으로 거부한다. */
export async function claimReviewReward(familyId: string): Promise<ReviewRewardClaimResponse> {
  const response = await apiPost<ReviewRewardClaimResponse>(
    "/api/review-rewards",
    { familyId },
  );
  if (response.ok !== true || response.rewarded !== true) {
    throw new Error("스토어 방문 혜택을 적용하지 못했어요");
  }
  return response;
}
