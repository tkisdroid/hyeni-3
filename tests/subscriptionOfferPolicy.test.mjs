import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const modulePath = resolve(rootDir, "src/transform/subscriptionOffer.ts");

test("Google Play eligible offer 중 정확한 7일 무료 체험을 우선하고 없으면 일반 결제를 고른다", async () => {
  assert.equal(existsSync(modulePath), true, "구독 offer 선택 정책 모듈이 아직 없습니다");
  const { hasExpectedLaunchSubscriptionPrice, selectSubscriptionOffer } = await import(pathToFileURL(modulePath).href);

  const paidPhase = {
    formattedPrice: "₩2,900",
    priceAmountMicros: 2_900_000_000,
    priceCurrencyCode: "KRW",
    billingPeriod: "P1M",
    recurrenceMode: 1,
  };
  const product = {
    productId: "hyeni_premium",
    subscriptionOfferDetails: [
      {
        basePlanId: "monthly-2900",
        offerId: null,
        offerToken: "paid-token",
        pricingPhases: [paidPhase],
      },
      {
        basePlanId: "monthly-2900",
        offerId: "trial-7d",
        offerToken: "trial-token",
        pricingPhases: [
          {
            formattedPrice: "₩0",
            priceAmountMicros: 0,
            priceCurrencyCode: "KRW",
            billingPeriod: "P1W",
            billingCycleCount: 1,
            recurrenceMode: 2,
          },
          paidPhase,
        ],
      },
    ],
  };

  assert.deepEqual(selectSubscriptionOffer(product, "monthly-2900"), {
    basePlanId: "monthly-2900",
    offerId: "trial-7d",
    offerToken: "trial-token",
    hasSevenDayTrial: true,
    displayPrice: "₩2,900",
    priceAmountMicros: 2_900_000_000,
    priceCurrencyCode: "KRW",
    paidBillingPeriod: "P1M",
  });

  const paidOnly = {
    ...product,
    subscriptionOfferDetails: [product.subscriptionOfferDetails[0]],
  };
  assert.deepEqual(selectSubscriptionOffer(paidOnly, "monthly-2900"), {
    basePlanId: "monthly-2900",
    offerId: null,
    offerToken: "paid-token",
    hasSevenDayTrial: false,
    displayPrice: "₩2,900",
    priceAmountMicros: 2_900_000_000,
    priceCurrencyCode: "KRW",
    paidBillingPeriod: "P1M",
  });

  const wrongTrial = {
    ...product,
    subscriptionOfferDetails: [{
      ...product.subscriptionOfferDetails[1],
      pricingPhases: [{
        ...product.subscriptionOfferDetails[1].pricingPhases[0],
        billingCycleCount: 2,
      }, paidPhase],
    }],
  };
  assert.equal(selectSubscriptionOffer(wrongTrial, "monthly-2900"), null);

  const paidAndWrongTrial = {
    ...product,
    subscriptionOfferDetails: [
      wrongTrial.subscriptionOfferDetails[0],
      product.subscriptionOfferDetails[0],
    ],
  };
  assert.equal(selectSubscriptionOffer(paidAndWrongTrial, "monthly-2900")?.offerToken, "paid-token");

  const malformedNullTrial = {
    ...product,
    subscriptionOfferDetails: [{
      ...product.subscriptionOfferDetails[1],
      offerToken: "malformed-null-trial",
      pricingPhases: [{
        ...product.subscriptionOfferDetails[1].pricingPhases[0],
        priceAmountMicros: null,
      }, paidPhase],
    }, product.subscriptionOfferDetails[0]],
  };
  assert.equal(
    selectSubscriptionOffer(malformedNullTrial, "monthly-2900")?.offerToken,
    "paid-token",
    "null 가격을 0원 체험으로 강제 변환하면 안 됩니다",
  );

  const malformedBlankTrial = {
    ...product,
    subscriptionOfferDetails: [{
      ...product.subscriptionOfferDetails[1],
      offerToken: "malformed-blank-trial",
      pricingPhases: [{
        ...product.subscriptionOfferDetails[1].pricingPhases[0],
        priceAmountMicros: " ",
      }, paidPhase],
    }],
  };
  assert.equal(selectSubscriptionOffer(malformedBlankTrial, "monthly-2900"), null);

  const sevenDailyCycles = {
    ...product,
    subscriptionOfferDetails: [{
      ...product.subscriptionOfferDetails[1],
      pricingPhases: [{
        ...product.subscriptionOfferDetails[1].pricingPhases[0],
        billingPeriod: "P1D",
        billingCycleCount: 7,
      }, paidPhase],
    }],
  };
  assert.equal(selectSubscriptionOffer(sevenDailyCycles, "monthly-2900")?.hasSevenDayTrial, true);
  assert.equal(selectSubscriptionOffer(product, "annual-27840"), null);
  assert.equal(
    selectSubscriptionOffer(product, "monthly-2900", { allowTrial: false })?.offerToken,
    "paid-token",
    "가족 체험을 이미 사용했다면 Play가 trial offer를 반환해도 유료 base offer만 선택해야 합니다",
  );

  const expectedMonthly = selectSubscriptionOffer({
    productId: "hyeni_premium",
    subscriptionOfferDetails: [{
      basePlanId: "monthly-2900",
      offerToken: "launch-monthly",
      pricingPhases: [{
        formattedPrice: "₩4,900",
        priceAmountMicros: 4_900_000_000,
        priceCurrencyCode: "KRW",
        billingPeriod: "P1M",
        recurrenceMode: 1,
      }],
    }],
  }, "monthly-2900");
  const expectedAnnual = selectSubscriptionOffer({
    productId: "hyeni_premium",
    subscriptionOfferDetails: [{
      basePlanId: "annual-27840",
      offerToken: "launch-annual",
      pricingPhases: [{
        formattedPrice: "₩39,000",
        priceAmountMicros: 39_000_000_000,
        priceCurrencyCode: "KRW",
        billingPeriod: "P1Y",
        recurrenceMode: 1,
      }],
    }],
  }, "annual-27840");
  assert.equal(hasExpectedLaunchSubscriptionPrice(expectedMonthly), true);
  assert.equal(hasExpectedLaunchSubscriptionPrice(expectedAnnual), true);
  assert.equal(hasExpectedLaunchSubscriptionPrice({
    ...expectedMonthly,
    priceAmountMicros: 2_900_000_000,
  }), false);
});

test("출시 가격은 마지막 무한 반복 phase 기준으로만 승인한다", async () => {
  const { hasExpectedLaunchSubscriptionPrice, selectSubscriptionOffer } = await import(pathToFileURL(modulePath).href);
  const sevenDayTrial = {
    formattedPrice: "₩0",
    priceAmountMicros: 0,
    priceCurrencyCode: "KRW",
    billingPeriod: "P1W",
    billingCycleCount: 1,
    recurrenceMode: 2,
  };
  const expectedAutoRenewing = {
    formattedPrice: "₩4,900",
    priceAmountMicros: 4_900_000_000,
    priceCurrencyCode: "KRW",
    billingPeriod: "P1M",
    recurrenceMode: 1,
  };

  const expectedOffer = selectSubscriptionOffer({
    productId: "hyeni_premium",
    subscriptionOfferDetails: [{
      basePlanId: "monthly-2900",
      offerId: "trial-7d",
      offerToken: "expected-renewal-token",
      pricingPhases: [sevenDayTrial, expectedAutoRenewing],
    }],
  }, "monthly-2900");
  assert.equal(hasExpectedLaunchSubscriptionPrice(expectedOffer), true);

  const mismatchedRenewal = selectSubscriptionOffer({
    productId: "hyeni_premium",
    subscriptionOfferDetails: [{
      basePlanId: "monthly-2900",
      offerId: "trial-intro-renewal",
      offerToken: "mismatched-renewal-token",
      pricingPhases: [
        sevenDayTrial,
        {
          ...expectedAutoRenewing,
          billingCycleCount: 1,
          recurrenceMode: 2,
        },
        {
          ...expectedAutoRenewing,
          formattedPrice: "₩6,900",
          priceAmountMicros: 6_900_000_000,
        },
      ],
    }],
  }, "monthly-2900");
  assert.equal(
    hasExpectedLaunchSubscriptionPrice(mismatchedRenewal),
    false,
    "7일 무료 뒤 유한 4,900원이어도 최종 자동갱신이 6,900원이면 거부해야 합니다",
  );
  assert.equal(mismatchedRenewal?.priceAmountMicros, 6_900_000_000);

  const nonRecurringEnding = selectSubscriptionOffer({
    productId: "hyeni_premium",
    subscriptionOfferDetails: [{
      basePlanId: "monthly-2900",
      offerToken: "non-recurring-token",
      pricingPhases: [{
        ...expectedAutoRenewing,
        recurrenceMode: 3,
      }],
    }],
  }, "monthly-2900");
  assert.equal(nonRecurringEnding, null, "마지막 phase가 무한 반복이 아니면 구독 offer를 선택하면 안 됩니다");
});

test("결제 주기 radio 화살표 키는 두 플랜을 순환하고 Home·End를 지원한다", async () => {
  const { subscriptionPlanForNavigationKey } = await import(pathToFileURL(modulePath).href);
  assert.equal(subscriptionPlanForNavigationKey("year", "ArrowRight"), "month");
  assert.equal(subscriptionPlanForNavigationKey("month", "ArrowRight"), "year");
  assert.equal(subscriptionPlanForNavigationKey("month", "ArrowLeft"), "year");
  assert.equal(subscriptionPlanForNavigationKey("year", "ArrowUp"), "month");
  assert.equal(subscriptionPlanForNavigationKey("month", "Home"), "year");
  assert.equal(subscriptionPlanForNavigationKey("year", "End"), "month");
  assert.equal(subscriptionPlanForNavigationKey("year", "Enter"), null);
});
