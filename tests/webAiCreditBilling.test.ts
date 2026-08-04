import test from "node:test";
import assert from "node:assert/strict";

import {
  buildWebAiCreditRedirectUrls,
  clearWebAiCreditRedirectQuery,
  parseWebAiCreditRedirect,
  readPendingWebAiCreditCheckout,
  resolveWebAiCreditDebtImpact,
  savePendingWebAiCreditCheckout,
  validateWebAiCreditCatalog,
  validateWebAiCreditCheckout,
  validateRecoveredWebAiCreditCheckout,
  type WebAiCreditPendingStorage,
} from "../src/transform/webAiCreditBilling.ts";

test("환불 사용분 상계는 팩 결제 전 실제 사용 가능 증가분을 정확히 계산한다", () => {
  assert.deepEqual(resolveWebAiCreditDebtImpact(30, 25), {
    debtApplied: 25,
    availableCreditsAdded: 5,
    remainingDebt: 0,
  });
  assert.deepEqual(resolveWebAiCreditDebtImpact(30, 50), {
    debtApplied: 30,
    availableCreditsAdded: 0,
    remainingDebt: 20,
  });
  assert.deepEqual(resolveWebAiCreditDebtImpact(80, 0), {
    debtApplied: 0,
    availableCreditsAdded: 80,
    remainingDebt: 0,
  });
});

class MemoryStorage implements WebAiCreditPendingStorage {
  #data = new Map<string, string>();

  getItem(key: string): string | null {
    return this.#data.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.#data.set(key, value);
  }

  removeItem(key: string): void {
    this.#data.delete(key);
  }

  values(): string[] {
    return [...this.#data.values()];
  }
}

test("웹 AI 크레딧 카탈로그는 서버가 확정한 30·80·200팩만 정수 KRW로 받는다", () => {
  const catalog = validateWebAiCreditCatalog({
    provider: "toss_payments",
    currency: "KRW",
    configured: true,
    packs: [
      { productCode: "ai-credit-30", credits: 30, amount: 12_345, displayPrice: "12,345원" },
      { productCode: "ai-credit-80", credits: 80, amount: 23_456, displayPrice: "23,456원" },
    ],
  });
  assert.deepEqual(catalog.packs.map((pack) => pack.credits), [30, 80]);
  assert.throws(() => validateWebAiCreditCatalog({
    ...catalog,
    packs: [{ productCode: "ai-credit-100", credits: 100, amount: 1, displayPrice: "1원" }],
  }), /invalid_web_ai_credit_catalog/);
  assert.throws(() => validateWebAiCreditCatalog({
    ...catalog,
    currency: "USD",
  }), /invalid_web_ai_credit_catalog/);
  assert.throws(() => validateWebAiCreditCatalog({
    ...catalog,
    packs: [{ productCode: "ai-credit-30", credits: 30, amount: "12345", displayPrice: "12,345원" }],
  }), /invalid_web_ai_credit_catalog/);
});

test("가격이 확정되지 않은 서버 카탈로그는 빈 팩만 허용한다", () => {
  assert.deepEqual(validateWebAiCreditCatalog({
    provider: "toss_payments",
    currency: "KRW",
    configured: false,
    packs: [],
  }).packs, []);
  assert.throws(() => validateWebAiCreditCatalog({
    provider: "toss_payments",
    currency: "KRW",
    configured: false,
    packs: [{ productCode: "ai-credit-30", credits: 30, amount: 12_345, displayPrice: "12,345원" }],
  }), /invalid_web_ai_credit_catalog/);
});

test("checkout 응답은 선택 팩·서버 카탈로그 금액·통화가 모두 같을 때만 신뢰한다", () => {
  const pack = {
    productCode: "ai-credit-30" as const,
    credits: 30 as const,
    amount: 12_345,
    displayPrice: "12,345원",
  };
  const value = {
    orderId: "HYENI-AI-1234567890",
    customerKey: "HYENI_customer_123",
    clientKey: "test_ck_1234567890",
    productCode: pack.productCode,
    credits: pack.credits,
    amount: pack.amount,
    currency: "KRW",
    expiresAt: "2099-08-01T03:15:00.000Z",
  };
  assert.equal(validateWebAiCreditCheckout(value, pack).amount, 12_345);
  assert.throws(
    () => validateWebAiCreditCheckout({ ...value, amount: 12_346 }, pack),
    /invalid_web_ai_credit_checkout/,
  );
  assert.throws(
    () => validateWebAiCreditCheckout({ ...value, credits: 80 }, pack),
    /invalid_web_ai_credit_checkout/,
  );
});

test("sessionStorage 유실 복구 응답은 현재 가족·아이·주문·금액과 서버 상품 정본이 모두 같아야 한다", () => {
  const expected = {
    familyId: "family-1",
    childUserId: "child-1",
    orderId: "HYENI-AI-1234567890",
    amount: 12_345,
  };
  const value = {
    ...expected,
    customerKey: "HYENI_customer_123",
    productCode: "ai-credit-30",
    credits: 30,
    currency: "KRW",
    expiresAt: "2099-08-01T03:15:00.000Z",
  };

  assert.deepEqual(validateRecoveredWebAiCreditCheckout(value, expected), value);
  for (const tampered of [
    { ...value, familyId: "family-other" },
    { ...value, childUserId: "child-other" },
    { ...value, orderId: "HYENI-AI-other123" },
    { ...value, amount: 12_346 },
    { ...value, customerKey: "invalid customer" },
    { ...value, productCode: "ai-credit-80" },
    { ...value, credits: 80 },
    { ...value, currency: "USD" },
  ]) {
    assert.throws(
      () => validateRecoveredWebAiCreditCheckout(tampered, expected),
      /invalid_web_ai_credit_recovery/,
    );
  }
});

test("일회성 결제 복귀 URL은 같은 origin의 AI 크레딧 화면으로만 만든다", () => {
  assert.deepEqual(
    buildWebAiCreditRedirectUrls("https://hyeni-calendar.pages.dev/?from=old#/ai-credit"),
    {
      successUrl: "https://hyeni-calendar.pages.dev/?aiCreditResult=success#/ai-credit",
      failUrl: "https://hyeni-calendar.pages.dev/?aiCreditResult=fail#/ai-credit",
    },
  );
});

test("성공 복귀는 paymentKey·orderId·amount를 엄격히 읽고 주소에서 즉시 제거한다", () => {
  assert.deepEqual(parseWebAiCreditRedirect(
    "?aiCreditResult=success&paymentKey=pay_123&orderId=HYENI-AI-123456&amount=12345",
  ), {
    kind: "success",
    paymentKey: "pay_123",
    orderId: "HYENI-AI-123456",
    amount: 12_345,
  });
  assert.deepEqual(parseWebAiCreditRedirect(
    "?aiCreditResult=success&paymentKey=pay_123&orderId=HYENI-AI-123456&amount=12.3",
  ), { kind: "invalid" });
  assert.equal(
    clearWebAiCreditRedirectQuery(
      "https://hyeni-calendar.pages.dev/?aiCreditResult=success&paymentKey=secret&orderId=HYENI-AI-123456&amount=12345#/ai-credit",
    ),
    "https://hyeni-calendar.pages.dev/#/ai-credit",
  );
});

test("pending 저장에는 paymentKey 원문을 넣지 않고 만료·불일치 행을 폐기한다", () => {
  const storage = new MemoryStorage();
  savePendingWebAiCreditCheckout(storage, {
    orderId: "HYENI-AI-123456",
    customerKey: "HYENI_customer_123",
    familyId: "family-1",
    childUserId: "child-1",
    productCode: "ai-credit-30",
    credits: 30,
    amount: 12_345,
    currency: "KRW",
    expiresAt: "2099-08-01T03:15:00.000Z",
  });
  assert.equal(storage.values().some((value) => value.includes("paymentKey")), false);
  assert.equal(readPendingWebAiCreditCheckout(storage)?.credits, 30);
  assert.equal(readPendingWebAiCreditCheckout(storage, Date.parse("2100-08-01T03:15:00.000Z")), null);
});
