import test from "node:test";
import assert from "node:assert/strict";

let occurrence = {};
try {
  occurrence = await import("../lib/parentAlertOccurrence.ts");
} catch (error) {
  if (error?.code !== "ERR_MODULE_NOT_FOUND") throw error;
}

test("등록장소 알림은 표시 시각이 아니라 실제 episode 시각을 한국 시각 문구와 만료에 쓴다", () => {
  assert.equal(
    typeof occurrence.prepareRegisteredPlaceAlertOccurrence,
    "function",
    "등록장소 사건 시각 정규화 helper가 필요합니다",
  );

  const prepared = occurrence.prepareRegisteredPlaceAlertOccurrence({
    alertType: "place_arrived",
    message: "민서가 학교에 도착했어요.",
    occurredAt: "2026-08-30T23:39:05.000Z",
    nowMs: Date.parse("2026-08-31T00:00:00.000Z"),
  });

  assert.deepEqual(prepared, {
    message: "오전 8:39에 민서가 학교에 도착했어요.",
    occurredAt: "2026-08-30T23:39:05.000Z",
    expiresAt: "2026-08-31T00:09:05.000Z",
    expired: false,
  });
});

test("등록장소 사건 뒤 30분이 지나면 새 표시 대상으로 취급하지 않는다", () => {
  assert.equal(typeof occurrence.prepareRegisteredPlaceAlertOccurrence, "function");

  const prepared = occurrence.prepareRegisteredPlaceAlertOccurrence({
    alertType: "place_left",
    message: "민서가 학교에서 출발했어요.",
    occurredAt: "2026-08-30T23:39:05.000Z",
    nowMs: Date.parse("2026-08-31T00:09:06.000Z"),
  });

  assert.equal(prepared.message, "오전 8:39에 민서가 학교에서 출발했어요.");
  assert.equal(prepared.expiresAt, "2026-08-31T00:09:05.000Z");
  assert.equal(prepared.expired, true);
});

test("사건 시각이 없는 구버전 아이 앱은 서버 접수 시각으로 안전하게 보완한다", () => {
  assert.equal(typeof occurrence.prepareRegisteredPlaceAlertOccurrence, "function");

  const prepared = occurrence.prepareRegisteredPlaceAlertOccurrence({
    alertType: "place_arrived",
    message: "아이가 집에 도착했어요.",
    occurredAt: null,
    nowMs: Date.parse("2026-08-31T01:25:00.000Z"),
  });

  assert.deepEqual(prepared, {
    message: "오전 10:25에 아이가 집에 도착했어요.",
    occurredAt: "2026-08-31T01:25:00.000Z",
    expiresAt: "2026-08-31T01:55:00.000Z",
    expired: false,
  });
});

test("장소 출입이 아닌 알림 문구와 TTL은 건드리지 않는다", () => {
  assert.equal(typeof occurrence.prepareRegisteredPlaceAlertOccurrence, "function");

  assert.deepEqual(occurrence.prepareRegisteredPlaceAlertOccurrence({
    alertType: "danger_enter",
    message: "위험 구역에 들어갔어요.",
    occurredAt: "2026-08-30T23:39:05.000Z",
    nowMs: Date.parse("2026-08-31T00:00:00.000Z"),
  }), {
    message: "위험 구역에 들어갔어요.",
    occurredAt: null,
    expiresAt: null,
    expired: false,
  });
});
