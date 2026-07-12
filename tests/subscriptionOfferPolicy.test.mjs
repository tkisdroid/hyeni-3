import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const modulePath = resolve(rootDir, "src/transform/subscriptionOffer.ts");

test("Google Play eligible offer 중 정확한 7일 무료 체험을 우선하고 없으면 일반 결제를 고른다", async () => {
  assert.equal(existsSync(modulePath), true, "구독 offer 선택 정책 모듈이 아직 없습니다");
  const { selectSubscriptionOffer } = await import(pathToFileURL(modulePath).href);

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
});
