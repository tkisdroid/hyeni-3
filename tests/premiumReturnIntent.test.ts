import test from "node:test";
import assert from "node:assert/strict";
import {
  clearPremiumReturnIntent,
  loadPremiumReturnIntent,
  savePremiumReturnIntent,
  type PremiumReturnIntentStorage,
} from "../src/transform/premiumReturnIntent.ts";

class MemoryStorage implements PremiumReturnIntentStorage {
  readonly values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
}

test("결제 복귀 정보는 같은 세션에서만 초안과 원래 경로를 보존한다", () => {
  const storage = new MemoryStorage();
  const now = Date.parse("2026-08-01T00:00:00.000Z");
  const saved = savePremiumReturnIntent(storage, {
    source: "saved_place",
    feature: "saved_places",
    returnTo: "/place-form",
    draft: { name: "피아노 학원", radiusM: 100 },
  }, now);
  assert.equal(saved, true);
  assert.deepEqual(loadPremiumReturnIntent(storage, now + 60_000), {
    version: 1,
    source: "saved_place",
    feature: "saved_places",
    returnTo: "/place-form",
    createdAt: now,
    draft: { name: "피아노 학원", radiusM: 100 },
  });

  clearPremiumReturnIntent(storage);
  assert.equal(loadPremiumReturnIntent(storage, now + 60_000), null);
});

test("AI 친구 Free 한도 업셀은 구독 뒤 AI 설정 화면 복귀 정보를 보존한다", () => {
  const storage = new MemoryStorage();
  const now = Date.parse("2026-08-02T00:00:00.000Z");

  assert.equal(savePremiumReturnIntent(storage, {
    source: "ai_friend_limit",
    feature: "ai_friend_daily_limit",
    returnTo: "/ai-credit",
  }, now), true);
  assert.deepEqual(loadPremiumReturnIntent(storage, now + 60_000), {
    version: 1,
    source: "ai_friend_limit",
    feature: "ai_friend_daily_limit",
    returnTo: "/ai-credit",
    createdAt: now,
  });
});

test("AI 일정 Free 한도 업셀은 구독 뒤 선택한 입력 탭 복귀 정보를 보존한다", () => {
  const storage = new MemoryStorage();
  const now = Date.parse("2026-08-02T00:00:00.000Z");

  assert.equal(savePremiumReturnIntent(storage, {
    source: "ai_schedule_limit",
    feature: "ai_schedule_daily_limit",
    returnTo: "/ai-schedule?tab=image",
  }, now), true);
  assert.deepEqual(loadPremiumReturnIntent(storage, now + 60_000), {
    version: 1,
    source: "ai_schedule_limit",
    feature: "ai_schedule_daily_limit",
    returnTo: "/ai-schedule?tab=image",
    createdAt: now,
  });
});

test("만료·외부 URL·과대 초안·손상 JSON은 복귀 정보로 사용하지 않는다", () => {
  const now = Date.parse("2026-08-01T00:00:00.000Z");
  const storage = new MemoryStorage();

  assert.equal(savePremiumReturnIntent(storage, {
    source: "saved_place",
    feature: "saved_places",
    returnTo: "https://attacker.invalid",
  }, now), false);

  assert.equal(savePremiumReturnIntent(storage, {
    source: "saved_place",
    feature: "saved_places",
    returnTo: "/place-form",
    draft: { value: "x".repeat(25_000) },
  }, now), false);

  assert.equal(savePremiumReturnIntent(storage, {
    source: "location_history",
    feature: "extended_history",
    returnTo: "/parent/location?view=history",
  }, now), true);
  assert.equal(loadPremiumReturnIntent(storage, now + 31 * 60_000), null);

  storage.setItem("hyeni:premium-return-intent:v1", "not-json");
  assert.equal(loadPremiumReturnIntent(storage, now), null);
});

test("복귀 정보는 결제 토큰·주문번호처럼 금지된 키를 저장하지 않는다", () => {
  const storage = new MemoryStorage();
  const now = Date.parse("2026-08-01T00:00:00.000Z");
  assert.equal(savePremiumReturnIntent(storage, {
    source: "location_request",
    feature: "realtime_location",
    returnTo: "/parent/location",
    draft: { purchaseToken: "secret", orderId: "order", childId: "member-1" },
  }, now), false);
  assert.equal(loadPremiumReturnIntent(storage, now), null);
});

test("과도하게 깊은 초안은 검사 우회를 허용하지 않고 저장을 거부한다", () => {
  const storage = new MemoryStorage();
  const now = Date.parse("2026-08-01T00:00:00.000Z");
  let draft: Record<string, unknown> = { purchaseToken: "secret" };
  for (let index = 0; index < 10; index += 1) {
    draft = { nested: draft };
  }

  assert.equal(savePremiumReturnIntent(storage, {
    source: "saved_place",
    feature: "saved_places",
    returnTo: "/place-form",
    draft,
  }, now), false);
  assert.equal(loadPremiumReturnIntent(storage, now), null);
});
