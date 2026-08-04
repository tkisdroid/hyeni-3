import test from "node:test";
import assert from "node:assert/strict";
import {
  findNewSuccessfulArrival,
  markPremiumValueMomentOffered,
  premiumValueMomentStorageKey,
  wasPremiumValueMomentOffered,
  type PremiumValueAlert,
  type PremiumValueMomentStorage,
} from "../src/transform/premiumValueMoment.ts";

const alerts: PremiumValueAlert[] = [
  { id: "left", alert_type: "place_left" },
  { id: "late", alert_type: "late_arrived" },
  { id: "event", alert_type: "event_started_by_child" },
  { id: "arrival", alert_type: "place_arrived" },
];

test("첫 도착 가치 제안은 과거·출발·지연·일정 확인이 아닌 신규 실측 도착만 선택한다", () => {
  assert.equal(findNewSuccessfulArrival(alerts, new Set(["left", "late", "event"]))?.id, "arrival");
  assert.equal(findNewSuccessfulArrival(alerts, new Set(alerts.map((alert) => alert.id))), null);
});

test("legacy arrived도 성공 도착으로 인정하지만 식별자가 없으면 제안하지 않는다", () => {
  assert.equal(findNewSuccessfulArrival([{ id: "legacy", alert_type: "arrived" }], new Set())?.id, "legacy");
  assert.equal(findNewSuccessfulArrival([{ id: "", alert_type: "arrived" }], new Set()), null);
});

test("가치 순간 제안 기록은 가족별로 격리한다", () => {
  const values = new Map<string, string>();
  const storage: PremiumValueMomentStorage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };

  markPremiumValueMomentOffered(storage, "family:a");

  assert.equal(wasPremiumValueMomentOffered(storage, "family:a"), true);
  assert.equal(wasPremiumValueMomentOffered(storage, "family:b"), false);
  assert.notEqual(premiumValueMomentStorageKey("family:a"), premiumValueMomentStorageKey("family:b"));
});
