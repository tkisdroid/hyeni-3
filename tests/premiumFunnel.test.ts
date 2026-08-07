import test from "node:test";
import assert from "node:assert/strict";

// Vite define 값과 같은 전역을 ESM import 전에 주입한다.
globalThis.__APP_VERSION__ = "1.3.0";

const {
  classifyPremiumCheckoutFailure,
  clearPremiumFunnelEventsForTests,
  flushPremiumFunnelEventsForTests,
  readPremiumFunnelEvents,
  recordPremiumFunnelEvent,
  setPremiumFunnelTransportForTests,
} = await import("../src/lib/premiumFunnel.ts");

test("프리미엄 퍼널은 UUID·앱 버전·발생 시각만 붙인 allowlist 이벤트를 전송한다", async () => {
  clearPremiumFunnelEventsForTests();
  const batches: unknown[][] = [];
  setPremiumFunnelTransportForTests(async (events) => {
    batches.push(events.map((event) => ({ ...event })));
  });

  assert.equal(recordPremiumFunnelEvent({
    event: "paywall_impression",
    source: "saved_place",
    tier: "free",
  }), true);
  assert.equal(recordPremiumFunnelEvent({
    event: "checkout_result",
    result: "success",
    provider: "google_play",
    error_code: null,
  }), true);
  assert.equal(recordPremiumFunnelEvent({
    event: "paywall_impression",
    source: "first_location",
    tier: "free",
  }), true);
  assert.equal(recordPremiumFunnelEvent({
    event: "paywall_cta",
    source: "first_arrival",
    tier: "free",
  }), true);
  assert.equal(recordPremiumFunnelEvent({
    event: "paywall_impression",
    source: "location_live_interval",
    tier: "free",
  }), true);
  assert.equal(recordPremiumFunnelEvent({
    event: "paywall_cta",
    source: "ai_friend_limit",
    tier: "free",
  }), true);
  assert.equal(recordPremiumFunnelEvent({
    event: "paywall_impression",
    source: "ai_schedule_limit",
    tier: "free",
  }), true);
  await flushPremiumFunnelEventsForTests();

  const sent = batches.flat() as Array<Record<string, unknown>>;
  assert.equal(sent.length, 7);
  assert.match(String(sent[0]?.event_id), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  assert.equal(sent[0]?.app_version, "1.3.0");
  assert.equal(new Date(String(sent[0]?.occurred_at)).toISOString(), sent[0]?.occurred_at);
  assert.deepEqual(
    sent.map(({ event_id: _eventId, app_version: _appVersion, occurred_at: _occurredAt, ...event }) => event),
    [
      { event: "paywall_impression", source: "saved_place", tier: "free" },
      { event: "checkout_result", result: "success", provider: "google_play", error_code: null },
      { event: "paywall_impression", source: "first_location", tier: "free" },
      { event: "paywall_cta", source: "first_arrival", tier: "free" },
      { event: "paywall_impression", source: "location_live_interval", tier: "free" },
      { event: "paywall_cta", source: "ai_friend_limit", tier: "free" },
      { event: "paywall_impression", source: "ai_schedule_limit", tier: "free" },
    ],
  );
  assert.deepEqual(readPremiumFunnelEvents(), []);
});

test("프리미엄 퍼널은 식별자·위치·가격·결제 토큰·자유문구가 섞인 이벤트를 통째로 거부한다", () => {
  clearPremiumFunnelEventsForTests();
  setPremiumFunnelTransportForTests(async () => undefined);

  const unsafeInputs = [
    { event: "paywall_cta", source: "saved_place", tier: "free", user_id: "user-1" },
    { event: "checkout_start", plan: "year", provider: "google_play", price: "₩39,000" },
    { event: "checkout_result", result: "fail", provider: "google_play", error_code: "unknown", purchaseToken: "secret" },
    { event: "subscription_view", source: "direct", latitude: 37.1, longitude: 127.1 },
    { event: "checkout_result", result: "fail", provider: "google_play", error_code: "카드가 거절됨" },
  ];

  for (const input of unsafeInputs) {
    assert.equal(recordPremiumFunnelEvent(input), false);
  }
  assert.deepEqual(readPremiumFunnelEvents(), []);
});

test("활성화·체험·갱신·환불은 클라이언트 기록 경계에서 거부한다", () => {
  clearPremiumFunnelEventsForTests();
  setPremiumFunnelTransportForTests(async () => undefined);

  for (const event of ["entitlement_activated", "trial_start", "renewal", "refund"]) {
    assert.equal(recordPremiumFunnelEvent({
      event,
      provider: "google_play",
      plan: "month",
    }), false);
  }
  assert.deepEqual(readPremiumFunnelEvents(), []);
});

test("상품 조회 결과는 boolean이 아니라 고정 result 값만 허용한다", async () => {
  clearPremiumFunnelEventsForTests();
  const sent: unknown[] = [];
  setPremiumFunnelTransportForTests(async (events) => {
    sent.push(...events);
  });

  assert.equal(recordPremiumFunnelEvent({
    event: "product_query_result",
    provider: "toss_payments",
    result: "success",
  }), true);
  assert.equal(recordPremiumFunnelEvent({
    event: "product_query_result",
    provider: "toss_payments",
    success: true,
  }), false);
  await flushPremiumFunnelEventsForTests();
  assert.equal(sent.length, 1);
});

test("전송 실패는 삼키고 큐를 보존하며 다음 기록에서 함께 재시도한다", async () => {
  clearPremiumFunnelEventsForTests();
  const attempts: unknown[][] = [];
  let shouldFail = true;
  setPremiumFunnelTransportForTests(async (events) => {
    attempts.push(events.map((event) => ({ ...event })));
    if (shouldFail) throw new Error("분석 서버 실패 원문");
  });

  assert.equal(recordPremiumFunnelEvent({ event: "subscription_view", source: "direct" }), true);
  await flushPremiumFunnelEventsForTests();
  assert.equal(readPremiumFunnelEvents().length, 1);

  shouldFail = false;
  assert.equal(recordPremiumFunnelEvent({
    event: "paywall_continue_free",
    source: "weekly_report",
    tier: "free",
  }), true);
  await flushPremiumFunnelEventsForTests();

  assert.equal(attempts.length, 2);
  assert.equal(attempts[1]?.length, 2);
  assert.deepEqual(readPremiumFunnelEvents(), []);
});

test("메모리 큐는 100건, 전송 배치는 20건으로 제한되고 브라우저 저장소를 쓰지 않는다", async () => {
  clearPremiumFunnelEventsForTests();
  const batches: unknown[][] = [];
  let rejectFirst: ((reason?: unknown) => void) | null = null;
  setPremiumFunnelTransportForTests((events) => {
    batches.push(events.map((event) => ({ ...event })));
    if (batches.length === 1) {
      return new Promise<void>((_resolve, reject) => {
        rejectFirst = reject;
      });
    }
    return Promise.reject(new Error("의도한 반복 실패"));
  });

  for (let index = 0; index < 105; index += 1) {
    assert.equal(recordPremiumFunnelEvent({ event: "subscription_view", source: "direct" }), true);
  }
  assert.equal(readPremiumFunnelEvents().length, 100);
  assert.ok(batches.every((batch) => batch.length <= 20));

  rejectFirst?.(new Error("의도한 실패"));
  await flushPremiumFunnelEventsForTests();
  assert.equal(readPremiumFunnelEvents().length, 100);

  setPremiumFunnelTransportForTests(async (events) => {
    batches.push(events.map((event) => ({ ...event })));
  });
  assert.equal(recordPremiumFunnelEvent({ event: "subscription_view", source: "direct" }), true);
  await flushPremiumFunnelEventsForTests();
  assert.ok(batches.every((batch) => batch.length <= 20));
  assert.deepEqual(readPremiumFunnelEvents(), []);
});

test("결제 오류는 원문 대신 허용된 결과와 코드로만 분류한다", () => {
  assert.deepEqual(classifyPremiumCheckoutFailure({ data: { code: "purchase_canceled" } }), {
    result: "cancel",
    error_code: "purchase_canceled",
  });
  assert.deepEqual(classifyPremiumCheckoutFailure({ code: "product_offer_unavailable" }), {
    result: "fail",
    error_code: "product_offer_unavailable",
  });
  assert.deepEqual(classifyPremiumCheckoutFailure(new TypeError("Failed to fetch https://secret.example")), {
    result: "fail",
    error_code: "network_error",
  });
  assert.deepEqual(classifyPremiumCheckoutFailure(new Error("카드사 원문 오류와 주문번호 ORDER-123")), {
    result: "fail",
    error_code: "unknown",
  });
});
