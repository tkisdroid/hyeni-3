import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";

let memoAuthorization = {};
try {
  memoAuthorization = await import("../lib/memoAuthorization.ts");
} catch (error) {
  if (error?.code !== "ERR_MODULE_NOT_FOUND") throw error;
}

class Statement {
  constructor(db, sql, bindings = []) {
    this.db = db;
    this.sql = sql;
    this.bindings = bindings;
  }
  bind(...bindings) { return new Statement(this.db, this.sql, bindings); }
  async first() { return this.db.prepare(this.sql).get(...this.bindings) ?? null; }
}

function createDb() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`
    CREATE TABLE families(id TEXT PRIMARY KEY, parent_id TEXT NOT NULL);
    CREATE TABLE family_members(
      id TEXT PRIMARY KEY,
      family_id TEXT NOT NULL,
      user_id TEXT,
      role TEXT NOT NULL,
      name TEXT,
      is_active INTEGER NOT NULL DEFAULT 1
    );
  `);
  sqlite.prepare("INSERT INTO families VALUES (?,?)").run("family-a", "parent-a");
  sqlite.prepare("INSERT INTO families VALUES (?,?)").run("family-b", "parent-b");
  sqlite.prepare("INSERT INTO family_members VALUES (?,?,?,?,?,?)").run("parent-member", "family-a", "parent-a", "parent", "부모", 1);
  sqlite.prepare("INSERT INTO family_members VALUES (?,?,?,?,?,?)").run("child-member-a", "family-a", "child-a", "child", "혜니", 1);
  sqlite.prepare("INSERT INTO family_members VALUES (?,?,?,?,?,?)").run("child-member-b", "family-a", "child-b", "child", "동생", 1);
  sqlite.prepare("INSERT INTO family_members VALUES (?,?,?,?,?,?)").run("child-member-old", "family-a", "child-old", "child", "옛기기", 0);
  sqlite.prepare("INSERT INTO family_members VALUES (?,?,?,?,?,?)").run("other-child", "family-b", "other-child", "child", "다른아이", 1);
  return { prepare: (sql) => new Statement(sqlite, sql) };
}

function resolver() {
  assert.equal(typeof memoAuthorization.resolveMemoThreadScope, "function", "메모 스레드 권한 resolver가 필요합니다");
  return memoAuthorization.resolveMemoThreadScope;
}

test("부모는 같은 가족의 명시한 활성 아이 스레드만 연다", async () => {
  assert.deepEqual(await resolver()(createDb(), "parent-a", "family-a", "child-member-a"), {
    familyId: "family-a",
    childMemberId: "child-member-a",
    childUserId: "child-a",
    childName: "혜니",
    callerRole: "parent",
  });
});

test("아이 세션은 자기 스레드만 열고 형제 스레드는 거부한다", async () => {
  const db = createDb();
  assert.equal(await resolver()(db, "child-a", "family-a", "child-member-b"), null);
  assert.deepEqual(await resolver()(db, "child-a", "family-a", "child-member-a"), {
    familyId: "family-a",
    childMemberId: "child-member-a",
    childUserId: "child-a",
    childName: "혜니",
    callerRole: "child",
  });
});

test("child id 누락·타가족·비활성 대상은 모두 fail-closed 한다", async () => {
  const db = createDb();
  assert.equal(await resolver()(db, "parent-a", "family-a", ""), null);
  assert.equal(await resolver()(db, "parent-a", "family-a", "other-child"), null);
  assert.equal(await resolver()(db, "parent-a", "family-a", "child-member-old"), null);
});
