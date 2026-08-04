export interface BillingPricingPhase {
  formattedPrice?: string | null;
  priceAmountMicros?: number | string | null;
  priceCurrencyCode?: string | null;
  billingPeriod?: string | null;
  billingCycleCount?: number | string | null;
  recurrenceMode?: number | null;
}

export interface BillingSubscriptionOffer {
  basePlanId?: string | null;
  offerId?: string | null;
  offerToken?: string | null;
  pricingPhases?: BillingPricingPhase[] | null;
}

export interface BillingProductDetails {
  productId?: string | null;
  subscriptionOfferDetails?: BillingSubscriptionOffer[] | null;
}

export interface SubscriptionOfferSelection {
  basePlanId: string;
  offerId: string | null;
  offerToken: string;
  hasSevenDayTrial: boolean;
  displayPrice: string | null;
  priceAmountMicros: number | null;
  priceCurrencyCode: string | null;
  paidBillingPeriod: string | null;
}

export type SubscriptionPlanOption = "year" | "month";

/** ARIA radiogroup의 표준 화살표·Home·End 키를 두 결제 주기에 매핑한다. */
export function subscriptionPlanForNavigationKey(
  current: SubscriptionPlanOption,
  key: string,
): SubscriptionPlanOption | null {
  if (key === "Home") return "year";
  if (key === "End") return "month";
  const direction = key === "ArrowRight" || key === "ArrowDown"
    ? 1
    : key === "ArrowLeft" || key === "ArrowUp"
      ? -1
      : 0;
  if (direction === 0) return null;
  const plans: readonly SubscriptionPlanOption[] = ["year", "month"];
  const currentIndex = plans.indexOf(current);
  return plans[(currentIndex + direction + plans.length) % plans.length];
}

const LAUNCH_PRICE_MICROS: Readonly<Record<string, number>> = Object.freeze({
  "monthly-2900": 4_900_000_000,
  "annual-27840": 39_000_000_000,
});

const LAUNCH_BILLING_PERIOD: Readonly<Record<string, string>> = Object.freeze({
  "monthly-2900": "P1M",
  "annual-27840": "P1Y",
});

// Billing Client 9.0.0 ProductDetails.RecurrenceMode.INFINITE_RECURRING.
// Android 플러그인이 getRecurrenceMode() 값을 숫자로 그대로 전달한다.
const INFINITE_RECURRING = 1;

function microsOf(phase: BillingPricingPhase): number | null {
  const raw = phase.priceAmountMicros;
  if (raw == null) return null;
  if (typeof raw === "string" && !/^\d+$/.test(raw)) return null;
  if (typeof raw !== "number" && typeof raw !== "string") return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function finalAutoRenewingPhase(offer: BillingSubscriptionOffer): BillingPricingPhase | null {
  const phases = offer.pricingPhases;
  if (!Array.isArray(phases) || phases.length === 0) return null;
  const finalPhase = phases[phases.length - 1];
  const micros = microsOf(finalPhase);
  return finalPhase.recurrenceMode === INFINITE_RECURRING && micros != null && micros > 0
    ? finalPhase
    : null;
}

function hasValidPricingPhases(offer: BillingSubscriptionOffer): boolean {
  const phases = offer.pricingPhases;
  return Array.isArray(phases)
    && phases.length > 0
    && phases.every((phase) => microsOf(phase) !== null)
    && finalAutoRenewingPhase(offer) !== null;
}

function hasExactSevenDayTrial(offer: BillingSubscriptionOffer): boolean {
  return (offer.pricingPhases ?? []).some((phase) => {
    if (microsOf(phase) !== 0) return false;
    const period = phase.billingPeriod?.match(/^P(\d+)([DW])$/);
    const cycleCount = Number(phase.billingCycleCount);
    if (!period || !Number.isInteger(cycleCount) || cycleCount <= 0) return false;
    const periodCount = Number(period[1]);
    const daysPerCycle = period[2] === "W" ? periodCount * 7 : periodCount;
    return daysPerCycle * cycleCount === 7;
  });
}

function hasAnyFreePhase(offer: BillingSubscriptionOffer): boolean {
  return (offer.pricingPhases ?? []).some((phase) => microsOf(phase) === 0);
}

/** Google Play가 현재 계정에 eligible 하다고 반환한 offer 안에서만 선택한다. */
export function selectSubscriptionOffer(
  product: BillingProductDetails | null | undefined,
  basePlanId: string,
  options: { allowTrial?: boolean } = {},
): SubscriptionOfferSelection | null {
  const eligible = (product?.subscriptionOfferDetails ?? []).filter(
    (offer) => offer.basePlanId === basePlanId && !!offer.offerToken && hasValidPricingPhases(offer),
  );
  if (!eligible.length) return null;

  const trialOffer = options.allowTrial === false ? undefined : eligible.find(hasExactSevenDayTrial);
  // 7일이 아닌 무료 오퍼를 일반 결제로 위장해 선택하면 사용자에게 보이지 않은 조건으로
  // 결제가 시작된다. 정확한 7일 체험 또는 무료 phase가 전혀 없는 base offer만 허용한다.
  const selected = trialOffer ?? eligible.find((offer) => !hasAnyFreePhase(offer));
  if (!selected) return null;
  const paidPhase = finalAutoRenewingPhase(selected);
  if (!paidPhase) return null;

  return {
    basePlanId,
    offerId: selected.offerId || null,
    offerToken: selected.offerToken as string,
    hasSevenDayTrial: !!trialOffer && selected === trialOffer,
    displayPrice: paidPhase.formattedPrice || null,
    priceAmountMicros: microsOf(paidPhase),
    priceCurrencyCode: paidPhase.priceCurrencyCode || null,
    paidBillingPeriod: paidPhase.billingPeriod || null,
  };
}

/** 출시 가격과 Play Console 실제 상품이 다르면 결제창을 열지 않는다. */
export function hasExpectedLaunchSubscriptionPrice(
  offer: SubscriptionOfferSelection | null | undefined,
): boolean {
  if (!offer) return false;
  return (
    offer.priceCurrencyCode === "KRW"
    && offer.priceAmountMicros === LAUNCH_PRICE_MICROS[offer.basePlanId]
    && offer.paidBillingPeriod === LAUNCH_BILLING_PERIOD[offer.basePlanId]
  );
}
