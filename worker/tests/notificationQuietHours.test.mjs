import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import {
  DEFAULT_NOTIFICATION_QUIET_HOURS,
  isNotificationQuietAtMs,
  isQuietHoursActive,
  isQuietHoursBypass,
  minuteOfDayInSeoul,
  partitionNotificationRecipients,
} from "../lib/notificationQuietHours.ts";

const bypassCases = [
  ["sos", ""], ["emergency", ""], ["parent_alert", "sos_followup"],
  ["parent_alert", "not_arrived"], ["parent_alert", "missed_arrival"],
  ["parent_alert", "danger_zone"], ["parent_alert", "danger_enter"],
  ["parent_alert", "danger_entry"], ["parent_alert", "danger_exit"],
  ["force_ring", ""], ["force_ring_stop", ""], ["force_ring_reminder", ""],
  ["remote_listen", ""], ["remote_listen_stop", ""],
  ["request_location", ""], ["request_device_status", ""],
];

const quietCases = [
  ["parent_alert", "arrived"], ["parent_alert", "place_arrived"],
  ["parent_alert", "place_left"], ["schedule_reminder", ""],
  ["new_memo", ""], ["sticker", ""], ["kkuk", ""],
  ["playdate_started", ""], ["ai_proactive", ""], ["teacher_notice", ""],
];

class D1StatementAdapter {
  constructor(owner, sql, bindings = []) {
    this.owner = owner;
    this.sql = sql;
    this.bindings = bindings;
  }

  bind(...bindings) {
    return new D1StatementAdapter(this.owner, this.sql, bindings);
  }

  async all() {
    return {
      success: true,
      results: this.owner.sqlite.prepare(this.sql).all(...this.bindings),
    };
  }
}

class SqliteD1Adapter {
  constructor() {
    this.sqlite = new DatabaseSync(":memory:");
    this.prepareCount = 0;
    this.sqlite.exec(`CREATE TABLE families (id TEXT PRIMARY KEY, time_zone TEXT DEFAULT 'Asia/Seoul');
    CREATE TABLE notification_settings (
      family_id TEXT,
      time_zone TEXT DEFAULT 'Asia/Seoul',
      user_id TEXT PRIMARY KEY,
      quiet_hours_enabled INTEGER NOT NULL DEFAULT 0,
      quiet_hours_start_minute INTEGER NOT NULL DEFAULT 1320,
      quiet_hours_end_minute INTEGER NOT NULL DEFAULT 420,
      quiet_hours_updated_by TEXT NULL,
      quiet_hours_updated_at TEXT NULL
    )`);
  }

  prepare(sql) {
    this.prepareCount += 1;
    return new D1StatementAdapter(this, sql);
  }

  close() {
    this.sqlite.close();
  }
}

test("기본 조용한 시간은 22시부터 7시까지 비활성 상태다", () => {
  assert.deepEqual(DEFAULT_NOTIFICATION_QUIET_HOURS, {
    enabled: false,
    startMinute: 1320,
    endMinute: 420,
    updatedAt: null,
  });
});

test("비활성 설정은 시간창 안에서도 quiet가 아니다", () => {
  const setting = { enabled: false, startMinute: 1320, endMinute: 420, updatedAt: null };
  assert.equal(isQuietHoursActive(setting, 1320), false);
});

test("13시부터 15시는 같은 날 시간창의 시작을 포함하고 종료를 제외한다", () => {
  const setting = { enabled: true, startMinute: 780, endMinute: 900, updatedAt: null };
  assert.equal(isQuietHoursActive(setting, 779), false);
  assert.equal(isQuietHoursActive(setting, 780), true);
  assert.equal(isQuietHoursActive(setting, 899), true);
  assert.equal(isQuietHoursActive(setting, 900), false);
});

test("22시부터 7시는 자정을 넘겨 적용된다", () => {
  const setting = { enabled: true, startMinute: 1320, endMinute: 420, updatedAt: null };
  assert.equal(isQuietHoursActive(setting, 1320), true);
  assert.equal(isQuietHoursActive(setting, 0), true);
  assert.equal(isQuietHoursActive(setting, 419), true);
  assert.equal(isQuietHoursActive(setting, 420), false);
});

test("같은 시작·종료와 범위를 벗어난 분은 quiet가 아니다", () => {
  const setting = { enabled: true, startMinute: 420, endMinute: 420, updatedAt: null };
  assert.equal(isQuietHoursActive(setting, 420), false);
  assert.equal(isQuietHoursActive(setting, -1), false);
  assert.equal(isQuietHoursActive(setting, 1440), false);
});

test("UTC 시각을 서울 기준 분으로 변환한다", () => {
  assert.equal(minuteOfDayInSeoul(Date.parse("2026-07-18T13:00:00.000Z")), 1320);
  assert.equal(minuteOfDayInSeoul(Date.parse("2026-07-18T22:00:00.000Z")), 420);
});

test("명시 예외만 quiet를 우회한다", () => {
  for (const [action, alertType] of bypassCases) {
    assert.equal(isQuietHoursBypass({ action, alertType }), true, `${action}/${alertType}`);
  }
  for (const [action, alertType] of quietCases) {
    assert.equal(isQuietHoursBypass({ action, alertType }), false, `${action}/${alertType}`);
  }
});

test("urgent 플래그는 명시 예외를 대신하지 않는다", () => {
  assert.equal(isQuietHoursBypass({ action: "new_memo", alertType: "", urgent: true }), false);
});

test("현재 서울 시각이 시간창 안이고 예외가 아닐 때만 quiet다", () => {
  const setting = { enabled: true, startMinute: 1320, endMinute: 420, updatedAt: null };
  const atMs = Date.parse("2026-07-18T13:00:00.000Z");
  assert.equal(isNotificationQuietAtMs(setting, { action: "new_memo" }, atMs), true);
  assert.equal(isNotificationQuietAtMs(setting, { action: "force_ring" }, atMs), false);
});

test("일반 알림 수신자를 한 번 조회해 quiet와 허용 대상으로 나눈다", async () => {
  const db = new SqliteD1Adapter();
  db.sqlite.prepare(
    `INSERT INTO notification_settings
       (user_id, quiet_hours_enabled, quiet_hours_start_minute, quiet_hours_end_minute)
     VALUES (?, ?, ?, ?)`,
  ).run("parent-quiet", 1, 1320, 420);
  db.sqlite.prepare(
    `INSERT INTO notification_settings
       (user_id, quiet_hours_enabled, quiet_hours_start_minute, quiet_hours_end_minute)
     VALUES (?, ?, ?, ?)`,
  ).run("parent-disabled", 0, 1320, 420);

  const result = await partitionNotificationRecipients(db, {
    userIds: ["parent-quiet", "parent-disabled", "parent-default"],
    identity: { action: "new_memo" },
    atMs: Date.parse("2026-07-18T13:30:00.000Z"),
  });

  assert.deepEqual(result.allowed, new Set(["parent-disabled", "parent-default"]));
  assert.deepEqual(result.suppressed, new Set(["parent-quiet"]));
  assert.equal(db.prepareCount, 1);
  db.close();
});

test("명시 예외는 DB를 읽지 않고 모든 수신자를 허용한다", async () => {
  const db = {
    prepare() {
      throw new Error("명시 예외에서 DB를 읽으면 안 됩니다");
    },
  };
  const result = await partitionNotificationRecipients(db, {
    userIds: ["parent-a", "parent-b"],
    identity: { action: "force_ring" },
    atMs: Date.parse("2026-07-18T13:30:00.000Z"),
  });
  assert.deepEqual(result.allowed, new Set(["parent-a", "parent-b"]));
  assert.deepEqual(result.suppressed, new Set());
});

test("설정 조회 실패는 허용으로 위장하지 않고 throw한다", async () => {
  const db = {
    prepare() {
      return {
        bind() {
          return {
            async all() {
              throw new Error("injected quiet-hours DB failure");
            },
          };
        },
      };
    },
  };
  await assert.rejects(
    partitionNotificationRecipients(db, {
      userIds: ["parent-a"],
      identity: { action: "new_memo" },
      atMs: Date.parse("2026-07-18T13:30:00.000Z"),
    }),
    /injected quiet-hours DB failure/,
  );
});
