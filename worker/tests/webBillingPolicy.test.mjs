import test from "node:test";
import assert from "node:assert/strict";

import {
  WEB_BILLING_MAX_RENEWAL_FAILURES,
  WEB_BILLING_PLANS,
  WEB_BILLING_TRIAL_DAYS,
  addWebBillingPeriod,
  addWebBillingTrialPeriod,
  createWebBillingCustomerKey,
  createWebBillingOrderId,
  decryptWebBillingSecret,
  encryptWebBillingSecret,
  hashWebBillingPaymentKey,
  hashWebBillingRefundState,
  readWebBillingConfig,
  validateTossBillingAuthorization,
  validateTossBillingPayment,
  validateTossBillingPaymentState,
  webBillingRetryAt,
} from "../shared/webBilling.js";

const ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");

test("웹 구독 금액은 월 4,900원·연 39,000원으로만 고정한다", () => {
  assert.deepEqual(WEB_BILLING_PLANS, {
    month: { amount: 4_900, displayPrice: "월 4,900원", basePlanId: "web-month" },
    year: { amount: 39_000, displayPrice: "연 39,000원", basePlanId: "web-year" },
  });
});

test("Toss 설정은 client/secret 환경이 맞고 AES-256 키가 정확할 때만 열린다", () => {
  assert.equal(readWebBillingConfig({}), null);
  assert.equal(readWebBillingConfig({
    TOSS_PAYMENTS_CLIENT_KEY: "test_ck_1234567890",
    TOSS_PAYMENTS_SECRET_KEY: "live_sk_1234567890",
    WEB_BILLING_KEY_ENCRYPTION_SECRET: ENCRYPTION_KEY,
  }), null);
  const config = readWebBillingConfig({
    TOSS_PAYMENTS_CLIENT_KEY: "test_ck_1234567890",
    TOSS_PAYMENTS_SECRET_KEY: "test_sk_1234567890",
    WEB_BILLING_KEY_ENCRYPTION_SECRET: ENCRYPTION_KEY,
  });
  assert.equal(config?.mode, "test");
});

test("빌링키는 family/customer AAD로 AES-GCM 암복호화하고 다른 가족에서는 열리지 않는다", async () => {
  const encrypted = await encryptWebBillingSecret(
    ENCRYPTION_KEY,
    "billing-key-secret",
    "family-1",
    "customer-1",
  );
  assert.notEqual(encrypted.ciphertext, "billing-key-secret");
  assert.equal(
    await decryptWebBillingSecret(ENCRYPTION_KEY, encrypted, "family-1", "customer-1"),
    "billing-key-secret",
  );
  await assert.rejects(
    decryptWebBillingSecret(ENCRYPTION_KEY, encrypted, "family-2", "customer-1"),
  );
});

test("월 결제 종료일은 말일을 안전하게 보정하고 연 결제는 윤년을 보정한다", () => {
  assert.equal(
    addWebBillingPeriod(new Date("2026-01-31T12:00:00.000Z"), "month").toISOString(),
    "2026-02-28T12:00:00.000Z",
  );
  assert.equal(
    addWebBillingPeriod(new Date("2024-02-29T12:00:00.000Z"), "year").toISOString(),
    "2025-02-28T12:00:00.000Z",
  );
});

test("PWA 무료 체험은 결제 정보 등록 시각에서 정확히 7일 후에 끝난다", () => {
  assert.equal(WEB_BILLING_TRIAL_DAYS, 7);
  assert.equal(
    addWebBillingTrialPeriod(new Date("2026-08-01T12:34:56.789Z")).toISOString(),
    "2026-08-08T12:34:56.789Z",
  );
});

test("자동결제 Payment 응답은 customerKey 없이도 order/금액/KRW/DONE이 모두 일치해야 승인한다", () => {
  const payment = {
    paymentKey: "payment-key",
    orderId: "HYENI-order-123",
    status: "DONE",
    type: "BILLING",
    currency: "KRW",
    totalAmount: 4_900,
  };
  assert.equal(validateTossBillingPayment(payment, {
    orderId: "HYENI-order-123",
    customerKey: "customer-1",
    amount: 4_900,
  }).paymentKey, "payment-key");
  assert.throws(() => validateTossBillingPayment({ ...payment, totalAmount: 39_000 }, {
    orderId: "HYENI-order-123",
    customerKey: "customer-1",
    amount: 4_900,
  }), /toss_payment_mismatch/);
  assert.throws(() => validateTossBillingPayment({ ...payment, status: "CANCELED" }, {
    orderId: "HYENI-order-123",
    customerKey: "customer-1",
    amount: 4_900,
  }), /toss_payment_mismatch/);
  assert.throws(() => validateTossBillingPayment({ ...payment, totalAmount: "4900" }, {
    orderId: "HYENI-order-123",
    customerKey: "customer-1",
    amount: 4_900,
  }), /toss_payment_mismatch/);
  assert.deepEqual(validateTossBillingPayment({ ...payment, paymentKey: "x" }, {
    orderId: "HYENI-order-123",
    customerKey: "customer-1",
    amount: 4_900,
  }), { paymentKey: "x" });
  assert.throws(() => validateTossBillingPayment({ ...payment, paymentKey: "x".repeat(201) }, {
    orderId: "HYENI-order-123",
    customerKey: "customer-1",
    amount: 4_900,
  }), /toss_payment_mismatch/);
});

test("빌링키 발급 응답은 요청 customerKey와 엄격히 일치해야 한다", () => {
  assert.deepEqual(validateTossBillingAuthorization({
    customerKey: "customer-1",
    billingKey: "billing-key-123",
  }, "customer-1"), { billingKey: "billing-key-123" });
  assert.throws(() => validateTossBillingAuthorization({
    customerKey: "customer-2",
    billingKey: "billing-key-123",
  }, "customer-1"), /toss_billing_authorization_mismatch/);
  assert.throws(() => validateTossBillingAuthorization({
    customerKey: " customer-1 ",
    billingKey: "billing-key-123",
  }, "customer-1"), /toss_billing_authorization_mismatch/);
  assert.deepEqual(validateTossBillingAuthorization({
    customerKey: "customer-1",
    billingKey: "x",
  }, "customer-1"), { billingKey: "x" });
  assert.throws(() => validateTossBillingAuthorization({
    customerKey: "customer-1",
    billingKey: "x".repeat(201),
  }, "customer-1"), /toss_billing_authorization_mismatch/);
});

test("customerKey와 주문번호는 무작위·결정적 멱등 성격을 각각 유지한다", async () => {
  const firstCustomer = createWebBillingCustomerKey();
  const secondCustomer = createWebBillingCustomerKey();
  assert.match(firstCustomer, /^HYENI_[a-f0-9]{32}$/);
  assert.notEqual(firstCustomer, secondCustomer);

  const firstOrder = await createWebBillingOrderId("renewal", "family:period:0");
  const sameOrder = await createWebBillingOrderId("renewal", "family:period:0");
  const nextOrder = await createWebBillingOrderId("renewal", "family:period:1");
  assert.equal(firstOrder, sameOrder);
  assert.notEqual(firstOrder, nextOrder);
  assert.match(firstOrder, /^HYENI-R-[a-f0-9]{40}$/);

  const trialConversion = await createWebBillingOrderId(
    "trial_conversion",
    "family:2026-08-08T12:34:56.789Z:0",
  );
  assert.equal(
    trialConversion,
    await createWebBillingOrderId("trial_conversion", "family:2026-08-08T12:34:56.789Z:0"),
  );
  assert.match(trialConversion, /^HYENI-T-[a-f0-9]{40}$/);
});

test("paymentKey는 원문 대신 도메인 분리 hash만 남기고 재시도 간격은 단계적으로 늘린다", async () => {
  assert.equal(WEB_BILLING_MAX_RENEWAL_FAILURES, 4);
  assert.notEqual(await hashWebBillingPaymentKey("payment-secret"), "payment-secret");
  const now = new Date("2026-08-01T00:00:00.000Z");
  assert.equal(webBillingRetryAt(now, 1).toISOString(), "2026-08-01T01:00:00.000Z");
  assert.equal(webBillingRetryAt(now, 2).toISOString(), "2026-08-01T06:00:00.000Z");
  assert.equal(webBillingRetryAt(now, 3).toISOString(), "2026-08-02T00:00:00.000Z");
});

test("Toss 자동결제 환불은 상태·잔액·성공 취소 합계가 모두 맞아야 정본으로 인정한다", () => {
  const expected = {
    orderId: "HYENI-I-refund-contract-1234567890",
    customerKey: "customer-refund",
    amount: 4_900,
  };
  const base = {
    paymentKey: "payment-refund-contract",
    orderId: expected.orderId,
    type: "BILLING",
    currency: "KRW",
    totalAmount: expected.amount,
  };
  const partial = {
    ...base,
    status: "PARTIAL_CANCELED",
    balanceAmount: 3_900,
    cancels: [{
      cancelAmount: 1_000,
      refundableAmount: 3_900,
      transactionKey: "cancel-transaction-partial",
      cancelStatus: "DONE",
      canceledAt: "2026-08-01T12:00:00+09:00",
    }],
  };
  assert.deepEqual(validateTossBillingPaymentState(partial, expected), {
    state: "partial_refund",
    paymentKey: base.paymentKey,
    refundedAmount: 1_000,
    balanceAmount: 3_900,
    transactionKeys: ["cancel-transaction-partial"],
  });

  const full = {
    ...partial,
    status: "CANCELED",
    balanceAmount: 0,
    cancels: [
      partial.cancels[0],
      {
        cancelAmount: 3_900,
        refundableAmount: 0,
        transactionKey: "cancel-transaction-full",
        cancelStatus: "DONE",
        canceledAt: "2026-08-02T12:00:00+09:00",
      },
    ],
  };
  assert.deepEqual(validateTossBillingPaymentState(full, expected), {
    state: "refunded",
    paymentKey: base.paymentKey,
    refundedAmount: 4_900,
    balanceAmount: 0,
    transactionKeys: ["cancel-transaction-full", "cancel-transaction-partial"],
  });

  assert.throws(
    () => validateTossBillingPaymentState({ ...full, balanceAmount: 1 }, expected),
    /toss_payment_mismatch/,
  );
  assert.throws(
    () => validateTossBillingPaymentState({
      ...full,
      cancels: full.cancels.map((cancel) => ({ ...cancel, cancelStatus: "PENDING" })),
    }, expected),
    /toss_payment_mismatch/,
  );
  assert.throws(
    () => validateTossBillingPaymentState({ ...partial, totalAmount: 39_000 }, expected),
    /toss_payment_mismatch/,
  );
});

test("Toss 취소 이력은 임의 100건 제한 없이 bounded 응답 안의 전체 성공 건을 검증한다", async () => {
  const expected = {
    orderId: "HYENI-I-refund-many-cancels-1234567890",
    customerKey: "customer-refund-many",
    amount: 4_900,
  };
  const cancels = Array.from({ length: 101 }, (_, index) => ({
    cancelAmount: index === 100 ? 4_800 : 1,
    refundableAmount: index === 100 ? 0 : 4_899 - index,
    transactionKey: `cancel-many-${String(index).padStart(3, "0")}`,
    cancelStatus: "DONE",
    canceledAt: "2026-08-01T12:00:00+09:00",
  }));
  const state = validateTossBillingPaymentState({
    paymentKey: "payment-refund-many",
    orderId: expected.orderId,
    status: "CANCELED",
    type: "BILLING",
    currency: "KRW",
    totalAmount: expected.amount,
    balanceAmount: 0,
    cancels,
  }, expected);
  assert.equal(state.refundedAmount, 4_900);
  assert.equal(state.transactionKeys.length, 101);
  assert.match(await hashWebBillingRefundState(state), /^[0-9a-f]{64}$/);
});
