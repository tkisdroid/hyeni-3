/**
 * 엔타이틀먼트 응답 → 화면 뷰모델 매핑(순수).
 * hyeni-1 의 2-소스 우선순위를 그대로 재현한다:
 *   1) subscription 행이 있으면 그 행으로 확정(만료 상태여도 legacy 폴백하지 않음 — hyeni-1 계약)
 *   2) 없으면 families.user_tier(legacy) 로 프리미엄 여부만 판정
 *   3) 둘 다 아니면 무료
 *
 * ⚠️ 이 함수는 "성공 응답"만 다룬다. 조회 실패(isError)로 인한 free 강등 금지(R9)는
 *    상위 훅(useEntitlement)의 ready 플래그가 책임진다. 여기서는 절대 예외를 삼키지 않는다.
 */
import type {
  EntitlementResponse,
  SubscriptionRow,
  FamilyTierRow,
} from "@/lib/api/endpoints/subscription";

// 프리미엄으로 취급하는 구독 상태(hyeni-1 PREMIUM_STATUSES 동일).
const PREMIUM_STATUSES = new Set(["trial", "active", "grace", "cancelled"]);
// legacy user_tier 중 프리미엄으로 취급하는 값(hyeni-1 LEGACY_PREMIUM_TIERS 동일).
// legacy 소스에는 trial_ends_at 증거가 없으므로 trial을 프리미엄으로 인정하지 않는다.
// Google Play 7일 체험은 family_subscription.status=trial + 미래 trial_ends_at 조합만 유효하다.
const LEGACY_PREMIUM_TIERS = new Set(["premium", "subscription", "active", "grace"]);

export interface EntitlementView {
  isPremium: boolean;
  isTrial: boolean;
  status: string; // "active" | "trial" | "grace" | "expired" | "free" ...
  tierLabel: string; // "프리미엄" | "무료"
  planLabel: string; // "프리미엄 연간 구독" | "프리미엄 무료 체험" | "무료 플랜" ...
  productId: string | null;
  periodEnd: Date | null; // 현재 결제 주기 종료(current_period_end)
  trialEndsAt: Date | null;
  trialDaysLeft: number | null;
}

function normalizeTierValue(value: string | null | undefined): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function parseDate(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

// trial 종료까지 남은 일수(올림). 이미 지났으면 0, 알 수 없으면 null.
function computeTrialDaysLeft(trialEndsAt: Date | null): number | null {
  if (!trialEndsAt) return null;
  const diff = trialEndsAt.getTime() - Date.now();
  if (Number.isNaN(diff)) return null;
  if (diff <= 0) return 0;
  return Math.ceil(diff / 86_400_000);
}

function planLabelFor(isPremium: boolean, isTrial: boolean, productId: string | null): string {
  if (!isPremium) return "무료 플랜";
  if (isTrial) return "프리미엄 무료 체험";
  const pid = (productId || "").toLowerCase();
  if (pid.includes("year") || pid.includes("annual")) return "프리미엄 연간 구독";
  if (pid.includes("month")) return "프리미엄 월구독";
  return "프리미엄 구독";
}

function buildView(input: {
  isPremium: boolean;
  status: string;
  productId: string | null;
  periodEnd: Date | null;
  trialEndsAt: Date | null;
}): EntitlementView {
  const isTrial = input.status === "trial";
  return {
    isPremium: input.isPremium,
    isTrial,
    status: input.status,
    tierLabel: input.isPremium ? "프리미엄" : "무료",
    planLabel: planLabelFor(input.isPremium, isTrial, input.productId),
    productId: input.productId,
    periodEnd: input.periodEnd,
    trialEndsAt: input.trialEndsAt,
    trialDaysLeft: isTrial ? computeTrialDaysLeft(input.trialEndsAt) : null,
  };
}

// 무료(비프리미엄) 기본 뷰.
function freeView(): EntitlementView {
  return buildView({
    isPremium: false,
    status: "free",
    productId: null,
    periodEnd: null,
    trialEndsAt: null,
  });
}

// 1순위: subscription 행. 존재하면(만료 포함) 이 행으로 확정한다.
function fromSubscription(sub: SubscriptionRow): EntitlementView {
  const status = normalizeTierValue(sub.status) || "expired";
  const trialEndsAt = parseDate(sub.trial_ends_at);
  const periodEnd = parseDate(sub.current_period_end);
  if (status === "trial" && (!trialEndsAt || trialEndsAt.getTime() <= Date.now())) {
    return buildView({
      isPremium: false,
      status: "expired",
      productId: sub.product_id ?? null,
      periodEnd,
      trialEndsAt: null,
    });
  }
  if (
    (status === "active" || status === "grace" || status === "cancelled")
    && (!periodEnd || periodEnd.getTime() <= Date.now())
  ) {
    return buildView({
      isPremium: false,
      status: "expired",
      productId: sub.product_id ?? null,
      periodEnd,
      trialEndsAt,
    });
  }
  return buildView({
    isPremium: PREMIUM_STATUSES.has(status),
    status,
    productId: sub.product_id ?? null,
    periodEnd,
    trialEndsAt,
  });
}

// 2순위: families.user_tier(legacy). 프리미엄이면 뷰 반환, 아니면 null(→ free 로 귀결).
function fromLegacyFamily(family: FamilyTierRow | null | undefined): EntitlementView | null {
  const tierValue = normalizeTierValue(
    family?.subscription_tier || family?.user_tier || family?.status,
  );
  if (!LEGACY_PREMIUM_TIERS.has(tierValue)) return null;
  const status = tierValue === "trial" ? "trial" : tierValue === "grace" ? "grace" : "active";
  return buildView({
    isPremium: true,
    status,
    productId: family?.product_id ?? null,
    periodEnd: null, // legacy 소스에는 주기 정보가 없다
    trialEndsAt: null,
  });
}

/** 응답 원형 → 뷰모델. 2-소스 우선순위(subscription 우선 → legacy 폴백 → free). */
export function deriveEntitlement(res: EntitlementResponse | null | undefined): EntitlementView {
  const sub = res?.subscription;
  if (sub) return fromSubscription(sub);
  const legacy = fromLegacyFamily(res?.family);
  return legacy ?? freeView();
}
