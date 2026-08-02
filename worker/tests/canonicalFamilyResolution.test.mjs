import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";

let authz = {};
try {
  authz = await import("../db/authz.ts");
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
      parent_id TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE family_members(
      id TEXT PRIMARY KEY,
      family_id TEXT NOT NULL,
      user_id TEXT,
      role TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      last_selected_at TEXT
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

function requireResolver() {
  assert.equal(
    typeof authz.resolveCanonicalFamilyMembership,
    "function",
    "현재 가족 정본 resolver가 구현되어야 합니다",
  );
  return authz.resolveCanonicalFamilyMembership;
}

test("활성 membership은 더 최근에 만든 빈 소유 가족보다 우선한다", async () => {
  const { sqlite, db } = createDb();
  sqlite.prepare("INSERT INTO families VALUES (?,?,?)").run("legacy-empty", "parent-1", "2026-07-14 02:00:00");
  sqlite.prepare("INSERT INTO families VALUES (?,?,?)").run("current-family", "parent-1", "2026-07-13 01:00:00");
  sqlite.prepare("INSERT INTO family_members VALUES (?,?,?,?,?,?,?)")
    .run("parent-member", "current-family", "parent-1", "parent", 1, "2026-07-13 01:00:00", null);
  sqlite.prepare("INSERT INTO family_members VALUES (?,?,?,?,?,?,?)")
    .run("child-member", "current-family", "child-1", "child", 1, "2026-07-13 01:00:01", null);

  assert.deepEqual(await requireResolver()(db, "parent-1"), {
    familyId: "current-family",
    role: "parent",
  });
});

test("membership 없는 주보호자는 활성 구성원이 있는 가족을 빈 가족보다 우선한다", async () => {
  const { sqlite, db } = createDb();
  sqlite.prepare("INSERT INTO families VALUES (?,?,?)").run("active-family", "parent-1", "2026-07-12 01:00:00");
  sqlite.prepare("INSERT INTO families VALUES (?,?,?)").run("new-empty-family", "parent-1", "2026-07-14 01:00:00");
  sqlite.prepare("INSERT INTO family_members VALUES (?,?,?,?,?,?,?)")
    .run("child-member", "active-family", "child-1", "child", 1, "2026-07-12 01:00:01", null);

  assert.deepEqual(await requireResolver()(db, "parent-1"), {
    familyId: "active-family",
    role: "parent",
  });
});

test("비활성 자녀 membership은 현재 가족으로 되살리지 않는다", async () => {
  const { sqlite, db } = createDb();
  sqlite.prepare("INSERT INTO families VALUES (?,?,?)").run("old-family", "parent-1", "2026-07-12 01:00:00");
  sqlite.prepare("INSERT INTO family_members VALUES (?,?,?,?,?,?,?)")
    .run("old-child", "old-family", "child-1", "child", 0, "2026-07-12 01:00:01", null);

  assert.equal(await requireResolver()(db, "child-1"), null);
});

test("비활성·비가족 역할 membership은 모든 가족 API 권한 목록에서 제외한다", async () => {
  const { sqlite, db } = createDb();
  sqlite.prepare("INSERT INTO families VALUES (?,?,?)").run("family-1", "parent-1", "2026-07-12 01:00:00");
  sqlite.prepare("INSERT INTO family_members VALUES (?,?,?,?,?,?,?)")
    .run("inactive-child", "family-1", "old-child", "child", 0, "2026-07-12 01:00:00", null);
  sqlite.prepare("INSERT INTO family_members VALUES (?,?,?,?,?,?,?)")
    .run("teacher-member", "family-1", "teacher-1", "teacher", 1, "2026-07-12 01:00:00", null);
  sqlite.prepare("INSERT INTO family_members VALUES (?,?,?,?,?,?,?)")
    .run("active-child", "family-1", "child-1", "child", 1, "2026-07-12 01:00:00", null);

  assert.deepEqual(await authz.getMyFamilyIds(db, "old-child"), []);
  assert.equal(await authz.assertFamilyAccess(db, "old-child", "family-1"), false);
  assert.deepEqual(await authz.getMyFamilyIds(db, "teacher-1"), []);
  assert.equal(await authz.assertFamilyAccess(db, "teacher-1", "family-1"), false);
  assert.deepEqual(await authz.getMyFamilyIds(db, "child-1"), ["family-1"]);
  assert.deepEqual(await authz.getMyFamilyIds(db, "parent-1"), ["family-1"]);
  assert.equal(await authz.assertSafetyFamilyAccess(db, "old-child", "family-1"), true);
  assert.equal(await authz.assertSafetyFamilyAccess(db, "teacher-1", "family-1"), false);
});

test("고아 활성 membership은 무시하고 실제 존재하는 소유 가족을 선택한다", async () => {
  const { sqlite, db } = createDb();
  sqlite.prepare("INSERT INTO families VALUES (?,?,?)").run("real-family", "parent-1", "2026-07-12 01:00:00");
  sqlite.prepare("INSERT INTO family_members VALUES (?,?,?,?,?,?,?)")
    .run("orphan-member", "missing-family", "parent-1", "parent", 1, "2026-07-14 01:00:00", null);

  assert.deepEqual(await requireResolver()(db, "parent-1"), {
    familyId: "real-family",
    role: "parent",
  });
});

test("명시한 가족은 활성 소속 또는 주보호자 소유권을 검증해 세션 범위를 고정한다", async () => {
  const { sqlite, db } = createDb();
  sqlite.prepare("INSERT INTO families VALUES (?,?,?)").run("family-a", "parent-a", "2026-07-12 01:00:00");
  sqlite.prepare("INSERT INTO families VALUES (?,?,?)").run("family-b", "parent-b", "2026-07-14 01:00:00");
  sqlite.prepare("INSERT INTO family_members VALUES (?,?,?,?,?,?,?)")
    .run("child-a", "family-a", "child-1", "child", 1, "2026-07-12 01:00:00", null);
  sqlite.prepare("INSERT INTO family_members VALUES (?,?,?,?,?,?,?)")
    .run("child-b", "family-b", "child-1", "child", 1, "2026-07-14 01:00:00", null);

  assert.equal(
    typeof authz.resolveVerifiedFamilyMembership,
    "function",
    "페어링 직후 대상 가족을 검증해 고정하는 resolver가 필요합니다",
  );
  assert.deepEqual(await authz.resolveVerifiedFamilyMembership(db, "child-1", "family-a"), {
    familyId: "family-a",
    role: "child",
  });
  assert.equal(await authz.resolveVerifiedFamilyMembership(db, "child-1", "missing-family"), null);
});

test("최근 선택 표시는 생성 시각보다 우선하며 로그인·refresh에서도 같은 가족을 유지한다", async () => {
  const { sqlite, db } = createDb();
  sqlite.prepare("INSERT INTO families VALUES (?,?,?)").run("family-a", "parent-a", "2026-07-12 01:00:00");
  sqlite.prepare("INSERT INTO families VALUES (?,?,?)").run("family-b", "parent-b", "2026-07-14 01:00:00");
  sqlite.prepare("INSERT INTO family_members VALUES (?,?,?,?,?,?,?)")
    .run("child-a", "family-a", "child-1", "child", 1, "2026-07-12 01:00:00", null);
  sqlite.prepare("INSERT INTO family_members VALUES (?,?,?,?,?,?,?)")
    .run("child-b", "family-b", "child-1", "child", 1, "2026-07-14 01:00:00", null);

  assert.equal(typeof authz.markFamilySelection, "function", "현재 가족 선택을 저장하는 함수가 필요합니다");
  await authz.markFamilySelection(db, "child-1", "family-a", "2026-07-15T01:00:00.000Z");
  assert.deepEqual(await requireResolver()(db, "child-1"), {
    familyId: "family-a",
    role: "child",
  });
});

test("선택 표시가 아직 없으면 기존 refresh의 유효한 활성 가족을 초기 정본으로 보존한다", async () => {
  const { sqlite, db } = createDb();
  sqlite.prepare("INSERT INTO families VALUES (?,?,?)").run("family-a", "parent-a", "2026-07-12 01:00:00");
  sqlite.prepare("INSERT INTO families VALUES (?,?,?)").run("family-b", "parent-b", "2026-07-14 01:00:00");
  sqlite.prepare("INSERT INTO family_members VALUES (?,?,?,?,?,?,?)")
    .run("child-a", "family-a", "child-1", "child", 1, "2026-07-12 01:00:00", null);
  sqlite.prepare("INSERT INTO family_members VALUES (?,?,?,?,?,?,?)")
    .run("child-b", "family-b", "child-1", "parent", 1, "2026-07-14 01:00:00", null);

  assert.deepEqual(await requireResolver()(db, "child-1", "family-a"), {
    familyId: "family-a",
    role: "child",
  });
});

test("membership 없는 주보호자도 기존 refresh가 가리킨 소유 가족을 초기 정본으로 보존한다", async () => {
  const { sqlite, db } = createDb();
  sqlite.prepare("INSERT INTO families VALUES (?,?,?)").run("family-a", "parent-1", "2026-07-12 01:00:00");
  sqlite.prepare("INSERT INTO families VALUES (?,?,?)").run("family-b", "parent-1", "2026-07-14 01:00:00");

  assert.deepEqual(await requireResolver()(db, "parent-1", "family-a"), {
    familyId: "family-a",
    role: "parent",
  });
});

test("선택 표시가 없으면 preferred 소유 가족이 다른 가족의 child membership보다 우선한다", async () => {
  const { sqlite, db } = createDb();
  sqlite.prepare("INSERT INTO families VALUES (?,?,?)").run("owned-family", "user-1", "2026-07-12 01:00:00");
  sqlite.prepare("INSERT INTO families VALUES (?,?,?)").run("child-family", "other-parent", "2026-07-14 01:00:00");
  sqlite.prepare("INSERT INTO family_members VALUES (?,?,?,?,?,?,?)")
    .run("mixed-role", "child-family", "user-1", "child", 1, "2026-07-14 01:00:00", null);

  assert.deepEqual(await requireResolver()(db, "user-1", "owned-family"), {
    familyId: "owned-family",
    role: "parent",
  });
});

test("명시 선택은 늦게 도착한 과거 refresh snapshot보다 항상 우선한다", async () => {
  const { sqlite, db } = createDb();
  sqlite.prepare("INSERT INTO families VALUES (?,?,?)").run("family-a", "parent-a", "2026-07-12 01:00:00");
  sqlite.prepare("INSERT INTO families VALUES (?,?,?)").run("family-b", "parent-b", "2026-07-14 01:00:00");
  sqlite.prepare("INSERT INTO family_members VALUES (?,?,?,?,?,?,?)")
    .run("child-a", "family-a", "child-1", "child", 1, "2026-07-12 01:00:00", null);
  sqlite.prepare("INSERT INTO family_members VALUES (?,?,?,?,?,?,?)")
    .run("child-b", "family-b", "child-1", "child", 1, "2026-07-14 01:00:00", "2026-07-15T01:00:00.000Z");

  assert.deepEqual(await requireResolver()(db, "child-1", "family-a"), {
    familyId: "family-b",
    role: "child",
  });
});

test("명시 가족 전환은 선택 표시와 기존 live refresh snapshot을 한 batch로 갱신한다", async () => {
  const { sqlite, db } = createDb();
  sqlite.exec(`
    CREATE TABLE refresh_tokens(
      token TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      family_id TEXT,
      expires_at TEXT,
      revoked INTEGER NOT NULL DEFAULT 0
    );
  `);
  sqlite.prepare("INSERT INTO families VALUES (?,?,?)").run("family-b", "parent-b", "2026-07-14 01:00:00");
  sqlite.prepare("INSERT INTO family_members VALUES (?,?,?,?,?,?,?)")
    .run("child-b", "family-b", "child-1", "child", 1, "2026-07-14 01:00:00", null);
  sqlite.prepare("INSERT INTO refresh_tokens VALUES (?,?,?,?,0)")
    .run("refresh-1", "child-1", "family-a", "2099-08-15T01:00:00.000Z");

  assert.equal(typeof authz.commitFamilySelection, "function");
  await authz.commitFamilySelection(db, "child-1", "family-b", "2026-07-15T02:00:00.000Z");
  assert.equal(
    sqlite.prepare("SELECT last_selected_at FROM family_members WHERE id='child-b'").get().last_selected_at,
    "2026-07-15T02:00:00.000Z",
  );
  assert.equal(
    sqlite.prepare("SELECT family_id FROM refresh_tokens WHERE token='refresh-1'").get().family_id,
    "family-b",
  );
});

test("일반 login·OAuth·refresh는 명시 선택 시각을 덮지 않는다", () => {
  const sources = [
    "../routes/auth.ts",
    "../routes/naver-auth.ts",
    "../routes/oauth.ts",
    "../routes/oauth-bridge.ts",
  ].map((path) => readFileSync(new URL(path, import.meta.url), "utf8"));
  for (const source of sources) assert.doesNotMatch(source, /markFamilySelection/);
  assert.match(sources[0], /resolveCanonicalFamilyMembership\(c\.env\.DB, rot\.userId, rot\.familyId\)/);
});

test("같은 시각의 연속 명시 선택도 마지막 가족 marker 하나만 남긴다", async () => {
  const { sqlite, db } = createDb();
  sqlite.exec(`
    CREATE TABLE refresh_tokens(
      token TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      family_id TEXT,
      expires_at TEXT,
      revoked INTEGER NOT NULL DEFAULT 0
    );
  `);
  sqlite.prepare("INSERT INTO families VALUES (?,?,?)").run("family-a", "parent-a", "2026-07-12 01:00:00");
  sqlite.prepare("INSERT INTO families VALUES (?,?,?)").run("family-b", "parent-b", "2026-07-14 01:00:00");
  sqlite.prepare("INSERT INTO family_members VALUES (?,?,?,?,?,?,?)")
    .run("child-a", "family-a", "child-1", "child", 1, "2026-07-12 01:00:00", null);
  sqlite.prepare("INSERT INTO family_members VALUES (?,?,?,?,?,?,?)")
    .run("child-b", "family-b", "child-1", "child", 1, "2026-07-14 01:00:00", null);
  sqlite.prepare("INSERT INTO refresh_tokens VALUES (?,?,?,?,0)")
    .run("refresh-1", "child-1", "family-a", "2099-08-15T01:00:00.000Z");

  const sameTime = "2026-07-15T02:00:00.000Z";
  await authz.commitFamilySelection(db, "child-1", "family-a", sameTime);
  await authz.commitFamilySelection(db, "child-1", "family-b", sameTime);
  assert.deepEqual(await requireResolver()(db, "child-1", "family-a"), {
    familyId: "family-b",
    role: "child",
  });
  assert.equal(
    sqlite.prepare("SELECT COUNT(*) AS count FROM family_members WHERE user_id='child-1' AND last_selected_at IS NOT NULL").get().count,
    1,
  );
});

test("인증된 현재 가족을 아는 route는 owner-only 혼합 역할에서도 preferred family를 전달한다", () => {
  const sources = {
    family: readFileSync(new URL("../routes/family.ts", import.meta.url), "utf8"),
    push: readFileSync(new URL("../routes/push-subscriptions.ts", import.meta.url), "utf8"),
    shimAuth: readFileSync(new URL("../routes/rest-shim-auth.ts", import.meta.url), "utf8"),
    shimRpc: readFileSync(new URL("../routes/rest-shim-rpc.ts", import.meta.url), "utf8"),
    shimTable: readFileSync(new URL("../routes/rest-shim-table.ts", import.meta.url), "utf8"),
  };
  assert.match(sources.family, /resolveCanonicalFamilyMembership\(c\.env\.DB, userId, user\.family_id \?\? null\)/);
  assert.match(sources.push, /resolveCanonicalFamilyMembership\(c\.env\.DB, user\.sub, user\.family_id \?\? null\)/);
  assert.match(sources.shimAuth, /familyId: string \| null/);
  assert.match(sources.shimRpc, /resolveCanonicalFamilyMembership\(db, caller\.sub!, caller\.familyId\)/);
  assert.match(sources.shimTable, /resolveCanonicalFamilyMembership\(c\.env\.DB, caller\.sub!, caller\.familyId\)/);
});

test("selection migration은 유효한 최신 refresh snapshot만 backfill하고 인덱스를 만든다", () => {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`
    CREATE TABLE family_members(
      id TEXT PRIMARY KEY,
      family_id TEXT NOT NULL,
      user_id TEXT,
      role TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    );
    CREATE TABLE refresh_tokens(
      token TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      family_id TEXT,
      issued_at TEXT,
      expires_at TEXT,
      revoked INTEGER NOT NULL DEFAULT 0
    );
    INSERT INTO family_members VALUES
      ('member-a','family-a','child-1','child',1,'2026-07-12T01:00:00.000Z'),
      ('member-b','family-b','child-1','child',1,'2026-07-13T01:00:00.000Z');
    INSERT INTO refresh_tokens VALUES
      ('expired','child-1','family-a','2000-07-14T01:00:00.000Z','2000-07-14T02:00:00.000Z',0),
      ('revoked','child-1','family-a','2099-07-14T01:00:00.000Z','2099-08-14T01:00:00.000Z',1),
      ('live-old','child-1','family-b','2099-07-14T01:00:00.000Z','2099-08-14T01:00:00.000Z',0),
      ('live-new','child-1','family-b','2099-07-15T01:00:00.000Z','2099-08-15T01:00:00.000Z',0);
  `);

  sqlite.exec(readFileSync(new URL("../db/family-current-selection.sql", import.meta.url), "utf8"));
  assert.equal(
    sqlite.prepare("SELECT last_selected_at FROM family_members WHERE id='member-a'").get().last_selected_at,
    null,
  );
  assert.equal(
    sqlite.prepare("SELECT last_selected_at FROM family_members WHERE id='member-b'").get().last_selected_at,
    "2099-07-15T01:00:00.000Z",
  );
  assert.equal(
    sqlite.prepare("SELECT COUNT(*) AS count FROM pragma_index_list('family_members') WHERE name='idx_family_members_user_current'").get().count,
    1,
  );
});
