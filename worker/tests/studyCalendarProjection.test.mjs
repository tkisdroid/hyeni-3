import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

const { getActiveChildProjection } = await import("../lib/studyCalendarProjection.ts");

class Statement {
  constructor(sqlite, sql, bindings = []) {
    this.sqlite = sqlite;
    this.sql = sql;
    this.bindings = bindings;
  }

  bind(...bindings) {
    return new Statement(this.sqlite, this.sql, bindings);
  }

  async first() {
    return this.sqlite.prepare(this.sql).get(...this.bindings) ?? null;
  }
}

class ProjectionDb {
  constructor(sqlite) {
    this.sqlite = sqlite;
  }

  prepare(sql) {
    return new Statement(this.sqlite, sql);
  }

  close() {
    this.sqlite.close();
  }
}

function createProjectionDb({ withStudyMarket = true } = {}) {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`
    CREATE TABLE families(
      id TEXT PRIMARY KEY,
      parent_id TEXT NOT NULL,
      service_country TEXT
      ${withStudyMarket ? ", study_market TEXT" : ""}
    );
    CREATE TABLE family_members(
      id TEXT PRIMARY KEY,
      family_id TEXT NOT NULL,
      user_id TEXT,
      role TEXT NOT NULL,
      name TEXT,
      photo_url TEXT,
      created_at TEXT,
      is_active INTEGER NOT NULL DEFAULT 1
    );
  `);
  if (withStudyMarket) {
    sqlite.prepare("INSERT INTO families(id,parent_id,service_country,study_market) VALUES (?,?,?,?),(?,?,?,?)")
      .run("family-a", "parent-a", "KR", "KR", "family-b", "parent-b", "KR", "KR");
  } else {
    sqlite.prepare("INSERT INTO families(id,parent_id,service_country) VALUES (?,?,?),(?,?,?)")
      .run("family-a", "parent-a", "KR", "family-b", "parent-b", "KR");
  }
  sqlite.prepare(
    `INSERT INTO family_members(id,family_id,user_id,role,name,photo_url,created_at,is_active)
     VALUES (?,?,?,?,?,?,?,?)`,
  ).run(
    "active-child",
    "family-a",
    "child-user-id",
    "child",
    "활성 아이",
    "family-a/uploads/active-child/private-photo-key.webp",
    null,
    1,
  );
  sqlite.prepare(
    `INSERT INTO family_members(id,family_id,user_id,role,name,photo_url,created_at,is_active)
     VALUES (?,?,?,?,?,?,?,?)`,
  ).run("inactive-child", "family-a", "inactive-user", "child", "비활성 아이", null, null, 0);
  sqlite.prepare(
    `INSERT INTO family_members(id,family_id,user_id,role,name,photo_url,created_at,is_active)
     VALUES (?,?,?,?,?,?,?,?)`,
  ).run("other-family-child", "family-b", "other-user", "child", "다른 가족 아이", null, null, 1);
  return new ProjectionDb(sqlite);
}

test("자녀 projection은 현재 KR인 exact family의 활성 member만 반환한다", async () => {
  const db = createProjectionDb();
  try {
    const active = await getActiveChildProjection(db, "family-a", "active-child");
    assert.equal(active.apiVersion, "2026-08-27");
    assert.equal(active.status, "active");
    assert.equal(active.memberId, "active-child");
    assert.equal(active.displayName, "활성 아이");
    assert.equal(active.hasAvatar, true);
    assert.match(active.revision, /^[A-Za-z0-9_-]{43}$/);
    assert.equal(JSON.stringify(active).includes("private-photo-key"), false);
    assert.equal("birthdate" in active, false);
    assert.equal("userId" in active, false);
    assert.equal("photoUrl" in active, false);

    assert.deepEqual(await getActiveChildProjection(db, "family-a", "inactive-child"), {
      apiVersion: "2026-08-27",
      status: "inactive_or_missing",
      memberId: "inactive-child",
    });
    assert.deepEqual(await getActiveChildProjection(db, "family-a", "other-family-child"), {
      apiVersion: "2026-08-27",
      status: "inactive_or_missing",
      memberId: "other-family-child",
    });

    db.sqlite.prepare("UPDATE families SET service_country='JP',study_market=NULL WHERE id='family-a'").run();
    assert.deepEqual(await getActiveChildProjection(db, "family-a", "active-child"), {
      apiVersion: "2026-08-27",
      status: "inactive_or_missing",
      memberId: "active-child",
    });
  } finally {
    db.close();
  }
});

test("projection revision은 null legacy created_at과 무관하게 표시값에 결정적이고 변경을 추적한다", async () => {
  const db = createProjectionDb();
  try {
    const first = await getActiveChildProjection(db, "family-a", "active-child");
    const same = await getActiveChildProjection(db, "family-a", "active-child");
    assert.equal(first.status, "active");
    assert.equal(same.status, "active");
    assert.equal(first.revision, same.revision);

    db.sqlite.prepare("UPDATE family_members SET name=? WHERE id='active-child'").run("이름 변경");
    const renamed = await getActiveChildProjection(db, "family-a", "active-child");
    assert.equal(renamed.status, "active");
    assert.notEqual(renamed.revision, first.revision);

    db.sqlite.prepare("UPDATE family_members SET photo_url=NULL WHERE id='active-child'").run();
    const withoutAvatar = await getActiveChildProjection(db, "family-a", "active-child");
    assert.equal(withoutAvatar.status, "active");
    assert.equal(withoutAvatar.hasAvatar, false);
    assert.notEqual(withoutAvatar.revision, renamed.revision);

    db.sqlite.prepare("UPDATE family_members SET photo_url=? WHERE id='active-child'")
      .run("family-a/uploads/active-child/a-different-private-key.webp");
    const restoredAvatar = await getActiveChildProjection(db, "family-a", "active-child");
    assert.equal(restoredAvatar.status, "active");
    assert.equal(restoredAvatar.hasAvatar, true);
    assert.equal(restoredAvatar.revision, renamed.revision);
    assert.equal(JSON.stringify(restoredAvatar).includes("a-different-private-key"), false);
  } finally {
    db.close();
  }
});

test("study_market migration보다 entrypoint가 먼저여도 fail-closed하고 migration 뒤 KR만 연다", async () => {
  const db = createProjectionDb({ withStudyMarket: false });
  try {
    assert.deepEqual(await getActiveChildProjection(db, "family-a", "active-child"), {
      apiVersion: "2026-08-27",
      status: "inactive_or_missing",
      memberId: "active-child",
    });

    db.sqlite.exec("ALTER TABLE families ADD COLUMN study_market TEXT");
    db.sqlite.prepare("UPDATE families SET study_market='KR' WHERE id='family-a'").run();
    const afterMigration = await getActiveChildProjection(db, "family-a", "active-child");
    assert.equal(afterMigration.status, "active");
    assert.equal(afterMigration.memberId, "active-child");
    assert.match(afterMigration.revision, /^[A-Za-z0-9_-]{43}$/);
  } finally {
    db.close();
  }
});
