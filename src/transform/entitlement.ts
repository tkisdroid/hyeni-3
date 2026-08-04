/**
 * 엔타이틀먼트 응답 → 화면 뷰모델 매핑(순수).
 * 신규 Worker의 공통 resolver 결과인 effective가 최우선 정본이다. effective 필드 자체가
 * 없는 구버전 Worker 응답에 한해서만 기존 raw 2-소스 판정을 재현한다:
 *   1) subscription 행이 있으면 그 행으로 확정(만료 상태여도 legacy 폴백하지 않음)
 *   2) 없으면 families.user_tier(legacy) 로 프리미엄 여부만 판정
 *   3) 둘 다 아니면 무료
 *
 * ⚠️ 이 함수는 "성공 응답"만 다룬다. 조회 실패(isError)로 인한 free 강등 금지(R9)는
 *    상위 훅(useEntitlement)의 ready 플래그가 책임진다. 여기서는 절대 예외를 삼키지 않는다.
 */
import type {
  EntitlementResponse,
  EffectiveEntitlementRow,
  EffectiveEntitlementSource,
  EffectiveEntitlementTier,
  SubscriptionRow,
  FamilyTierRow,
} from "@/lib/api/endpoints/subscription";

// 프리미엄으로 취급하는 구독 상태(hyeni-1 PREMIUM_STATUSES 동일).
const PREMIUM_STATUSES = new Set(["trial", "active", "grace", "cancelled"]);
// legacy user_tier 중 프리미엄으로 취급하는 값(hyeni-1 LEGACY_PREMIUM_TIERS 동일).
// legacy 소스에는 trial_ends_at 증거가 없으므로 trial을 프리미엄으로 인정하지 않는다.
// Google Play 7일 체험은 family_subscription.status=trial + 미래 trial_ends_at 조합만 유효하다.
const LEGACY_PREMIUM_TIERS = new Set(["premium", "subscription", "active", "grace"]);
const EFFECTIVE_SOURCES = new Set<EffectiveEntitlementSource>([
  "free",
  "family_subscription",
  "child_subscription",
  "legacy_family",
]);

export interface EntitlementView {
  isPremium: boolean;
  isTrial: boolean;
  status: string; // "active" | "trial" | "grace" | "expired" | "free" ...
  tierLabel: string; // "프리미엄" | "무료"
  planLabel: string; // "프리미엄 연간 구독" | "프리미엄 무료 체험" | "무료 플랜" ...
  productId: string | null;
  basePlanId: string | null;
  provider: string | null;
  periodEnd: Date | null; // 현재 결제 주기 종료(current_period_end)
  trialEndsAt: Date | null;
  trialDaysLeft: number | null;
}

export interface EntitlementResolution {
  /** effective 정본, 구버전 raw 호환, 또는 훼손된 effective 응답. */
  contract: "effective" | "legacy" | "invalid";
  view: EntitlementView | null;
  effectiveTier: EffectiveEntitlementTier | null;
  effectiveSource: EffectiveEntitlementSource | null;
  /** 상업 티어와 독립된 과거 장소 한도 보존 여부. */
  hasGrandfatheredReviewLimits: boolean;
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

function planLabelFor(
  isPremium: boolean,
  isTrial: boolean,
  productId: string | null,
  basePlanId: string | null,
): string {
  if (!isPremium) return "무료 플랜";
  if (isTrial) return "프리미엄 무료 체험";
  const pid = `${productId || ""} ${basePlanId || ""}`.toLowerCase();
  if (pid.includes("year") || pid.includes("annual")) return "프리미엄 연간 구독";
  if (pid.includes("month")) return "프리미엄 월간 구독";
  return "프리미엄 구독";
}

function buildView(input: {
  isPremium: boolean;
  status: string;
  productId: string | null;
  basePlanId: string | null;
  provider: string | null;
  periodEnd: Date | null;
  trialEndsAt: Date | null;
}): EntitlementView {
  const isTrial = input.status === "trial";
  return {
    isPremium: input.isPremium,
    isTrial,
    status: input.status,
    tierLabel: input.isPremium ? "프리미엄" : "무료",
    planLabel: planLabelFor(input.isPremium, isTrial, input.productId, input.basePlanId),
    productId: input.productId,
    basePlanId: input.basePlanId,
    provider: input.provider,
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
    basePlanId: null,
    provider: null,
    periodEnd: null,
    trialEndsAt: null,
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseEffective(value: unknown): EffectiveEntitlementRow | null {
  if (!isRecord(value)) return null;
  const tier = value.tier;
  const isPremium = value.is_premium;
  const source = value.source;
  const grandfathered = value.has_grandfathered_review_limits;
  if (tier !== "free" && tier !== "premium") return null;
  if (typeof isPremium !== "boolean" || isPremium !== (tier === "premium")) return null;
  if (typeof source !== "string" || !EFFECTIVE_SOURCES.has(source as EffectiveEntitlementSource)) {
    return null;
  }
  if ((tier === "free") !== (source === "free")) return null;
  if (typeof grandfathered !== "boolean") return null;
  return {
    tier,
    is_premium: isPremium,
    source: source as EffectiveEntitlementSource,
    has_grandfathered_review_limits: grandfathered,
  };
}

/**
 * effective는 접근 권한 판정에만 사용하고 raw 행은 표시용 날짜·상품명에만 사용한다.
 * 따라서 자녀 단위 구독처럼 raw family_subscription에 나타나지 않는 Premium도 강등되지 않는다.
 */
function fromEffective(
  effective: EffectiveEntitlementRow,
  response: EntitlementResponse,
): EntitlementView {
  if (!effective.is_premium) return freeView();

  const familySubscription = effective.source === "family_subscription"
    ? response.subscription
    : null;
  const rawStatus = normalizeTierValue(familySubscription?.status);
  const status = PREMIUM_STATUSES.has(rawStatus) ? rawStatus : "active";
  return buildView({
    isPremium: true,
    status,
    productId: familySubscription?.product_id ?? null,
    basePlanId: familySubscription?.base_plan_id ?? null,
    provider: familySubscription?.provider ?? null,
    periodEnd: parseDate(familySubscription?.current_period_end),
    trialEndsAt: parseDate(familySubscription?.trial_ends_at),
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
      basePlanId: sub.base_plan_id ?? null,
      provider: sub.provider ?? null,
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
      basePlanId: sub.base_plan_id ?? null,
      provider: sub.provider ?? null,
      periodEnd,
      trialEndsAt,
    });
  }
  return buildView({
    isPremium: PREMIUM_STATUSES.has(status),
    status,
    productId: sub.product_id ?? null,
    basePlanId: sub.base_plan_id ?? null,
    provider: sub.provider ?? null,
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
    basePlanId: null,
    provider: null,
    periodEnd: null, // legacy 소스에는 주기 정보가 없다
    trialEndsAt: null,
  });
}

/** 응답 원형 → 정본 해석 결과. effective가 훼손됐으면 raw로 우회하지 않고 invalid로 닫는다. */
export function resolveEntitlementResponse(
  res: EntitlementResponse | null | undefined,
): EntitlementResolution {
  if (res == null || typeof res !== "object" || Array.isArray(res)) {
    return {
      contract: "invalid",
      view: null,
      effectiveTier: null,
      effectiveSource: null,
      hasGrandfatheredReviewLimits: false,
    };
  }

  if (Object.prototype.hasOwnProperty.call(res, "effective")) {
    const effective = parseEffective(res.effective);
    if (!effective) {
      return {
        contract: "invalid",
        view: null,
        effectiveTier: null,
        effectiveSource: null,
        hasGrandfatheredReviewLimits: false,
      };
    }
    return {
      contract: "effective",
      view: fromEffective(effective, res),
      effectiveTier: effective.tier,
      effectiveSource: effective.source,
      hasGrandfatheredReviewLimits: effective.has_grandfathered_review_limits,
    };
  }

  const sub = res.subscription;
  const view = sub ? fromSubscription(sub) : fromLegacyFamily(res.family) ?? freeView();
  return {
    contract: "legacy",
    view,
    effectiveTier: null,
    effectiveSource: null,
    hasGrandfatheredReviewLimits: false,
  };
}

/** 응답 원형 → 뷰모델. invalid effective는 null이며 호출부가 unknown으로 처리해야 한다. */
export function deriveEntitlement(
  res: EntitlementResponse | null | undefined,
): EntitlementView | null {
  return resolveEntitlementResponse(res).view;
}
