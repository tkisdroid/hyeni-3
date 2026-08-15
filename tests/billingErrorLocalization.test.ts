import assert from "node:assert/strict";
import test from "node:test";
import type { IntlShape } from "react-intl";

import { localizeApiError } from "../src/i18n/apiError.ts";
import {
  BillingError,
  normalizeBillingFailure,
} from "../src/lib/native/billingError.ts";

const messages: Record<string, string> = {
  "core.error.billing.canceled.formal": "구매를 취소했어요.",
  "core.error.billing.pending.formal": "결제 승인이 대기 중이에요. 승인 완료 후 다시 확인해 주세요.",
  "core.error.billing.productUnavailable.formal": "Google Play 상품을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.",
  "core.error.billing.unavailable.formal": "이 기기에서는 Google Play 결제를 사용할 수 없어요.",
};
const intl = {
  formatMessage(descriptor: { id: string }) {
    return messages[descriptor.id] ?? `missing:${descriptor.id}`;
  },
} as IntlShape;

test("native bridge 결제 상태는 raw message 대신 typed stable code로 보존된다", () => {
  const cases = [
    ["purchase_canceled", "purchase_canceled"],
    ["purchase_pending", "purchase_pending"],
    ["product_unavailable", "product_unavailable"],
    ["product_offer_unavailable", "product_unavailable"],
    ["billing_unavailable", "billing_unavailable"],
  ] as const;
  for (const [rawCode, expectedCode] of cases) {
    const error = normalizeBillingFailure({
      code: rawCode,
      message: "Bearer purchase-token order-token",
    });
    assert.ok(error instanceof BillingError);
    assert.equal(error.code, expectedCode);
    assert.equal(error.message, "Billing request failed");
    assert.equal(error.stack?.includes("purchase-token") ?? false, false);
  }
});

test("Subscription과 AI credit 공용 localizer는 native 결제 상태별 안내를 유지한다", () => {
  const cases = [
    ["purchase_canceled", "구매를 취소했어요."],
    ["purchase_pending", "결제 승인이 대기 중이에요. 승인 완료 후 다시 확인해 주세요."],
    ["product_unavailable", "Google Play 상품을 불러오지 못했어요. 잠시 후 다시 시도해 주세요."],
    ["billing_unavailable", "이 기기에서는 Google Play 결제를 사용할 수 없어요."],
  ] as const;
  for (const [code, expected] of cases) {
    assert.equal(localizeApiError(new BillingError(code), intl, "formal"), expected, code);
  }
});
