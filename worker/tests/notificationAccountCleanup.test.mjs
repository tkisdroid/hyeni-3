import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";

let accountCleanup = {};
try {
  accountCleanup = await import("../lib/accountNotificationCleanup.ts");
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

  async run() {
    const result = this.db.prepare(this.sql).run(...this.bindings);
    return { meta: { changes: Number(result.changes) } };
  }
}

test("공동부모 self 삭제는 본인의 모든 알림 수신 상태만 함께 제거한다", async () => {
  assert.equal(
    typeof accountCleanup.deleteUserNotificationStateStmts,
    "function",
    "계정 삭제용 알림 상태 cleanup helper가 구현되어야 합니다",
  );
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`
    CREATE TABLE fcm_tokens(id TEXT PRIMARY KEY, user_id TEXT, family_id TEXT);
    CREATE TABLE push_subscriptions(id TEXT PRIMARY KEY, user_id TEXT, family_id TEXT);
    CREATE TABLE notification_settings(
      user_id TEXT PRIMARY KEY,
      family_id TEXT,
      quiet_hours_updated_by TEXT
    );
    CREATE TABLE pending_notifications(id TEXT PRIMARY KEY, family_id TEXT, data TEXT);
  `);
  sqlite.prepare("INSERT INTO fcm_tokens VALUES (?,?,?)").run("fcm-self", "parent-self", "family-1");
  sqlite.prepare("INSERT INTO fcm_tokens VALUES (?,?,?)").run("fcm-other", "parent-other", "family-1");
  sqlite.prepare("INSERT INTO push_subscriptions VALUES (?,?,?)").run("web-self", "parent-self", "family-1");
  sqlite.prepare("INSERT INTO push_subscriptions VALUES (?,?,?)").run("web-other", "parent-other", "family-1");
  sqlite.prepare("INSERT INTO notification_settings VALUES (?,?,?)")
    .run("parent-self", "family-1", "parent-self");
  sqlite.prepare("INSERT INTO notification_settings VALUES (?,?,?)")
    .run("parent-other", "family-1", "parent-self");
  sqlite.prepare("INSERT INTO notification_settings VALUES (?,?,?)")
    .run("child-other", "family-1", "parent-self");
  sqlite.prepare("INSERT INTO notification_settings VALUES (?,?,?)")
    .run("unrelated-user", "family-2", "unrelated-parent");
  sqlite.prepare("INSERT INTO pending_notifications VALUES (?,?,?)")
    .run("pending-self", "family-1", JSON.stringify({ targetUserId: "parent-self" }));
  sqlite.prepare("INSERT INTO pending_notifications VALUES (?,?,?)")
    .run("pending-other", "family-1", JSON.stringify({ targetUserId: "parent-other" }));
  sqlite.prepare("INSERT INTO pending_notifications VALUES (?,?,?)")
    .run("pending-family", "family-1", JSON.stringify({ targetRole: "parent" }));
  sqlite.prepare("INSERT INTO pending_notifications VALUES (?,?,?)")
    .run("pending-invalid", "family-1", "legacy-invalid-json");

  const db = { prepare: (sql) => new D1StatementAdapter(sqlite, sql) };
  const statements = accountCleanup.deleteUserNotificationStateStmts(db, "parent-self");
  sqlite.exec("BEGIN");
  try {
    for (const statement of statements) await statement.run();
    sqlite.exec("COMMIT");
  } catch (error) {
    sqlite.exec("ROLLBACK");
    throw error;
  }

  assert.deepEqual(
    sqlite.prepare("SELECT id FROM fcm_tokens ORDER BY id").all().map((row) => ({ ...row })),
    [{ id: "fcm-other" }],
  );
  assert.deepEqual(
    sqlite.prepare("SELECT id FROM push_subscriptions ORDER BY id").all().map((row) => ({ ...row })),
    [{ id: "web-other" }],
  );
  assert.deepEqual(
    sqlite.prepare(
      "SELECT user_id,quiet_hours_updated_by FROM notification_settings ORDER BY user_id",
    ).all().map((row) => ({ ...row })),
    [
      { user_id: "child-other", quiet_hours_updated_by: null },
      { user_id: "parent-other", quiet_hours_updated_by: null },
      { user_id: "unrelated-user", quiet_hours_updated_by: "unrelated-parent" },
    ],
  );
  assert.deepEqual(
    sqlite.prepare("SELECT id FROM pending_notifications ORDER BY id").all().map((row) => ({ ...row })),
    [
      { id: "pending-family" },
      { id: "pending-invalid" },
      { id: "pending-other" },
    ],
  );
});
