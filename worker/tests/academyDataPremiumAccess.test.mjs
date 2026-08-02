import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { dirname, extname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test, { after } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const workerDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const typeScriptResolutionHook = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith(".") && !extname(specifier)) {
      const base = new URL(specifier, context.parentURL);
      for (const extension of [".ts", ".js"]) {
        const candidate = new URL(`${base.href}${extension}`);
        if (existsSync(fileURLToPath(candidate))) {
          return { url: candidate.href, shortCircuit: true };
        }
      }
    }
    return nextResolve(specifier, context);
  },
});
after(() => typeScriptResolutionHook.deregister());

const { authorizeAcademyDataAccess } = await import(
  pathToFileURL(resolve(workerDir, "lib/academyDataAccess.ts")).href
);

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

  async all() {
    return { results: this.sqlite.prepare(this.sql).all(...this.bindings) };
  }
}

class Db {
  constructor(sqlite) {
    this.sqlite = sqlite;
  }

  prepare(sql) {
    return new Statement(this.sqlite, sql);
  }
}

function future() {
  return new Date(Date.now() + 24 * 60 * 60_000).toISOString();
}

function past() {
  return new Date(Date.now() - 24 * 60 * 60_000).toISOString();
}

function createDb() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`
    CREATE TABLE families(
      id TEXT PRIMARY KEY,
      parent_id TEXT NOT NULL,
      user_tier TEXT DEFAULT 'free',
      subscription_tier TEXT DEFAULT 'free',
      created_at TEXT
    );
    CREATE TABLE family_members(
      id TEXT PRIMARY KEY,
      family_id TEXT NOT NULL,
      user_id TEXT,
      role TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT,
      last_selected_at TEXT
    );
    CREATE TABLE family_subscription(
      family_id TEXT PRIMARY KEY,
      status TEXT,
      trial_ends_at TEXT,
      current_period_end TEXT,
      remote_listen_enabled INTEGER DEFAULT 1
    );
    CREATE TABLE subscriptions(
      id TEXT PRIMARY KEY,
      family_id TEXT NOT NULL,
      status TEXT NOT NULL,
      expires_at TEXT
    );
    CREATE TABLE family_review_rewards(family_id TEXT PRIMARY KEY, granted_at TEXT);
  `);
  for (const [familyId, parentId] of [
    ["family-free", "parent-free"],
    ["family-reviewed", "parent-reviewed"],
    ["family-premium", "parent-premium"],
    ["family-expired", "parent-expired"],
  ]) {
    sqlite.prepare("INSERT INTO families VALUES (?,?,?,?,?)")
      .run(familyId, parentId, "free", "free", "2026-08-01T00:00:00.000Z");
    sqlite.prepare("INSERT INTO family_members VALUES (?,?,?,?,?,?,?)")
      .run(`member-${parentId}`, familyId, parentId, "parent", 1, "2026-08-01T00:00:00.000Z", null);
  }
  sqlite.prepare("INSERT INTO family_members VALUES (?,?,?,?,?,?,?)")
    .run("member-child", "family-premium", "child-premium", "child", 1, "2026-08-01T00:00:00.000Z", null);
  sqlite.prepare("INSERT INTO family_members VALUES (?,?,?,?,?,?,?)")
    .run("member-coparent", "family-premium", "coparent-premium", "parent", 1, "2026-08-01T00:00:00.000Z", null);
  sqlite.prepare("INSERT INTO family_review_rewards VALUES (?,?)")
    .run("family-reviewed", "2026-07-01T00:00:00.000Z");
  sqlite.prepare("INSERT INTO family_subscription VALUES (?,?,?,?,?)")
    .run("family-premium", "active", null, future(), 1);
  sqlite.prepare("INSERT INTO family_subscription VALUES (?,?,?,?,?)")
    .run("family-expired", "expired", null, past(), 1);
  return { sqlite, db: new Db(sqlite) };
}

test("Premium 가족의 주보호자는 학원 조회·관리를, 활성 아이 Android는 조회만 할 수 있다", async () => {
  const { sqlite, db } = createDb();
  for (const action of ["read", "write", "delete"]) {
    assert.deepEqual(await authorizeAcademyDataAccess(db, {
      callerUserId: "parent-premium",
      familyId: "family-premium",
      action,
    }), { ok: true, familyId: "family-premium", role: "parent" });
  }
  assert.deepEqual(await authorizeAcademyDataAccess(db, {
    callerUserId: "child-premium",
    familyId: "family-premium",
    action: "read",
  }), { ok: true, familyId: "family-premium", role: "child" });
  for (const action of ["write", "delete"]) {
    assert.deepEqual(await authorizeAcademyDataAccess(db, {
      callerUserId: "child-premium",
      familyId: "family-premium",
      action,
    }), { ok: false, status: 403, error: "forbidden" });
  }
  sqlite.close();
});

test("공동 보호자는 Premium 학원 위치를 읽되 주보호자 전용 변경·삭제는 할 수 없다", async () => {
  const { sqlite, db } = createDb();
  assert.equal((await authorizeAcademyDataAccess(db, {
    callerUserId: "coparent-premium",
    familyId: "family-premium",
    action: "read",
  })).ok, true);
  for (const action of ["write", "delete"]) {
    assert.deepEqual(await authorizeAcademyDataAccess(db, {
      callerUserId: "coparent-premium",
      familyId: "family-premium",
      action,
    }), { ok: false, status: 403, error: "forbidden" });
  }
  sqlite.close();
});

test("Free·review grandfather·만료 가족은 학원 조회·생성을 열지 않지만 주보호자 삭제는 허용한다", async () => {
  const { sqlite, db } = createDb();
  for (const [callerUserId, familyId] of [
    ["parent-free", "family-free"],
    ["parent-reviewed", "family-reviewed"],
    ["parent-expired", "family-expired"],
  ]) {
    for (const action of ["read", "write"]) {
      assert.deepEqual(await authorizeAcademyDataAccess(db, { callerUserId, familyId, action }), {
        ok: false,
        status: 403,
        error: "premium_required",
      });
    }
    assert.deepEqual(await authorizeAcademyDataAccess(db, {
      callerUserId,
      familyId,
      action: "delete",
    }), { ok: true, familyId, role: "parent" });
  }
  sqlite.close();
});

test("엔타이틀먼트 오류는 조회·변경만 503으로 닫고 본인 기존 데이터 삭제는 막지 않는다", async () => {
  const { sqlite, db } = createDb();
  const failingDb = {
    prepare(sql) {
      if (sql.includes("family_subscription")) throw new Error("D1 entitlement unavailable");
      return db.prepare(sql);
    },
  };
  for (const action of ["read", "write"]) {
    assert.deepEqual(await authorizeAcademyDataAccess(failingDb, {
      callerUserId: "parent-premium",
      familyId: "family-premium",
      action,
    }), { ok: false, status: 503, error: "family_entitlement_unavailable" });
  }
  assert.deepEqual(await authorizeAcademyDataAccess(failingDb, {
    callerUserId: "parent-premium",
    familyId: "family-premium",
    action: "delete",
  }), { ok: true, familyId: "family-premium", role: "parent" });
  sqlite.close();
});

test("직접 academies API와 Android PostgREST shim 모두 공통 서버 gate를 사용한다", () => {
  const direct = readFileSync(resolve(workerDir, "routes/academies.ts"), "utf8");
  const shim = readFileSync(resolve(workerDir, "routes/rest-shim-table.ts"), "utf8");

  assert.match(direct, /authorizeAcademyDataAccess/);
  assert.match(direct, /academyGate\([^\n]+,\s*familyId,\s*"read"\)/);
  assert.match(direct, /academyGate\([^\n]+,\s*familyId,\s*"write"\)/);
  assert.match(direct, /academyGate\([^\n]+,\s*row\.family_id,\s*"delete"\)/);
  assert.doesNotMatch(direct, /premium 게이트는 M5/);
  assert.match(shim, /authorizeAcademyDataAccess/);
  assert.match(shim, /table === "academies"[\s\S]+academyShimGate/);
});
