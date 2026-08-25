// 앱 소스(`@/` 별칭·확장자 없는 import·import.meta.env)를 Node 로 직접 로드하기 위한 훅.
// 반드시 src/** 를 동적 import 하기 전에 평가돼야 하므로 첫 줄에 둔다.
import "./helpers/appModuleResolve.mjs";

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createIntl, createIntlCache, type IntlShape } from "react-intl";

import { ApiError } from "../src/lib/api/errors.ts";

import {
  WEB_BILLING_AMOUNTS,
  buildWebBillingRedirectUrls,
  clearWebBillingRedirectQuery,
  parseWebBillingRedirect,
  readPendingWebBilling,
  savePendingWebBilling,
  validateWebBillingCatalog,
  validateWebBillingCheckoutSession,
  validateRecoveredWebBillingCheckoutSession,
  webBillingAnnualSavings,
  webBillingRequestFailureMessage,
  type WebBillingPendingStorage,
} from "../src/transform/webBilling.ts";

// 결제 실패 문구는 locale catalog 가 정본이므로 한국어 카탈로그로 intl 을 만들어 검증한다.
const koBilling = JSON.parse(
  readFileSync(new URL("../locales/ko/billing.json", import.meta.url), "utf8"),
) as Record<string, string>;
const koIntl = createIntl({ locale: "ko", messages: koBilling }, createIntlCache()) as IntlShape;

class MemoryStorage implements WebBillingPendingStorage {
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
}

test("웹 월간·연간 결제 금액은 출시 가격으로 고정한다", () => {
  assert.deepEqual(WEB_BILLING_AMOUNTS, { month: 4_900, year: 39_000 });
});

test("결제 인증 복귀 URL은 같은 origin과 HashRouter 구독 화면만 사용한다", () => {
  assert.deepEqual(
    buildWebBillingRedirectUrls("https://hyeni-calendar.pages.dev/?from=old#/subscription"),
    {
      successUrl: "https://hyeni-calendar.pages.dev/?billingResult=success#/subscription",
      failUrl: "https://hyeni-calendar.pages.dev/?billingResult=fail#/subscription",
    },
  );
});

test("성공 복귀는 authKey/customerKey를 엄격히 검증하고 URL에서 민감 쿼리를 제거한다", () => {
  const parsed = parseWebBillingRedirect(
    "?billingResult=success&authKey=auth_123&customerKey=customer_123",
  );
  assert.deepEqual(parsed, {
    kind: "success",
    authKey: "auth_123",
    customerKey: "customer_123",
  });
  assert.deepEqual(parseWebBillingRedirect("?billingResult=success&authKey=abc%2B%2F%3D&customerKey=customer_123"), {
    kind: "success",
    authKey: "abc+/=",
    customerKey: "customer_123",
  });
  assert.equal(
    clearWebBillingRedirectQuery(
      "https://hyeni-calendar.pages.dev/?billingResult=success&authKey=secret&customerKey=customer#/subscription",
    ),
    "https://hyeni-calendar.pages.dev/#/subscription",
  );
  assert.deepEqual(parseWebBillingRedirect("?billingResult=success&authKey=&customerKey=a"), {
    kind: "invalid",
  });
  assert.deepEqual(parseWebBillingRedirect(`?billingResult=success&authKey=${"a".repeat(301)}&customerKey=b`), {
    kind: "invalid",
  });
});

test("실패 복귀는 서버 허용 코드만 유지하고 결제사 원문 메시지는 보존하지 않는다", () => {
  assert.deepEqual(
    parseWebBillingRedirect("?billingResult=fail&code=PAY_PROCESS_CANCELED&message=card%20number"),
    { kind: "fail", code: "PAY_PROCESS_CANCELED" },
  );
  assert.deepEqual(
    parseWebBillingRedirect("?billingResult=fail&code=ATTACKER_CONTROLLED&message=secret"),
    { kind: "fail", code: "UNKNOWN" },
  );
});

test("pending 세션은 sessionStorage에 만료시간과 함께 보관하고 불일치·만료를 폐기한다", () => {
  const storage = new MemoryStorage();
  savePendingWebBilling(storage, {
    sessionId: "session_123",
    customerKey: "customer_123",
    expiresAt: "2026-08-01T03:15:00.000Z",
  });
  assert.deepEqual(readPendingWebBilling(storage, Date.parse("2026-08-01T03:00:00.000Z")), {
    sessionId: "session_123",
    customerKey: "customer_123",
    expiresAt: "2026-08-01T03:15:00.000Z",
  });
  assert.equal(readPendingWebBilling(storage, Date.parse("2026-08-01T03:15:00.000Z")), null);
  assert.equal(storage.getItem("hyeni.webBilling.pending.v1"), null);
});

test("checkout 응답은 선택 플랜의 서버 금액·표시 가격이 정확할 때만 신뢰한다", () => {
  const realNow = Date.now;
  Date.now = () => Date.parse("2026-08-01T03:00:00.000Z");
  try {
    const valid = {
      sessionId: "session_123",
      customerKey: "customer_123",
      clientKey: "test_ck_1234567890",
      plan: "month",
      amount: 4_900,
      displayPrice: "월 4,900원",
      trialEligible: true,
      trialDays: 7,
      expiresAt: "2026-08-01T03:15:00.000Z",
    };
    assert.equal(validateWebBillingCheckoutSession(valid, "month", true).amount, 4_900);
    assert.throws(
      () => validateWebBillingCheckoutSession({ ...valid, amount: 4_901 }, "month", true),
      /invalid_web_billing_response/,
    );
    assert.throws(
      () => validateWebBillingCheckoutSession({ ...valid, amount: "4900" }, "month", true),
      /invalid_web_billing_response/,
    );
    assert.throws(
      () => validateWebBillingCheckoutSession({ ...valid, clientKey: ` ${valid.clientKey}` }, "month", true),
      /invalid_web_billing_response/,
    );
    assert.throws(
      () => validateWebBillingCheckoutSession({ ...valid, plan: "year" }, "month", true),
      /invalid_web_billing_response/,
    );
  } finally {
    Date.now = realNow;
  }
});

test("브라우저 pending 유실 복구 응답은 같은 customerKey의 유효한 session만 허용한다", () => {
  assert.deepEqual(
    validateRecoveredWebBillingCheckoutSession(
      { sessionId: "session_123", customerKey: "customer_123" },
      "customer_123",
    ),
    { sessionId: "session_123", customerKey: "customer_123" },
  );
  assert.throws(
    () => validateRecoveredWebBillingCheckoutSession(
      { sessionId: "session_123", customerKey: "customer_other" },
      "customer_123",
    ),
    /invalid_web_billing_recovery/,
  );
  assert.throws(
    () => validateRecoveredWebBillingCheckoutSession(
      { sessionId: "short", customerKey: "customer_123" },
      "customer_123",
    ),
    /invalid_web_billing_recovery/,
  );
});

test("웹 가격표는 서버가 반환한 KRW 월 4,900원·연 39,000원만 표시하고 절약액을 응답에서 계산한다", () => {
  const catalog = validateWebBillingCatalog({
    provider: "toss_payments",
    currency: "KRW",
    trialEligible: true,
    trialDays: 7,
    plans: {
      month: { amount: 4_900, displayPrice: "월 4,900원" },
      year: { amount: 39_000, displayPrice: "연 39,000원" },
    },
  });
  assert.equal(webBillingAnnualSavings(catalog), 19_800);
  assert.throws(() => validateWebBillingCatalog({
    ...catalog,
    trialEligible: false,
    trialDays: 7,
  }), /invalid_web_billing_catalog/);
  assert.throws(() => validateWebBillingCatalog({
    ...catalog,
    plans: { ...catalog.plans, year: { amount: 38_999, displayPrice: "연 38,999원" } },
  }), /invalid_web_billing_catalog/);
  assert.throws(() => validateWebBillingCatalog({
    ...catalog,
    plans: { ...catalog.plans, month: { amount: "4900", displayPrice: "월 4,900원" } },
  }), /invalid_web_billing_catalog/);
});

test("웹 결제 서버 오류 코드는 결제·대사·해지 상태를 숨기지 않는 안내로 변환한다", () => {
  const error = (code: string, status = 409) => new ApiError(code, status);
  assert.equal(
    webBillingRequestFailureMessage(error("web_subscription_new_checkouts_paused", 503), koIntl),
    "새 구독 결제를 잠시 중단했어요. 기존 결제 확인과 해지는 계속 이용할 수 있어요.",
  );
  assert.equal(
    webBillingRequestFailureMessage(error("web_billing_unavailable"), koIntl),
    "웹 결제가 아직 준비되지 않았어요. 잠시 후 다시 확인해 주세요.",
  );
  assert.equal(
    webBillingRequestFailureMessage(error("web_billing_session_expired", 410), koIntl),
    "결제 인증 시간이 지나 다시 시작해야 해요.",
  );
  assert.equal(
    webBillingRequestFailureMessage(error("subscription_already_active"), koIntl),
    "이미 프리미엄을 이용 중이에요.",
  );
  assert.equal(
    webBillingRequestFailureMessage(error("web_billing_charge_failed"), koIntl),
    "카드 승인을 완료하지 못했어요. 카드 상태를 확인해 주세요.",
  );
  assert.equal(
    webBillingRequestFailureMessage(error("web_billing_reconciliation_pending"), koIntl),
    "결제 결과를 확인하고 있어요. 같은 주문을 다시 확인해 주세요.",
  );
  assert.equal(
    webBillingRequestFailureMessage(error("billing_provider_reconciliation_pending"), koIntl),
    "결제 결과를 확인하고 있어요. 같은 주문을 다시 확인해 주세요.",
  );
  assert.match(
    webBillingRequestFailureMessage(error("billing_provider_conflict_refund_required"), koIntl),
    /다른 스토어 구독.*환불 확인/,
  );
  assert.equal(
    webBillingRequestFailureMessage(error("web_billing_cancellation_unavailable"), koIntl),
    "구독 해지 예약을 완료하지 못했어요. 잠시 후 다시 시도해 주세요.",
  );
  assert.match(
    webBillingRequestFailureMessage(error("web_billing_trial_state_changed"), koIntl),
    /결제하지 않고.*다시 확인/,
  );
});

test("웹 결제 로컬 sentinel만 Error.message로 해석하고 임의 원문은 일반 안내로 닫는다", () => {
  assert.equal(
    webBillingRequestFailureMessage(new Error("web_billing_not_configured"), koIntl),
    "웹 결제가 아직 준비되지 않았어요. 잠시 후 다시 확인해 주세요.",
  );
  assert.equal(
    webBillingRequestFailureMessage(new Error("web_billing_session_storage_unavailable"), koIntl),
    "웹 결제를 완료하지 못했어요. 잠시 후 다시 시도해 주세요.",
  );
  const raw = "DECLINED: card 4111 secret-token";
  const message = webBillingRequestFailureMessage(new Error(raw), koIntl);
  assert.equal(message, "웹 결제를 완료하지 못했어요. 잠시 후 다시 시도해 주세요.");
  assert.doesNotMatch(message, /4111|secret-token|DECLINED/);
});

test("웹 checkout·복구·해지 catch는 같은 안전 resolver를 사용한다", () => {
  const source = readFileSync(
    new URL("../src/screens/feature/Subscription.tsx", import.meta.url),
    "utf8",
  );
  assert.equal(
    source.match(/webBillingRequestFailureMessage\(error, intl\)/g)?.length,
    3,
    "checkout, redirect 복구, 해지 실패 경로를 모두 안전 resolver에 연결해야 한다",
  );
  // 문구는 catalog 가 정본이므로 resolver 는 intl 없이 호출될 수 없다.
  assert.doesNotMatch(source, /webBillingRequestFailureMessage\(error\)/);
  assert.doesNotMatch(source, /show\([^)]*error\.message/);
});

test("실제 apiRequest 경계가 만든 ApiError.code도 웹 결제 안전 문구로 이어진다", async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response(JSON.stringify({
      code: "web_billing_reconciliation_pending",
      error: "provider raw token-should-not-appear",
    }), {
      status: 409,
      headers: { "Content-Type": "application/json" },
    });
    // 훅이 등록된 뒤에 해석되도록 동적 import 를 쓴다(정적 import 는 링크 시점이 더 이르다).
    const api = await import("../src/lib/api/client.ts");
    await assert.rejects(
      api.apiRequest("/api/web-billing/test", {}, false),
      (error: unknown) => {
        assert.equal((error as { code?: unknown }).code, "web_billing_reconciliation_pending");
        const message = webBillingRequestFailureMessage(error, koIntl);
        assert.equal(message, "결제 결과를 확인하고 있어요. 같은 주문을 다시 확인해 주세요.");
        assert.doesNotMatch(message, /provider|token-should-not-appear/);
        return true;
      },
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
