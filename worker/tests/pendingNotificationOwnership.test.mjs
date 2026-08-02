import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";

let pendingDelivery = {};
try {
  pendingDelivery = await import("../lib/pendingNotificationDelivery.ts");
} catch (error) {
  if (error?.code !== "ERR_MODULE_NOT_FOUND") throw error;
}

class D1StatementAdapter {
  constructor(db, sql, bindings = []) {
    this.db = db;
    this.sql = sql;
    this.bindings = bindings;
  }

  bind(...bindings) {
    return new D1StatementAdapter(this.db, this.sql, bindings);
  }

  async first() {
    return this.db.prepare(this.sql).get(...this.bindings) ?? null;
  }

  async all() {
    return { results: this.db.prepare(this.sql).all(...this.bindings) };
  }

  async run() {
    const result = this.db.prepare(this.sql).run(...this.bindings);
    return { meta: { changes: Number(result.changes) } };
  }
}

function createDb() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`
    CREATE TABLE families(
      id TEXT PRIMARY KEY,
      parent_id TEXT NOT NULL
    );
    CREATE TABLE family_members(
      id TEXT PRIMARY KEY,
      family_id TEXT NOT NULL,
      user_id TEXT,
      role TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE pending_notifications(
      id TEXT PRIMARY KEY,
      family_id TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      data TEXT DEFAULT '{}',
      delivered INTEGER DEFAULT 0,
      delivered_at TEXT,
      delivery_status TEXT,
      expires_at TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE notification_settings(
      user_id TEXT PRIMARY KEY,
      quiet_hours_enabled INTEGER NOT NULL DEFAULT 0,
      quiet_hours_start_minute INTEGER NOT NULL DEFAULT 1320,
      quiet_hours_end_minute INTEGER NOT NULL DEFAULT 420,
      quiet_hours_updated_at TEXT
    );
  `);
  const db = {
    prepare: (sql) => new D1StatementAdapter(sqlite, sql),
    batch: async (statements) => {
      sqlite.exec("BEGIN");
      try {
        const results = [];
        for (const statement of statements) results.push(await statement.run());
        sqlite.exec("COMMIT");
        return results;
      } catch (error) {
        sqlite.exec("ROLLBACK");
        throw error;
      }
    },
  };
  return { sqlite, db };
}

function requireHelpers() {
  assert.equal(
    typeof pendingDelivery.loadPendingNotificationsForRecipient,
    "function",
    "pending 조회 helper가 구현되어야 합니다",
  );
  assert.equal(
    typeof pendingDelivery.markPendingNotificationsDeliveredForCaller,
    "function",
    "pending ACK helper가 구현되어야 합니다",
  );
  assert.equal(
    typeof pendingDelivery.loadActiveFamilyNotificationRecipientIds,
    "function",
    "가족 공통 알림을 사용자별 pending으로 분리할 활성 수신자 helper가 필요합니다",
  );
  return pendingDelivery;
}

test("가족 공통 알림 수신자는 주보호자와 활성 구성원별로 확정되고 발신자·비활성 구성원은 제외된다", async () => {
  const { sqlite, db } = createDb();
  sqlite.prepare("INSERT INTO families VALUES (?,?)").run("family-1", "owner-1");
  sqlite.prepare("INSERT INTO family_members VALUES (?,?,?,?,?)")
    .run("owner-member", "family-1", "owner-1", "parent", 1);
  sqlite.prepare("INSERT INTO family_members VALUES (?,?,?,?,?)")
    .run("co-parent", "family-1", "parent-2", "parent", 1);
  sqlite.prepare("INSERT INTO family_members VALUES (?,?,?,?,?)")
    .run("child-active", "family-1", "child-1", "child", 1);
  sqlite.prepare("INSERT INTO family_members VALUES (?,?,?,?,?)")
    .run("child-inactive", "family-1", "child-old", "child", 0);

  const recipients = await requireHelpers().loadActiveFamilyNotificationRecipientIds(db, {
    familyId: "family-1",
    senderUserId: "parent-2",
  });
  assert.deepEqual(recipients, ["child-1", "owner-1"]);
});

test("targetUserId 없는 가족 pending은 일반 사용자가 조회하거나 선점 ACK할 수 없다", async () => {
  const { sqlite, db } = createDb();
  sqlite.prepare("INSERT INTO families VALUES (?,?)").run("family-1", "owner-1");
  sqlite.prepare("INSERT INTO family_members VALUES (?,?,?,?,?)")
    .run("co-parent", "family-1", "parent-2", "parent", 1);
  sqlite.prepare(`
    INSERT INTO pending_notifications
      (id, family_id, title, body, data, delivered, expires_at, created_at)
    VALUES (?,?,?,?,?,0,?,?)
  `).run(
    "legacy-family-pending",
    "family-1",
    "가족 일정",
    "새 일정이 등록됐어요.",
    JSON.stringify({ targetRole: "parent" }),
    "2026-07-15 00:00:00+00",
    "2026-07-14 00:00:00+00",
  );

  const helpers = requireHelpers();
  for (const userId of ["owner-1", "parent-2"]) {
    const rows = await helpers.loadPendingNotificationsForRecipient(db, {
      familyId: "family-1",
      userId,
      requestedRole: "parent",
      now: "2026-07-14 01:00:00",
    });
    assert.deepEqual(rows, []);

    const changed = await helpers.markPendingNotificationsDeliveredForCaller(db, {
      ids: ["legacy-family-pending"],
      callerUserId: userId,
      familyIds: ["family-1"],
      serviceRole: false,
      deliveredAt: "2026-07-14 01:00:01+00",
    });
    assert.equal(changed, 0);
  }
  assert.equal(
    sqlite.prepare("SELECT delivered FROM pending_notifications WHERE id=?")
      .get("legacy-family-pending").delivered,
    0,
  );

  const serviceChanged = await helpers.markPendingNotificationsDeliveredForCaller(db, {
    ids: ["legacy-family-pending"],
    callerUserId: null,
    familyIds: [],
    serviceRole: true,
    deliveredAt: "2026-07-14 01:00:02+00",
  });
  assert.equal(serviceChanged, 1);
});

test("membership 행이 없는 주보호자도 parent 대상 pending을 조회하고 ACK한다", async () => {
  const { sqlite, db } = createDb();
  sqlite.prepare("INSERT INTO families VALUES (?,?)").run("family-1", "owner-1");
  sqlite.prepare(`
    INSERT INTO pending_notifications
      (id, family_id, title, body, data, delivered, expires_at, created_at)
    VALUES (?,?,?,?,?,0,?,?)
  `).run(
    "pending-owner",
    "family-1",
    "위험 장소 진입",
    "위험 장소에 들어갔어요.",
    JSON.stringify({ targetRole: "parent", targetUserId: "owner-1", urgent: true }),
    "2026-07-15 00:00:00+00",
    "2026-07-14 00:00:00+00",
  );

  const helpers = requireHelpers();
  const rows = await helpers.loadPendingNotificationsForRecipient(db, {
    familyId: "family-1",
    userId: "owner-1",
    requestedRole: "parent",
    now: "2026-07-14 01:00:00",
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, "pending-owner");

  const changed = await helpers.markPendingNotificationsDeliveredForCaller(db, {
    ids: ["pending-owner"],
    callerUserId: "owner-1",
    familyIds: ["family-1"],
    serviceRole: false,
    deliveredAt: "2026-07-14 01:00:01+00",
  });
  assert.equal(changed, 1);
  assert.deepEqual(
    {
      ...sqlite.prepare("SELECT delivered, delivered_at FROM pending_notifications WHERE id=?")
        .get("pending-owner"),
    },
    { delivered: 1, delivered_at: "2026-07-14 01:00:01+00" },
  );

  const afterAck = await helpers.loadPendingNotificationsForRecipient(db, {
    familyId: "family-1",
    userId: "owner-1",
    requestedRole: "parent",
    now: "2026-07-14 01:00:02",
  });
  assert.deepEqual(afterAck, []);
});

test("비활성 자녀는 과거 pending을 조회하거나 ACK할 수 없다", async () => {
  const { sqlite, db } = createDb();
  sqlite.prepare("INSERT INTO families VALUES (?,?)").run("family-1", "owner-1");
  sqlite.prepare("INSERT INTO family_members VALUES (?,?,?,?,?)")
    .run("child-member", "family-1", "child-old", "child", 0);
  sqlite.prepare(`
    INSERT INTO pending_notifications
      (id, family_id, title, body, data, delivered, expires_at, created_at)
    VALUES (?,?,?,?,?,0,?,?)
  `).run(
    "pending-child",
    "family-1",
    "일정 알림",
    "곧 일정이 시작돼요.",
    JSON.stringify({ targetRole: "child", targetUserId: "child-old" }),
    "2026-07-15 00:00:00+00",
    "2026-07-14 00:00:00+00",
  );

  const helpers = requireHelpers();
  const rows = await helpers.loadPendingNotificationsForRecipient(db, {
    familyId: "family-1",
    userId: "child-old",
    requestedRole: "child",
    now: "2026-07-14 01:00:00",
  });
  assert.deepEqual(rows, []);

  const changed = await helpers.markPendingNotificationsDeliveredForCaller(db, {
    ids: ["pending-child"],
    callerUserId: "child-old",
    familyIds: ["family-1"],
    serviceRole: false,
    deliveredAt: "2026-07-14 01:00:01+00",
  });
  assert.equal(changed, 0);
  assert.equal(
    sqlite.prepare("SELECT delivered FROM pending_notifications WHERE id=?").get("pending-child").delivered,
    0,
  );
});

test("quiet 시간에 생성된 과거 일반 pending은 오전 조회에서 표시하지 않고 suppressed로 완료한다", async () => {
  const { sqlite, db } = createDb();
  sqlite.prepare("INSERT INTO families VALUES (?,?)").run("family-1", "owner-1");
  sqlite.prepare(
    `INSERT INTO notification_settings
       (user_id, quiet_hours_enabled, quiet_hours_start_minute, quiet_hours_end_minute)
     VALUES (?,?,?,?)`,
  ).run("owner-1", 1, 1320, 420);
  sqlite.prepare(`
    INSERT INTO pending_notifications
      (id, family_id, title, body, data, delivered, expires_at, created_at)
    VALUES (?,?,?,?,?,0,?,?)
  `).run(
    "pending-quiet-arrival",
    "family-1",
    "집 도착",
    "아이가 집에 도착했어요.",
    JSON.stringify({
      type: "parent_alert",
      action: "parent_alert",
      alertType: "place_arrived",
      targetRole: "parent",
      targetUserId: "owner-1",
    }),
    "2026-07-20 00:00:00+00",
    "2026-07-18 13:30:00+00",
  );

  const rows = await requireHelpers().loadPendingNotificationsForRecipient(db, {
    familyId: "family-1",
    userId: "owner-1",
    requestedRole: "parent",
    now: "2026-07-18 23:00:00",
  });
  assert.deepEqual(rows, []);

  const consumed = sqlite.prepare(
    "SELECT delivered, delivered_at, delivery_status FROM pending_notifications WHERE id=?",
  ).get("pending-quiet-arrival");
  assert.equal(consumed.delivered, 1);
  assert.equal(consumed.delivered_at, "2026-07-18 23:00:00");
  assert.deepEqual(JSON.parse(consumed.delivery_status), {
    suppressed: "quiet_hours",
    targetUserId: "owner-1",
  });
});

test("quiet 예외인 위험구역 이탈의 과거 pending은 quiet 중 생성됐어도 그대로 반환한다", async () => {
  const { sqlite, db } = createDb();
  sqlite.prepare("INSERT INTO families VALUES (?,?)").run("family-1", "owner-1");
  sqlite.prepare(
    `INSERT INTO notification_settings
       (user_id, quiet_hours_enabled, quiet_hours_start_minute, quiet_hours_end_minute)
     VALUES (?,?,?,?)`,
  ).run("owner-1", 1, 1320, 420);
  sqlite.prepare(`
    INSERT INTO pending_notifications
      (id, family_id, title, body, data, delivered, expires_at, created_at)
    VALUES (?,?,?,?,?,0,?,?)
  `).run(
    "pending-danger-exit",
    "family-1",
    "위험구역 이탈",
    "아이가 위험구역에서 벗어났어요.",
    JSON.stringify({
      type: "parent_alert",
      alert_type: "danger_exit",
      targetRole: "parent",
      targetUserId: "owner-1",
    }),
    "2026-07-20 00:00:00+00",
    "2026-07-18 13:30:00+00",
  );

  const rows = await requireHelpers().loadPendingNotificationsForRecipient(db, {
    familyId: "family-1",
    userId: "owner-1",
    requestedRole: "parent",
    now: "2026-07-18 23:00:00",
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, "pending-danger-exit");
  assert.equal(
    sqlite.prepare("SELECT delivered FROM pending_notifications WHERE id=?")
      .get("pending-danger-exit").delivered,
    0,
  );
});

test("혼합 pending의 quiet 설정 조회가 실패해도 bypass는 반환하고 일반 알림은 열지 않는다", async () => {
  const { sqlite, db } = createDb();
  sqlite.prepare("INSERT INTO families VALUES (?,?)").run("family-1", "owner-1");
  const insert = sqlite.prepare(`
    INSERT INTO pending_notifications
      (id, family_id, title, body, data, delivered, expires_at, created_at)
    VALUES (?,?,?,?,?,0,?,?)
  `);
  insert.run(
    "pending-normal",
    "family-1",
    "집 도착",
    "아이가 집에 도착했어요.",
    JSON.stringify({
      action: "parent_alert",
      alertType: "place_arrived",
      targetRole: "parent",
      targetUserId: "owner-1",
    }),
    "2026-07-20 00:00:00+00",
    "2026-07-18 13:30:00+00",
  );
  insert.run(
    "pending-bypass",
    "family-1",
    "위험구역 이탈",
    "아이가 위험구역에서 벗어났어요.",
    JSON.stringify({
      action: "parent_alert",
      alertType: "danger_exit",
      targetRole: "parent",
      targetUserId: "owner-1",
    }),
    "2026-07-20 00:00:00+00",
    "2026-07-18 13:31:00+00",
  );

  const failingQuietDb = {
    ...db,
    prepare(sql) {
      if (sql.includes("FROM notification_settings")) {
        return {
          bind() {
            return {
              async first() {
                throw new Error("injected quiet-hours DB failure");
              },
            };
          },
        };
      }
      return db.prepare(sql);
    },
  };

  const rows = await requireHelpers().loadPendingNotificationsForRecipient(failingQuietDb, {
    familyId: "family-1",
    userId: "owner-1",
    requestedRole: "parent",
    now: "2026-07-18 23:00:00",
  });

  assert.deepEqual(rows.map((row) => row.id), ["pending-bypass"]);
  assert.deepEqual(
    sqlite.prepare(
      "SELECT id, delivered FROM pending_notifications ORDER BY id",
    ).all().map((row) => ({ ...row })),
    [
      { id: "pending-bypass", delivered: 0 },
      { id: "pending-normal", delivered: 0 },
    ],
  );
});

test("일반 pending만 있을 때 quiet 설정 조회 실패는 계속 fail-closed한다", async () => {
  const { sqlite, db } = createDb();
  sqlite.prepare("INSERT INTO families VALUES (?,?)").run("family-1", "owner-1");
  sqlite.prepare(`
    INSERT INTO pending_notifications
      (id, family_id, title, body, data, delivered, expires_at, created_at)
    VALUES (?,?,?,?,?,0,?,?)
  `).run(
    "pending-normal-only",
    "family-1",
    "집 도착",
    "아이가 집에 도착했어요.",
    JSON.stringify({
      action: "parent_alert",
      alertType: "place_arrived",
      targetRole: "parent",
      targetUserId: "owner-1",
    }),
    "2026-07-20 00:00:00+00",
    "2026-07-18 13:30:00+00",
  );
  const failingQuietDb = {
    ...db,
    prepare(sql) {
      if (sql.includes("FROM notification_settings")) {
        return {
          bind() {
            return {
              async first() {
                throw new Error("injected quiet-hours DB failure");
              },
            };
          },
        };
      }
      return db.prepare(sql);
    },
  };

  await assert.rejects(
    requireHelpers().loadPendingNotificationsForRecipient(failingQuietDb, {
      familyId: "family-1",
      userId: "owner-1",
      requestedRole: "parent",
      now: "2026-07-18 23:00:00",
    }),
    /injected quiet-hours DB failure/,
  );
});

test("동일시각 quiet backlog를 bounded drain한 뒤 bypass와 허용 일반 알림으로 20개를 채운다", async () => {
  const { sqlite, db } = createDb();
  sqlite.prepare("INSERT INTO families VALUES (?,?)").run("family-1", "owner-1");
  sqlite.prepare(
    `INSERT INTO notification_settings
       (user_id, quiet_hours_enabled, quiet_hours_start_minute, quiet_hours_end_minute)
     VALUES (?,?,?,?)`,
  ).run("owner-1", 1, 1320, 420);
  const insert = sqlite.prepare(`
    INSERT INTO pending_notifications
      (id, family_id, title, body, data, delivered, expires_at, created_at)
    VALUES (?,?,?,?,?,0,?,?)
  `);
  for (let index = 0; index < 25; index += 1) {
    insert.run(
      `pending-quiet-${String(index).padStart(2, "0")}`,
      "family-1",
      "등록장소 도착",
      "아이가 등록장소에 도착했어요.",
      JSON.stringify({
        action: "parent_alert",
        alertType: "place_arrived",
        targetRole: "parent",
        targetUserId: "owner-1",
      }),
      "2026-07-20 00:00:00+00",
      "2026-07-18 13:30:00+00",
    );
  }
  insert.run(
    "pending-danger-exit",
    "family-1",
    "위험구역 이탈",
    "아이가 위험구역에서 벗어났어요.",
    JSON.stringify({
      action: "parent_alert",
      alertType: "danger_exit",
      targetRole: "parent",
      targetUserId: "owner-1",
    }),
    "2026-07-20 00:00:00+00",
    "2026-07-18 13:31:00+00",
  );
  for (let index = 0; index < 19; index += 1) {
    insert.run(
      `pending-allowed-${String(index).padStart(2, "0")}`,
      "family-1",
      "낮 시간 도착",
      "아이가 낮 시간에 도착했어요.",
      JSON.stringify({
        action: "parent_alert",
        alertType: "place_arrived",
        targetRole: "parent",
        targetUserId: "owner-1",
      }),
      "2026-07-20 00:00:00+00",
      "2026-07-18 22:00:00+00",
    );
  }

  const rows = await requireHelpers().loadPendingNotificationsForRecipient(db, {
    familyId: "family-1",
    userId: "owner-1",
    requestedRole: "parent",
    now: "2026-07-18 23:00:00",
  });

  assert.deepEqual(
    rows.map((row) => row.id),
    [
      "pending-danger-exit",
      ...Array.from(
        { length: 19 },
        (_, index) => `pending-allowed-${String(index).padStart(2, "0")}`,
      ),
    ],
  );
  assert.equal(rows.length, 20);
  assert.equal(
    sqlite.prepare(
      "SELECT COUNT(*) AS count FROM pending_notifications WHERE id LIKE 'pending-quiet-%' AND delivered=1",
    ).get().count,
    25,
  );
  assert.equal(
    sqlite.prepare(
      "SELECT COUNT(*) AS count FROM pending_notifications WHERE id LIKE 'pending-quiet-%' AND json_extract(delivery_status,'$.suppressed')='quiet_hours'",
    ).get().count,
    25,
  );
});
