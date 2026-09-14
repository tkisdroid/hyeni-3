import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

let settingsAccess = {};
try {
  settingsAccess = await import("../lib/notificationSettingsAccess.ts");
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
}

function createDb() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`
    CREATE TABLE families(
      time_zone TEXT NOT NULL DEFAULT 'Asia/Seoul',
      id TEXT PRIMARY KEY,
      parent_id TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE family_members(
      id TEXT PRIMARY KEY,
      family_id TEXT NOT NULL,
      user_id TEXT,
      role TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      last_selected_at TEXT
    );
    CREATE TABLE notification_settings(
      time_zone TEXT DEFAULT 'Asia/Seoul',
      user_id TEXT PRIMARY KEY,
      family_id TEXT,
      child_enabled INTEGER NOT NULL DEFAULT 1,
      quiet_hours_enabled INTEGER NOT NULL DEFAULT 0,
      quiet_hours_start_minute INTEGER NOT NULL DEFAULT 1320,
      quiet_hours_end_minute INTEGER NOT NULL DEFAULT 420,
      quiet_hours_updated_at TEXT
    );
  `);
  return {
    sqlite,
    db: { prepare: (sql) => new D1StatementAdapter(sqlite, sql) },
  };
}

test("알림 설정 저장 대상은 현재 JWT 사용자와 정확히 일치해야 한다", () => {
  assert.equal(typeof settingsAccess.validateExpectedSettingsUser, "function");
  assert.equal(settingsAccess.validateExpectedSettingsUser(undefined, "user-1"), "required");
  assert.equal(settingsAccess.validateExpectedSettingsUser("user-2", "user-1"), "mismatch");
  assert.equal(settingsAccess.validateExpectedSettingsUser("user-1", "user-1"), "ok");
});

test("주보호자는 같은 가족의 활성 자녀 child_enabled만 최소 필드로 읽는다", async () => {
  assert.equal(typeof settingsAccess.loadChildNotificationStatus, "function");
  const { sqlite, db } = createDb();
  sqlite.prepare("INSERT INTO families(id,parent_id) VALUES (?,?)").run("family-1", "owner-1");
  sqlite.prepare("INSERT INTO family_members(id,family_id,user_id,role,is_active) VALUES (?,?,?,?,?)")
    .run("child-1-member", "family-1", "child-1", "child", 1);
  sqlite.prepare("INSERT INTO family_members(id,family_id,user_id,role,is_active) VALUES (?,?,?,?,?)")
    .run("child-old-member", "family-1", "child-old", "child", 0);
  sqlite.prepare("INSERT INTO notification_settings(user_id,family_id,child_enabled) VALUES (?,?,?)")
    .run("child-1", "family-1", 0);

  assert.deepEqual(
    await settingsAccess.loadChildNotificationStatus(db, {
      callerUserId: "owner-1",
      familyId: "family-1",
      childUserId: "child-1",
    }),
    { user_id: "child-1", child_enabled: false, configured: true },
  );
  assert.equal(
    await settingsAccess.loadChildNotificationStatus(db, {
      callerUserId: "owner-1",
      familyId: "family-1",
      childUserId: "child-old",
    }),
    null,
  );
  assert.equal(
    await settingsAccess.loadChildNotificationStatus(db, {
      callerUserId: "stranger",
      familyId: "family-1",
      childUserId: "child-1",
    }),
    null,
  );
});

test("설정 행이 없는 활성 자녀는 서버 기본값 true를 명시한다", async () => {
  const { sqlite, db } = createDb();
  sqlite.prepare("INSERT INTO families(id,parent_id) VALUES (?,?)").run("family-1", "owner-1");
  sqlite.prepare("INSERT INTO family_members(id,family_id,user_id,role,is_active) VALUES (?,?,?,?,?)")
    .run("parent-member", "family-1", "co-parent", "parent", 1);
  sqlite.prepare("INSERT INTO family_members(id,family_id,user_id,role,is_active) VALUES (?,?,?,?,?)")
    .run("child-member", "family-1", "child-1", "child", 1);

  assert.deepEqual(
    await settingsAccess.loadChildNotificationStatus(db, {
      callerUserId: "co-parent",
      familyId: "family-1",
      childUserId: "child-1",
    }),
    { user_id: "child-1", child_enabled: true, configured: false },
  );
});

test("가족 quiet 조회는 호출 부모 본인과 같은 가족 활성 아이만 반환한다", async () => {
  assert.equal(typeof settingsAccess.loadFamilyQuietHoursRecipients, "function");
  const { sqlite, db } = createDb();
  sqlite.prepare("INSERT INTO families(id,parent_id) VALUES (?,?)").run("family-1", "owner-1");
  sqlite.prepare("INSERT INTO families(id,parent_id) VALUES (?,?)").run("family-2", "owner-2");
  const insertMember = sqlite.prepare(
    "INSERT INTO family_members(id,family_id,user_id,role,is_active) VALUES (?,?,?,?,?)",
  );
  insertMember.run("parent-member", "family-1", "co-parent", "parent", 1);
  insertMember.run("child-active-member", "family-1", "child-active", "child", 1);
  insertMember.run("child-inactive-member", "family-1", "child-inactive", "child", 0);
  insertMember.run("child-other-member", "family-2", "child-other", "child", 1);
  sqlite.prepare(
    `INSERT INTO notification_settings
      (user_id,family_id,quiet_hours_enabled,quiet_hours_start_minute,
       quiet_hours_end_minute,quiet_hours_updated_at)
     VALUES (?,?,?,?,?,?)`,
  ).run("child-active", "family-1", 1, 1320, 420, "2026-07-19T12:00:00.000Z");

  assert.deepEqual(
    await settingsAccess.loadFamilyQuietHoursRecipients(db, {
      callerUserId: "owner-1",
      familyId: "family-1",
    }),
    [
      {
        target_user_id: "owner-1",
        role: "parent",
        enabled: false,
        start_minute: 1320,
        end_minute: 420,
        updated_at: null,
        configured: false,
      time_zone: 'Asia/Seoul',
      },
      {
        target_user_id: "child-active",
        role: "child",
        enabled: true,
        start_minute: 1320,
        end_minute: 420,
        updated_at: "2026-07-19T12:00:00.000Z",
        configured: true,
      time_zone: 'Asia/Seoul',
      },
    ],
  );
  const coParentRecipients = await settingsAccess.loadFamilyQuietHoursRecipients(db, {
    callerUserId: "co-parent",
    familyId: "family-1",
  });
  assert.deepEqual(coParentRecipients?.map((row) => row.target_user_id), ["co-parent", "child-active"]);
  assert.equal(
    await settingsAccess.loadFamilyQuietHoursRecipients(db, {
      callerUserId: "child-active",
      familyId: "family-1",
    }),
    null,
  );
  assert.equal(
    await settingsAccess.loadFamilyQuietHoursRecipients(db, {
      callerUserId: "owner-1",
      familyId: "family-2",
    }),
    null,
  );
});

test("quiet 수정 대상은 부모 본인 또는 같은 가족 활성 아이만 허용한다", async () => {
  assert.equal(typeof settingsAccess.validateQuietHoursTarget, "function");
  const { sqlite, db } = createDb();
  sqlite.prepare("INSERT INTO families(id,parent_id) VALUES (?,?)").run("family-1", "owner-1");
  sqlite.prepare("INSERT INTO families(id,parent_id) VALUES (?,?)").run("family-2", "owner-2");
  const insertMember = sqlite.prepare(
    "INSERT INTO family_members(id,family_id,user_id,role,is_active) VALUES (?,?,?,?,?)",
  );
  insertMember.run("co-parent-member", "family-1", "co-parent", "parent", 1);
  insertMember.run("active-child-member", "family-1", "child-active", "child", 1);
  insertMember.run("inactive-child-member", "family-1", "child-inactive", "child", 0);
  insertMember.run("other-child-member", "family-2", "child-other", "child", 1);

  const validate = (callerUserId, targetUserId, familyId = "family-1") =>
    settingsAccess.validateQuietHoursTarget(db, { callerUserId, familyId, targetUserId });
  assert.equal(await validate("owner-1", "owner-1"), "self_parent");
  assert.equal(await validate("owner-1", "child-active"), "active_child");
  assert.equal(await validate("owner-1", "co-parent"), null);
  assert.equal(await validate("owner-1", "child-inactive"), null);
  assert.equal(await validate("owner-1", "child-other"), null);
  assert.equal(await validate("child-active", "child-active"), null);
  assert.equal(await validate("co-parent", "co-parent"), "self_parent");
});

test("quiet 수정 라우트는 세션 소유권과 lease 재검증 경계를 갖는다", () => {
  const route = readFileSync(new URL("../routes/notif-settings.ts", import.meta.url), "utf8");
  assert.match(route, /get\("\/family", requireAuth/);
  assert.match(route, /put\("\/quiet-hours", requireAuth/);
  assert.match(route, /expected_parent_user_id/);
  assert.match(route, /validateQuietHoursTarget/);
  assert.match(route, /acquireAccountMutationLeases/);
  assert.match(route, /releaseAccountMutationLeases/);
  const quietPut = route.slice(route.indexOf('put("/quiet-hours"'));
  assert.match(quietPut, /RETURNING\s+quiet_hours_enabled/);
  assert.ok(
    quietPut.match(/validateQuietHoursTarget/g)?.length >= 2,
    "저장 전과 비동기 command 전달 직전에 활성 대상을 다시 확인해야 합니다",
  );
  assert.doesNotMatch(route, /target_user_id\s*=\s*body\.target_user_id\s*\|\|\s*children\[0\]/);
});

test("기존 전체 저장 SQL은 quiet 컬럼을 갱신하지 않는다", () => {
  const route = readFileSync(new URL("../routes/notif-settings.ts", import.meta.url), "utf8");
  const selfPost = route.slice(route.indexOf('post("/"'), route.indexOf('put("/quiet-hours"'));
  assert.doesNotMatch(selfPost, /quiet_hours_(enabled|start_minute|end_minute)/);
});
