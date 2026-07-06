/**
 * 리뷰 보상 티어 엔드포인트(조회 전용).
 * GET /api/review-rewards?familyId= → { rewarded:boolean }.
 * 스토어 리뷰를 남긴 가족은 서버 family_review_rewards 행이 생겨 무료 한도가 상향된다
 * (일정·장소 1→3). hyeni-1 worker/routes/review-rewards.ts 계약 그대로 재현한다.
 *
 * 서버 graceful 계약: familyId 누락·부모아님·테이블부재·미부여는 모두 rewarded=false.
 * 조회 실패(네트워크/5xx)는 throw 되어 상위(useQuery)가 마지막 성공 캐시를 보존한다
 * — 리뷰 티어의 조회 실패로 한도를 임의 축소하지 않기 위함(여기서 삼키지 않는다).
 */
import { apiGet } from "../client";

/** GET /api/review-rewards 응답 원형. rewarded=행 존재 + granted_at(원본 isReviewTierRewarded). */
export interface ReviewRewardResponse {
  rewarded?: boolean;
}

/** 현재 가족의 리뷰 보상 여부 조회. rewarded=true 면 리뷰 티어(무료 한도 상향)로 취급한다. */
export function fetchReviewReward(familyId: string): Promise<ReviewRewardResponse> {
  return apiGet<ReviewRewardResponse>(
    `/api/review-rewards?familyId=${encodeURIComponent(familyId)}`,
  );
}
