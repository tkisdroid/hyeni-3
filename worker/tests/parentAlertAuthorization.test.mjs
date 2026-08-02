import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";

let authorization = {};
try {
  authorization = await import("../lib/parentAlertAuthorization.ts");
} catch (error) {
  if (error?.code !== "ERR_MODULE_NOT_FOUND") throw error;
}

class Statement {
  constructor(db, sql, bindings = []) { this.db = db; this.sql = sql; this.bindings = bindings; }
  bind(...bindings) { return new Statement(this.db, this.sql, bindings); }
  async first() { return this.db.prepare(this.sql).get(...this.bindings) ?? null; }
  async all() { return { results: this.db.prepare(this.sql).all(...this.bindings) }; }
}

function createDb() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`
    CREATE TABLE families(id TEXT PRIMARY KEY, parent_id TEXT NOT NULL);
    CREATE TABLE family_members(
      id TEXT PRIMARY KEY, family_id TEXT NOT NULL, user_id TEXT,
      role TEXT NOT NULL, is_active INTEGER NOT NULL DEFAULT 1
    );
  `);
  sqlite.prepare("INSERT INTO families VALUES (?,?)").run("family-a", "parent-a");
  sqlite.prepare("INSERT INTO family_members VALUES (?,?,?,?,?)").run("parent-member", "family-a", "parent-a", "parent", 1);
  sqlite.prepare("INSERT INTO family_members VALUES (?,?,?,?,?)").run("child-a", "family-a", "child-a", "child", 1);
  sqlite.prepare("INSERT INTO family_members VALUES (?,?,?,?,?)").run("child-b", "family-a", "child-b", "child", 1);
  sqlite.prepare("INSERT INTO family_members VALUES (?,?,?,?,?)").run("child-old", "family-a", "child-old", "child", 0);
  return { prepare: (sql) => new Statement(sqlite, sql) };
}

function api() {
  assert.equal(typeof authorization.canReadParentAlerts, "function", "부모 알림 read 역할 가드가 필요합니다");
  assert.equal(typeof authorization.resolveParentAlertWriteScope, "function", "부모 알림 write 범위 가드가 필요합니다");
  return authorization;
}

test("부모만 부모 알림 목록과 읽음 상태를 다룬다", async () => {
  const db = createDb();
  assert.equal(await api().canReadParentAlerts(db, "parent-a", "family-a"), true);
  assert.equal(await api().canReadParentAlerts(db, "child-a", "family-a"), false);
  assert.equal(await api().canReadParentAlerts(db, "child-old", "family-a"), false);
});

test("아이는 자기 ID로 허용된 안전 알림만 만들 수 있다", async () => {
  const db = createDb();
  assert.deepEqual(await api().resolveParentAlertWriteScope(db, {
    callerUserId: "child-a", familyId: "family-a", alertType: "sos", requestedChildUserId: "child-a",
  }), { callerRole: "child", childUserId: "child-a" });
  assert.equal(await api().resolveParentAlertWriteScope(db, {
    callerUserId: "child-a", familyId: "family-a", alertType: "sos", requestedChildUserId: "child-b",
  }), null);
  assert.equal(await api().resolveParentAlertWriteScope(db, {
    callerUserId: "child-a", familyId: "family-a", alertType: "arbitrary_type", requestedChildUserId: "child-a",
  }), null);

  for (const alertType of ["low_battery", "place_arrived", "place_left", "child_setting_request"]) {
    assert.deepEqual(await api().resolveParentAlertWriteScope(db, {
      callerUserId: "child-a", familyId: "family-a", alertType, requestedChildUserId: "child-a",
    }), { callerRole: "child", childUserId: "child-a" });
  }
});

test("교체된 옛 아이 기기는 SOS만 보낼 수 있고 일반 상태 알림은 만들지 못한다", async () => {
  const db = createDb();
  assert.deepEqual(await api().resolveParentAlertWriteScope(db, {
    callerUserId: "child-old", familyId: "family-a", alertType: "sos", requestedChildUserId: "child-old",
  }), { callerRole: "child", childUserId: "child-old" });
  for (const alertType of ["low_battery", "place_arrived", "place_left", "child_setting_request"]) {
    assert.equal(await api().resolveParentAlertWriteScope(db, {
      callerUserId: "child-old", familyId: "family-a", alertType, requestedChildUserId: "child-old",
    }), null);
  }
});

test("일정 도착·미도착과 위험장소 판정은 공개 사용자 POST가 아니라 Worker 내부 판정만 저장한다", async () => {
  const db = createDb();
  const serverDerivedTypes = [
    "arrived", "late_arrived", "not_arrived", "missed_arrival",
    "danger_zone", "danger_enter", "danger_entry", "danger_exit",
  ];
  for (const callerUserId of ["child-a", "parent-a"]) {
    for (const alertType of serverDerivedTypes) {
      assert.equal(await api().resolveParentAlertWriteScope(db, {
        callerUserId,
        familyId: "family-a",
        alertType,
        requestedChildUserId: "child-a",
      }), null, `${callerUserId}가 ${alertType}을 직접 기록하면 안 됩니다`);
    }
  }
});

test("부모가 지정하는 명시 허용 알림의 child user도 현재 가족의 활성 아이여야 한다", async () => {
  const db = createDb();
  assert.deepEqual(await api().resolveParentAlertWriteScope(db, {
    callerUserId: "parent-a", familyId: "family-a", alertType: "low_battery", requestedChildUserId: "child-b",
  }), { callerRole: "parent", childUserId: "child-b" });
  assert.equal(await api().resolveParentAlertWriteScope(db, {
    callerUserId: "parent-a", familyId: "family-a", alertType: "low_battery", requestedChildUserId: "child-old",
  }), null);
});
