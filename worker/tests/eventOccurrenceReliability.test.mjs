import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  eventOccurrenceAlertId,
  eventReminderPushId,
} from "../lib/eventOccurrence.ts";
import { parentAlertPendingTtlMs } from "../lib/notificationRouting.ts";

test("같은 일정 id라도 날짜·revision이 바뀌면 도착과 리마인더 멱등키가 새로 생긴다", () => {
  const base = { eventId: "event-1", dateKey: "2026-6-13", updatedAt: "2026-07-13 01:00:00.000+00" };
  assert.notEqual(
    eventOccurrenceAlertId(base),
    eventOccurrenceAlertId({ ...base, updatedAt: "2026-07-13 02:00:00.000+00" }),
  );
  assert.notEqual(
    eventOccurrenceAlertId(base),
    eventOccurrenceAlertId({ ...base, dateKey: "2026-6-14" }),
  );
  assert.notEqual(
    eventReminderPushId(base, "15min"),
    eventReminderPushId({ ...base, updatedAt: "2026-07-13 02:00:00.000+00" }, "15min"),
  );
});

test("네이티브 오늘 일정 응답은 occurrence와 revision key를 함께 제공한다", () => {
  const rpc = readFileSync(new URL("../routes/rest-shim-rpc.ts", import.meta.url), "utf8");
  assert.match(rpc, /event_occurrence_id/);
  assert.match(rpc, /event_revision_key/);
});

test("부모 일정 pending은 원본 eventId로 편집·삭제 cleanup에 연결되고 종류별 TTL을 쓴다", () => {
  const route = readFileSync(new URL("../routes/parent-alerts.ts", import.meta.url), "utf8");
  assert.match(route, /sourceEventId/);
  assert.match(route, /eventId: args\.sourceEventId/);
  assert.match(route, /parentAlertPendingTtlMs\(args\.alertType\)/);
  assert.equal(parentAlertPendingTtlMs("not_arrived"), 30 * 60_000);
  assert.equal(parentAlertPendingTtlMs("arrived"), 2 * 60 * 60_000);
});

test("등록장소 도착·출발 pending은 사건 뒤 30분까지만 복구한다", () => {
  assert.equal(parentAlertPendingTtlMs("place_arrived"), 30 * 60_000);
  assert.equal(parentAlertPendingTtlMs("place_left"), 30 * 60_000);
});

test("위험구역·긴급 알림 pending은 오래된 사건을 현재 경보처럼 재생하지 않는다", () => {
  assert.equal(parentAlertPendingTtlMs("danger_zone"), 15 * 60_000);
  assert.equal(parentAlertPendingTtlMs("danger_enter"), 15 * 60_000);
  assert.equal(parentAlertPendingTtlMs("danger_entry"), 15 * 60_000);
  assert.equal(parentAlertPendingTtlMs("danger_exit"), 2 * 60 * 60_000);
  assert.equal(parentAlertPendingTtlMs("sos"), 5 * 60_000);
  assert.equal(parentAlertPendingTtlMs("emergency"), 5 * 60_000);
  assert.equal(parentAlertPendingTtlMs("sos_followup"), 5 * 60_000);
  assert.equal(parentAlertPendingTtlMs("", "kkuk"), 5 * 60_000);
  assert.equal(parentAlertPendingTtlMs("", "sos"), 5 * 60_000);
  assert.equal(parentAlertPendingTtlMs("", "emergency"), 5 * 60_000);
});
