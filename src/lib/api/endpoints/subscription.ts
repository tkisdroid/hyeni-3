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
  provider?: string | null;
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

export type EffectiveEntitlementTier = "free" | "premium";
export type EffectiveEntitlementSource =
  | "free"
  | "family_subscription"
  | "child_subscription"
  | "legacy_family";

/** Worker 공통 resolver가 확정한 가족 단위 엔타이틀먼트 정본. */
export interface EffectiveEntitlementRow {
  tier: EffectiveEntitlementTier;
  is_premium: boolean;
  source: EffectiveEntitlementSource;
  /** 과거 스토어 방문 혜택의 장소 한도만 유지하며 상업 티어에는 관여하지 않는다. */
  has_grandfathered_review_limits: boolean;
}

/**
 * /api/entitlement 응답 원형.
 * 신규 Worker는 effective를 정본으로 함께 내려준다. effective 필드 자체가 없는 구버전 Worker
 * 응답에 한해서만 subscription → family.user_tier raw 호환 판정을 사용한다.
 */
export interface EntitlementResponse {
  subscription?: SubscriptionRow | null;
  family?: FamilyTierRow | null;
  effective?: EffectiveEntitlementRow | null;
}

/**
 * 가족 엔타이틀먼트 조회. 서버가 공통 resolver 결과와 구버전 호환 raw 행을 함께 반환한다.
 * 실패(네트워크/5xx)는 throw 되어 상위(useQuery)가 마지막 성공 캐시를 보존한다
 * — R9(프리미엄→free 강등 금지)를 위해 여기서 삼키지 않는다.
 */
export function fetchEntitlement(familyId: string): Promise<EntitlementResponse> {
  return apiGet<EntitlementResponse>(
    `/api/entitlement?family_id=${encodeURIComponent(familyId)}`,
  );
}
