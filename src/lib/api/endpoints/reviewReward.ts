/**
 * 기존 스토어 방문 혜택 조회 엔드포인트.
 * GET /api/review-rewards?familyId= → { rewarded:boolean }.
 * 신규 지급은 종료되었지만 기존 family_review_rewards 행은 무손실로 읽어
 * 이미 받은 가족의 한도를 유지한다.
 *
 * 서버 graceful 계약: familyId 누락·부모아님·테이블부재·미부여는 모두 rewarded=false.
 * 조회 실패(네트워크/5xx)는 throw 되어 상위(useQuery)가 마지막 성공 캐시를 보존한다
 * — 과거 스토어 방문 혜택 조회 실패로 기존 한도를 임의 축소하지 않기 위함(여기서 삼키지 않는다).
 */
import { apiGet } from "../client";

/** GET /api/review-rewards 응답 원형. rewarded=행 존재 + granted_at(원본 isReviewTierRewarded). */
export interface ReviewRewardResponse {
  rewarded?: boolean;
}

/** 현재 가족의 기존 보상 여부 조회. rewarded=true 면 기존 상향 한도를 유지한다. */
export function fetchReviewReward(familyId: string): Promise<ReviewRewardResponse> {
  return apiGet<ReviewRewardResponse>(
    `/api/review-rewards?familyId=${encodeURIComponent(familyId)}`,
  );
}
