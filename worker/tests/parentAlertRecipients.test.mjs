import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

import * as parentAlertRecipients from "../lib/parentAlertRecipients.ts";

const { isParentAlertRecipientEnabled } = parentAlertRecipients;

class D1StatementAdapter {
  constructor(sqlite, sql, bindings = []) {
    this.sqlite = sqlite;
    this.sql = sql;
    this.bindings = bindings;
  }

  bind(...bindings) {
    return new D1StatementAdapter(this.sqlite, this.sql, bindings);
  }

  async all() {
    return { results: this.sqlite.prepare(this.sql).all(...this.bindings) };
  }
}

function createRecipientDb() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`
    CREATE TABLE families(
      time_zone TEXT NOT NULL DEFAULT 'Asia/Seoul',id TEXT PRIMARY KEY, parent_id TEXT);
    CREATE TABLE family_members(
      id TEXT PRIMARY KEY,
      family_id TEXT NOT NULL,
      user_id TEXT,
      role TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE notification_settings(
      family_id TEXT,
      time_zone TEXT DEFAULT 'Asia/Seoul',
      user_id TEXT PRIMARY KEY,
      registered_place_enabled INTEGER DEFAULT 1,
      location_enabled INTEGER DEFAULT 1,
      quiet_hours_enabled INTEGER NOT NULL DEFAULT 0,
      quiet_hours_start_minute INTEGER NOT NULL DEFAULT 1320,
      quiet_hours_end_minute INTEGER NOT NULL DEFAULT 420,
      quiet_hours_updated_at TEXT
    );
  `);
  let prepareCount = 0;
  const db = {
    prepare(sql) {
      prepareCount += 1;
      return new D1StatementAdapter(sqlite, sql);
    },
    get prepareCount() {
      return prepareCount;
    },
  };
  return { sqlite, db };
}

test("부모별 장소·위치 알림 설정을 해당 알림 종류에만 적용한다", () => {
  assert.equal(isParentAlertRecipientEnabled("place_arrived", {
    registered_place_enabled: 0,
    location_enabled: 1,
  }), false);
  assert.equal(isParentAlertRecipientEnabled("arrived", {
    registered_place_enabled: 1,
    location_enabled: 0,
  }), false);
  assert.equal(isParentAlertRecipientEnabled("not_arrived", {
    registered_place_enabled: 1,
    location_enabled: 0,
  }), true);
  assert.equal(isParentAlertRecipientEnabled("danger_enter", {
    registered_place_enabled: 0,
    location_enabled: 0,
  }), true);
  assert.equal(isParentAlertRecipientEnabled("danger_exit", {
    registered_place_enabled: 0,
    location_enabled: 0,
  }), true);
  assert.equal(isParentAlertRecipientEnabled("low_battery", {
    registered_place_enabled: 0,
    location_enabled: 0,
  }), true);
});

test("설정 행이 없거나 값이 null이면 기존 기본값인 활성 상태를 유지한다", () => {
  assert.equal(isParentAlertRecipientEnabled("place_left", null), true);
  assert.equal(isParentAlertRecipientEnabled("arrived", {
    registered_place_enabled: null,
    location_enabled: null,
  }), true);
});

test("일반 장소 알림은 공동부모별 quiet 설정을 적용해 허용·억제 수신자를 나눈다", async () => {
  assert.equal(
    typeof parentAlertRecipients.loadParentAlertRecipients,
    "function",
    "부모 알림 수신자 분할 helper가 필요합니다",
  );
  const { sqlite, db } = createRecipientDb();
  sqlite.prepare("INSERT INTO families(id,parent_id) VALUES (?,?)").run("family-1", "parent-a");
  sqlite.prepare("INSERT INTO family_members VALUES (?,?,?,?,?)")
    .run("parent-a-member", "family-1", "parent-a", "parent", 1);
  sqlite.prepare("INSERT INTO family_members VALUES (?,?,?,?,?)")
    .run("parent-b-member", "family-1", "parent-b", "parent", 1);
  sqlite.prepare(
    `INSERT INTO notification_settings
       (user_id, registered_place_enabled, location_enabled, quiet_hours_enabled,
        quiet_hours_start_minute, quiet_hours_end_minute)
     VALUES (?,?,?,?,?,?)`,
  ).run("parent-a", 1, 1, 1, 1320, 420);
  sqlite.prepare(
    `INSERT INTO notification_settings
       (user_id, registered_place_enabled, location_enabled, quiet_hours_enabled,
        quiet_hours_start_minute, quiet_hours_end_minute)
     VALUES (?,?,?,?,?,?)`,
  ).run("parent-b", 1, 1, 0, 1320, 420);

  const atMs = Date.parse("2026-07-18T13:30:00.000Z");
  const result = await parentAlertRecipients.loadParentAlertRecipients(
    db,
    "family-1",
    "place_arrived",
    atMs,
  );

  assert.deepEqual(result.allowed, new Set(["parent-b"]));
  assert.deepEqual(result.suppressed, new Set(["parent-a"]));
  assert.equal(db.prepareCount, 2, "기존 알림 설정과 quiet 설정을 각각 한 번만 읽어야 합니다");
  sqlite.close();
});

test("모든 부모가 quiet여도 빈 허용 집합과 전체 억제 집합을 성공 결과로 반환한다", async () => {
  assert.equal(typeof parentAlertRecipients.loadParentAlertRecipients, "function");
  const { sqlite, db } = createRecipientDb();
  sqlite.prepare("INSERT INTO families(id,parent_id) VALUES (?,?)").run("family-1", "parent-a");
  sqlite.prepare("INSERT INTO family_members VALUES (?,?,?,?,?)")
    .run("parent-a-member", "family-1", "parent-a", "parent", 1);
  sqlite.prepare("INSERT INTO family_members VALUES (?,?,?,?,?)")
    .run("parent-b-member", "family-1", "parent-b", "parent", 1);
  for (const userId of ["parent-a", "parent-b"]) {
    sqlite.prepare(
      `INSERT INTO notification_settings
         (user_id, quiet_hours_enabled, quiet_hours_start_minute, quiet_hours_end_minute)
       VALUES (?,?,?,?)`,
    ).run(userId, 1, 1320, 420);
  }

  const result = await parentAlertRecipients.loadParentAlertRecipients(
    db,
    "family-1",
    "place_left",
    Date.parse("2026-07-18T13:30:00.000Z"),
  );
  assert.deepEqual(result.allowed, new Set());
  assert.deepEqual(result.suppressed, new Set(["parent-a", "parent-b"]));
  sqlite.close();
});

test("quiet 예외 안전 알림은 quiet 설정을 추가 조회하지 않고 모든 부모를 허용한다", async () => {
  assert.equal(typeof parentAlertRecipients.loadParentAlertRecipients, "function");
  const { sqlite, db } = createRecipientDb();
  sqlite.prepare("INSERT INTO families(id,parent_id) VALUES (?,?)").run("family-1", "parent-a");
  sqlite.prepare("INSERT INTO family_members VALUES (?,?,?,?,?)")
    .run("parent-b-member", "family-1", "parent-b", "parent", 1);
  for (const userId of ["parent-a", "parent-b"]) {
    sqlite.prepare(
      `INSERT INTO notification_settings
         (user_id, quiet_hours_enabled, quiet_hours_start_minute, quiet_hours_end_minute)
       VALUES (?,?,?,?)`,
    ).run(userId, 1, 1320, 420);
  }

  for (const alertType of ["not_arrived", "danger_exit"]) {
    const before = db.prepareCount;
    const result = await parentAlertRecipients.loadParentAlertRecipients(
      db,
      "family-1",
      alertType,
      Date.parse("2026-07-18T13:30:00.000Z"),
    );
    assert.deepEqual(result.allowed, new Set(["parent-a", "parent-b"]), alertType);
    assert.deepEqual(result.suppressed, new Set(), alertType);
    assert.equal(db.prepareCount - before, 1, `${alertType}는 quiet DB를 추가 조회하면 안 됩니다`);
  }
  sqlite.close();
});

test("일반 안전 알림의 quiet 설정 조회 오류는 허용으로 위장하지 않는다", async () => {
  assert.equal(typeof parentAlertRecipients.loadParentAlertRecipients, "function");
  let prepareCount = 0;
  const db = {
    prepare() {
      prepareCount += 1;
      if (prepareCount === 1) {
        return {
          bind() {
            return {
              async all() {
                return {
                  results: [{
                    user_id: "parent-a",
                    registered_place_enabled: 1,
                    location_enabled: 1,
                  }],
                };
              },
            };
          },
        };
      }
      throw new Error("injected quiet-hours DB failure");
    },
  };

  await assert.rejects(
    parentAlertRecipients.loadParentAlertRecipients(
      db,
      "family-1",
      "place_arrived",
      Date.parse("2026-07-18T13:30:00.000Z"),
    ),
    /injected quiet-hours DB failure/,
  );
});

test("pending 조회·ACK는 다른 가족 구성원의 사용자·역할을 대리할 수 없다", () => {
  const source = [
    readFileSync(new URL("../routes/rest-shim-rpc.ts", import.meta.url), "utf8"),
    readFileSync(new URL("../lib/pendingNotificationDelivery.ts", import.meta.url), "utf8"),
  ].join("\n");
  assert.match(source, /caller\.sub !== userId/);
  assert.match(source, /role_mismatch/);
  assert.match(source, /\$\.targetUserId/);
  assert.match(source, /\$\.targetRole/);
});

test("기기 pending 조회는 오래된 일반 알림보다 긴급 알림을 먼저 반환한다", () => {
  const source = readFileSync(
    new URL("../lib/pendingNotificationDelivery.ts", import.meta.url),
    "utf8",
  );
  assert.match(source, /ORDER BY[\s\S]*json_extract\(data,'\$\.urgent'\)[\s\S]*DESC[\s\S]*created_at/);
});

test("부모 알림은 FCM보다 부모별 pending을 먼저 원자 배치한다", () => {
  const source = readFileSync(new URL("../routes/parent-alerts.ts", import.meta.url), "utf8");
  assert.match(source, /queueParentAlertPending/);
  assert.match(source, /INSERT OR IGNORE INTO pending_notifications/);
  assert.match(source, /targetUserId: parentUserId/);
  assert.match(source, /pending_queue_failed/);
});

test("부모 알림 멱등 claim은 설정이 다른 공동부모를 막지 않도록 수신자별로 잡는다", () => {
  const source = readFileSync(new URL("../routes/push-notify.ts", import.meta.url), "utf8");
  const instant = source.slice(
    source.indexOf("export async function handleInstantNotification"),
    source.indexOf("// ── cron notification"),
  );
  const queueIndex = instant.indexOf("prequeuedParentPending");
  const recipientClaimIndex = instant.indexOf("parentAlertRecipientClaimKey");

  assert.ok(queueIndex >= 0 && recipientClaimIndex > queueIndex, "pending 보장 뒤 수신자별 claim이어야 합니다");
  assert.match(instant, /deliveryParentRecipientIds/);
  assert.match(instant, /parentAlertRecipientClaimKey\(pushId, parentUserId\)/);
  assert.match(instant, /claimParentRecipientDelivery/);
  assert.match(instant, /parentRecipientClaimInFlight/);
  assert.match(instant, /markParentRecipientDeliveryComplete/);
  assert.match(
    instant,
    /if \(effectiveParentRecipientIds\)[\s\S]*parentAlertRecipientClaimKey[\s\S]*const genericClaim = await claimGenericDelivery/,
  );
  assert.match(instant, /suppressedQuietHours/);
});

test("수신자 delivery claim은 전송 전 NULL 상태와 lease를 사용하고 성공 뒤에만 완료한다", () => {
  const source = readFileSync(new URL("../routes/push-notify.ts", import.meta.url), "utf8");
  assert.match(source, /PARENT_RECIPIENT_DELIVERY_CLAIM_LEASE_MS/);
  assert.match(source, /VALUES \(\?,\?,\?,NULL,\?\)/);
  assert.match(source, /first_sent_at IS NULL[\s\S]*created_at < \?/);
  assert.match(source, /leaseCreatedAt/);
  assert.match(source, /SET first_sent_at=\?, created_at=\?[\s\S]*first_sent_at IS NULL AND created_at=\?/);
  assert.match(source, /DELETE FROM push_idempotency[\s\S]*first_sent_at IS NULL AND created_at=\?/);
});
