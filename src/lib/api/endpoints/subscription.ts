/**
 * 구독/엔타이틀먼트 도메인 엔드포인트(조회 전용).
 * GET /api/entitlement?family_id= 응답 원형을 그대로 반환한다(프리미엄 판정·라벨은 transform 담당).
 * 결제(구매/복원/관리)는 4단계(Capacitor + Google Play Billing)로 defer — 여기서는 read 만.
 */
import { apiGet } from "../client";

/**
 * family_subscription 행(구독이 있을 때). 구독이 없으면 서버가 subscription:null 로 내려준다.
 * status 가 프리미엄 판정의 1순위 소스(trial/active/grace = 프리미엄).
 */
export interface SubscriptionRow {
  status?: string | null; // "trial" | "active" | "grace" | "expired" | "canceled" ...
  product_id?: string | null; // "premium_yearly" | "premium_monthly" ...
  base_plan_id?: string | null;
  current_period_end?: string | null; // ISO
  trial_ends_at?: string | null; // ISO
}

/**
 * families 레거시 티어(구독 행이 없을 때의 폴백 소스).
 * user_tier="subscription" 처럼 결제 이력만 남은 계정을 프리미엄으로 살려낸다.
 */
export interface FamilyTierRow {
  id?: string;
  user_tier?: string | null; // "subscription" | "free" | "premium" ...
  subscription_tier?: string | null;
  status?: string | null;
  product_id?: string | null;
}

/**
 * /api/entitlement 응답 원형.
 * 두 소스를 함께 내려주며 우선순위는 transform 에서 결정(subscription 우선 → family.user_tier 폴백).
 */
export interface EntitlementResponse {
  subscription?: SubscriptionRow | null;
  family?: FamilyTierRow | null;
}

/**
 * 가족 엔타이틀먼트 조회. 서버가 family_subscription 행 + families.user_tier 를 한 번에 반환한다.
 * 실패(네트워크/5xx)는 throw 되어 상위(useQuery)가 마지막 성공 캐시를 보존한다
 * — R9(프리미엄→free 강등 금지)를 위해 여기서 삼키지 않는다.
 */
export function fetchEntitlement(familyId: string): Promise<EntitlementResponse> {
  return apiGet<EntitlementResponse>(
    `/api/entitlement?family_id=${encodeURIComponent(familyId)}`,
  );
}
