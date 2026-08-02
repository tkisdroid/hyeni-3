import test from "node:test";
import assert from "node:assert/strict";

import {
  createWebAiCreditOrderId,
  readWebAiCreditCatalog,
  validateTossOneTimePayment,
  validateTossOneTimePaymentState,
} from "../shared/webAiCreditBilling.js";

test("가격 env가 없거나 유효하지 않은 AI 크레딧 팩은 카탈로그에 노출하지 않는다", () => {
  assert.deepEqual(readWebAiCreditCatalog({}), []);
  assert.deepEqual(readWebAiCreditCatalog({
    TOSS_AI_CREDIT_30_AMOUNT_KRW: "12345",
    TOSS_AI_CREDIT_80_AMOUNT_KRW: "not-a-price",
    TOSS_AI_CREDIT_200_AMOUNT_KRW: "0",
  }), [{
    productCode: "ai-credit-30",
    credits: 30,
    amount: 12_345,
    displayPrice: "12,345원",
  }]);
});

test("Toss 전액 취소는 원 주문 금액과 balanceAmount 0을 모두 확인해야 환불로 확정한다", () => {
  const expected = {
    orderId: "HYENI-AI-refund123",
    customerKey: "HYENI_customer_refund",
    amount: 12_345,
  };
  const cancelled = {
    paymentKey: "pay_refund",
    orderId: expected.orderId,
    status: "CANCELED",
    type: "NORMAL",
    currency: "KRW",
    totalAmount: expected.amount,
    balanceAmount: 0,
  };
  assert.deepEqual(validateTossOneTimePaymentState(cancelled, expected), {
    state: "refunded",
    paymentKey: "pay_refund",
    refundedAmount: 12_345,
  });
  assert.throws(
    () => validateTossOneTimePaymentState({ ...cancelled, balanceAmount: 1 }, expected),
    /toss_ai_credit_payment_mismatch/,
  );
  assert.deepEqual(validateTossOneTimePaymentState({
    ...cancelled,
    status: "PARTIAL_CANCELED",
    balanceAmount: 10_000,
  }, expected), {
    state: "partial_refund",
    paymentKey: "pay_refund",
    refundedAmount: 2_345,
  });
});

test("웹 AI 크레딧 상품은 보고서가 확정한 30·80·200팩 외 값을 만들 수 없다", () => {
  const catalog = readWebAiCreditCatalog({
    TOSS_AI_CREDIT_30_AMOUNT_KRW: "12345",
    TOSS_AI_CREDIT_80_AMOUNT_KRW: "23456",
    TOSS_AI_CREDIT_200_AMOUNT_KRW: "34567",
    TOSS_AI_CREDIT_100_AMOUNT_KRW: "1",
  });
  assert.deepEqual(catalog.map((pack) => pack.credits), [30, 80, 200]);
});

test("Toss 일반결제 Payment 응답은 customerKey 없이도 주문·정본 금액·KRW·DONE·NORMAL로 검증한다", () => {
  const expected = {
    orderId: "HYENI-AI-123456",
    customerKey: "HYENI_customer_123",
    amount: 12_345,
  };
  const payment = {
    paymentKey: "pay_123",
    orderId: expected.orderId,
    status: "DONE",
    type: "NORMAL",
    currency: "KRW",
    totalAmount: expected.amount,
  };
  assert.deepEqual(validateTossOneTimePayment(payment, expected), { paymentKey: "pay_123" });
  assert.throws(
    () => validateTossOneTimePayment({ ...payment, totalAmount: expected.amount - 1 }, expected),
    /toss_ai_credit_payment_mismatch/,
  );
  assert.throws(
    () => validateTossOneTimePayment({ ...payment, currency: "USD" }, expected),
    /toss_ai_credit_payment_mismatch/,
  );
  assert.throws(
    () => validateTossOneTimePayment({ ...payment, orderId: "HYENI-AI-other" }, expected),
    /toss_ai_credit_payment_mismatch/,
  );
});

test("일회성 주문 ID는 Toss 허용 문자와 길이를 지키며 호출마다 고유하다", () => {
  const first = createWebAiCreditOrderId();
  const second = createWebAiCreditOrderId();
  assert.match(first, /^[A-Za-z0-9_-]{6,64}$/);
  assert.notEqual(first, second);
});
