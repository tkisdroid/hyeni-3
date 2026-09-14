import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { readFamilyTimeZone, dayWindowAt, wallTimeToEpoch } from "../lib/timeZone.ts";
import { eventStartAtMs, scheduleWindowDateKeys } from "../lib/scheduleArrivalOverlap.ts";
import { isNotificationQuietAtMs, partitionNotificationRecipients } from "../lib/notificationQuietHours.ts";
import { prepareRegisteredPlaceAlertOccurrence } from "../lib/parentAlertOccurrence.ts";
import { resolveLocationHistoryReadWindow } from "../routes/location.ts";

function fixture() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("CREATE TABLE families(id TEXT PRIMARY KEY); CREATE TABLE notification_settings(user_id TEXT PRIMARY KEY, family_id TEXT, quiet_hours_enabled INTEGER, quiet_hours_start_minute INTEGER, quiet_hours_end_minute INTEGER, quiet_hours_updated_at TEXT); INSERT INTO families VALUES ('kr'); INSERT INTO notification_settings(user_id) VALUES ('legacy');");
  sqlite.exec(readFileSync(new URL("../db/global-family-time-zone.sql", import.meta.url), "utf8"));
  const db = { prepare(sql) { const make = bindings => ({
    bind: (...values) => make(values),
    first: async () => sqlite.prepare(sql).get(...bindings) ?? null,
    all: async () => ({ results: sqlite.prepare(sql).all(...bindings) }),
  }); return make([]); }};
  return { sqlite, db };
}

test("추가 migration은 기존 한국 가족과 수신자 기준을 보존하고 신규 수신자는 가족을 상속한다", async () => {
  const {sqlite, db} = fixture();
  try {
    assert.equal(await readFamilyTimeZone(db, "kr"), "Asia/Seoul");
    assert.equal(sqlite.prepare("SELECT time_zone FROM notification_settings WHERE user_id='legacy'").get().time_zone, "Asia/Seoul");
    sqlite.exec("INSERT INTO families VALUES ('la','America/Los_Angeles'); INSERT INTO notification_settings(user_id,family_id,quiet_hours_enabled,quiet_hours_start_minute,quiet_hours_end_minute) VALUES ('parent','la',1,1320,420)");
    assert.equal(await readFamilyTimeZone(db, "la"), "America/Los_Angeles");
    const result = await partitionNotificationRecipients(db, { userIds: ["parent"], identity: { action: "new_memo" }, atMs: Date.parse("2026-09-14T06:00Z") });
    assert.deepEqual([...result.suppressed], ["parent"]);
    await assert.rejects(() => readFamilyTimeZone(db, "missing"), /unavailable/);
  } finally { sqlite.close(); }
});

test("해외 일정 DST 중복을 두 사건으로 발송하지 않고 날짜 변경선도 조회한다", () => {
  const epoch = eventStartAtMs("2026-10-1", "01:30", "America/Los_Angeles");
  assert.equal(epoch, Date.parse("2026-11-01T08:30Z"));
  assert.equal(eventStartAtMs("2026-2-8", "02:30", "America/Los_Angeles"), Date.parse("2026-03-08T10:30Z"));
  assert.deepEqual(scheduleWindowDateKeys(Date.parse("2026-09-14T09:30Z"), 3600000, "Pacific/Kiritimati"), ["2026-8-14", "2026-8-15"]);
});

test("해외 위치 이력은 가족 08시 창만 열고 다른 지역의 창은 거부한다", () => {
  const now = Date.parse("2026-09-14T00:30Z"), zone = "America/Los_Angeles";
  const own = dayWindowAt(now, zone, 480), korea = dayWindowAt(now, "Asia/Seoul", 480);
  const iso = ms => new Date(ms).toISOString();
  assert.deepEqual(resolveLocationHistoryReadWindow("standard", iso(own.startMs), iso(own.endMs), now, zone), {startMs: own.startMs, endMs: now});
  assert.equal(resolveLocationHistoryReadWindow("standard", iso(korea.startMs), iso(korea.endMs), now, zone), null);
});

test("조용한 시간은 DST 반복 시간에도 적용하지만 안전 알림은 항상 통과한다", () => {
  const setting = { enabled: true, startMinute: 60, endMinute: 120, timeZone: "America/Los_Angeles", updatedAt: null };
  for (const at of ["2026-11-01T08:30Z","2026-11-01T09:30Z"]) {
    assert.equal(isNotificationQuietAtMs(setting, {action:"new_memo"}, Date.parse(at)), true);
    assert.equal(isNotificationQuietAtMs(setting, {action:"sos"}, Date.parse(at)), false);
  }
});

test("등록장소 사건 표시는 가족 현지 시각이며 TTL은 UTC 사건부터 30분이다", () => {
  const at = wallTimeToEpoch("2026-8-14", 519, "Asia/Kathmandu");
  const result = prepareRegisteredPlaceAlertOccurrence({alertType:"place_arrived",message:"학교 도착",timeZone:"Asia/Kathmandu",occurredAt:at,nowMs:at+60000});
  assert.match(result.message, /^오전 8:39/);
  assert.equal(Date.parse(result.expiresAt)-at,1800000);
});
