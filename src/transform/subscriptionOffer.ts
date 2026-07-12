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
  paidBillingPeriod: string | null;
}

function microsOf(phase: BillingPricingPhase): number | null {
  const value = Number(phase.priceAmountMicros);
  return Number.isFinite(value) && value >= 0 ? value : null;
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
): SubscriptionOfferSelection | null {
  const eligible = (product?.subscriptionOfferDetails ?? []).filter(
    (offer) => offer.basePlanId === basePlanId && !!offer.offerToken,
  );
  if (!eligible.length) return null;

  const trialOffer = eligible.find(hasExactSevenDayTrial);
  // 7일이 아닌 무료 오퍼를 일반 결제로 위장해 선택하면 사용자에게 보이지 않은 조건으로
  // 결제가 시작된다. 정확한 7일 체험 또는 무료 phase가 전혀 없는 base offer만 허용한다.
  const selected = trialOffer ?? eligible.find((offer) => !hasAnyFreePhase(offer));
  if (!selected) return null;
  const paidPhase = (selected.pricingPhases ?? []).find((phase) => {
    const micros = microsOf(phase);
    return micros != null && micros > 0;
  });

  return {
    basePlanId,
    offerId: selected.offerId || null,
    offerToken: selected.offerToken as string,
    hasSevenDayTrial: !!trialOffer && selected === trialOffer,
    displayPrice: paidPhase?.formattedPrice || null,
    paidBillingPeriod: paidPhase?.billingPeriod || null,
  };
}
