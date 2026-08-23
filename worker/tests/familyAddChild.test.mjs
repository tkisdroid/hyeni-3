import "./helpers/tsModuleResolve.mjs";

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { Hono } from "hono";

const workerDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoDir = resolve(workerDir, "..");
const familyRoutes = (await import("../routes/family.ts")).default;
const { privateKey, publicKey } = await generateKeyPair("ES256", { extractable: true });
const jwtPrivateKey = JSON.stringify(await exportJWK(privateKey));
const jwtPublicKey = JSON.stringify(await exportJWK(publicKey));

class Statement {
  constructor(db, sql, bindings = []) {
    this.db = db;
    this.sql = sql;
    this.bindings = bindings;
  }

  bind(...bindings) {
    return new Statement(this.db, this.sql, bindings);
  }

  async first() {
    return this.db.sqlite.prepare(this.sql).get(...this.bindings) ?? null;
  }

  async all() {
    return { success: true, results: this.db.sqlite.prepare(this.sql).all(...this.bindings) };
  }

  async run() {
    return this.db.run(this.sql, this.bindings);
  }
}

class TestDb {
  constructor(sqlite, concurrentChildCreates) {
    this.sqlite = sqlite;
    this.concurrentChildCreates = concurrentChildCreates;
    this.childCreateCount = 0;
    this.childCreateBarrier = concurrentChildCreates
      ? new Promise((resolveBarrier) => { this.resolveChildCreateBarrier = resolveBarrier; })
      : Promise.resolve();
  }

  prepare(sql) {
    return new Statement(this, sql);
  }

  isChildCreate(sql) {
    return sql.includes("INSERT INTO family_members")
      && sql.includes("COALESCE((SELECT MAX(child_order)");
  }

  async run(sql, bindings) {
    if (this.concurrentChildCreates && this.isChildCreate(sql) && this.childCreateCount < 2) {
      this.childCreateCount += 1;
      if (this.childCreateCount === 2) this.resolveChildCreateBarrier();
      await this.childCreateBarrier;
    }
    const result = this.sqlite.prepare(sql).run(...bindings);
    return { success: true, meta: { changes: Number(result.changes) } };
  }

  async batch(statements) {
    this.sqlite.exec("BEGIN IMMEDIATE");
    try {
      const results = [];
      for (const statement of statements) {
        const result = this.sqlite.prepare(statement.sql).run(...statement.bindings);
        results.push({ success: true, meta: { changes: Number(result.changes) } });
      }
      this.sqlite.exec("COMMIT");
      return results;
    } catch (error) {
      this.sqlite.exec("ROLLBACK");
      throw error;
    }
  }
}

function createDb({ concurrentChildCreates = false } = {}) {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(readFileSync(resolve(repoDir, "cloudflare/schema_d1.sql"), "utf8"));
  return { sqlite, db: new TestDb(sqlite, concurrentChildCreates) };
}

function addUser(sqlite, id) {
  sqlite.prepare("INSERT INTO users(id,is_anonymous) VALUES (?,0)").run(id);
  sqlite.prepare(
    "INSERT INTO user_profiles(user_id,display_name,provider,created_at,updated_at) VALUES (?,?,'test','2026-08-24','2026-08-24')",
  ).run(id, id);
}

function addFamily(sqlite, familyId, primaryParentId, { activePrimary = true } = {}) {
  sqlite.prepare(
    "INSERT INTO families(id,parent_id,pair_code,planned_child_count,created_at) VALUES (?,?,?,1,'2026-08-24')",
  ).run(familyId, primaryParentId, `KID-${familyId}`.toUpperCase());
  sqlite.prepare(
    `INSERT INTO family_members(id,family_id,user_id,role,name,is_active,created_at)
     VALUES (?,?,?,'parent','대표 보호자',?,'2026-08-24')`,
  ).run(`member-${primaryParentId}-${familyId}`, familyId, primaryParentId, activePrimary ? 1 : 0);
}

function addCoParent(sqlite, familyId, userId) {
  sqlite.prepare(
    `INSERT INTO family_members(id,family_id,user_id,role,name,is_active,created_at)
     VALUES (?,?,?,'parent','공동 보호자',1,'2026-08-24')`,
  ).run(`member-${userId}-${familyId}`, familyId, userId);
}

function addChild(sqlite, familyId, id, name = "기존 아이") {
  sqlite.prepare(
    `INSERT INTO family_members
       (id,family_id,user_id,role,name,birthdate,child_order,is_active,created_at)
     VALUES (?,?,NULL,'child',?,'2017-01-02',1,1,'2026-08-24')`,
  ).run(id, familyId, name);
}

function makePremium(sqlite, familyId) {
  sqlite.prepare(
    `INSERT INTO family_subscription
       (family_id,status,product_id,qonversion_user_id,provider,current_period_end,created_at,updated_at)
     VALUES (?,'active','hyeni_premium',?,'google_play','2099-08-24T00:00:00.000Z','2026-08-24','2026-08-24')`,
  ).run(familyId, familyId);
}

async function authorization(sub, familyId, role = "parent") {
  const token = await new SignJWT({ role, family_id: familyId, is_anonymous: false })
    .setProtectedHeader({ alg: "ES256" })
    .setSubject(sub)
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(privateKey);
  return `Bearer ${token}`;
}

function environment(db) {
  return {
    DB: db,
    JWT_PRIVATE_KEY: jwtPrivateKey,
    JWT_PUBLIC_KEY: jwtPublicKey,
    FAMILY_ROOM: {
      idFromName: (name) => name,
      get: () => ({ fetch: async () => new Response(null, { status: 204 }) }),
    },
  };
}

const app = new Hono();
app.route("/api/family", familyRoutes);

async function requestAddChild(db, callerId, familyId, body, options = {}) {
  const headers = { "content-type": "application/json" };
  if (options.authorization !== null) {
    headers.authorization = options.authorization ?? await authorization(callerId, options.tokenFamilyId ?? familyId);
  }
  return app.request("http://test.local/api/family/member/child", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  }, environment(db));
}

function validBody(familyId, name = "혜니") {
  return { family_id: familyId, name, birthdate: "2017-01-02", color_hex: "#F3A6C4" };
}

test("자녀 생성은 유효한 Bearer 인증 없이는 라우트에 진입하지 못한다", async () => {
  const { sqlite, db } = createDb();
  addUser(sqlite, "auth-parent");
  addFamily(sqlite, "auth-family", "auth-parent");

  const missing = await requestAddChild(db, "auth-parent", "auth-family", validBody("auth-family"), {
    authorization: null,
  });
  assert.equal(missing.status, 401);
  const invalid = await requestAddChild(db, "auth-parent", "auth-family", validBody("auth-family"), {
    authorization: "Bearer invalid",
  });
  assert.equal(invalid.status, 401);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM family_members WHERE role='child'").get().n, 0);
});

test("활성 대표 보호자만 자기 가족에 자녀를 만들 수 있다", async () => {
  const { sqlite, db } = createDb();
  for (const id of ["primary-a", "coparent-a", "inactive-primary", "primary-b"]) addUser(sqlite, id);
  addFamily(sqlite, "family-a", "primary-a");
  addCoParent(sqlite, "family-a", "coparent-a");
  addFamily(sqlite, "inactive-family", "inactive-primary", { activePrimary: false });
  addFamily(sqlite, "family-b", "primary-b");

  const coparent = await requestAddChild(db, "coparent-a", "family-a", validBody("family-a"));
  assert.equal(coparent.status, 403);
  assert.equal((await coparent.json()).code, "primary_parent_required");

  const inactive = await requestAddChild(
    db,
    "inactive-primary",
    "inactive-family",
    validBody("inactive-family"),
  );
  assert.equal(inactive.status, 403);
  assert.equal((await inactive.json()).code, "primary_parent_required");

  const wrongFamily = await requestAddChild(
    db,
    "primary-a",
    "family-b",
    validBody("family-b"),
    { tokenFamilyId: "family-a" },
  );
  assert.equal(wrongFamily.status, 403);
  assert.equal((await wrongFamily.json()).code, "primary_parent_required");
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM family_members WHERE role='child'").get().n, 0);
});

test("계정 삭제 scope가 먼저 잡히면 자녀 생성은 fail-closed 한다", async () => {
  const { sqlite, db } = createDb();
  addUser(sqlite, "deleting-parent");
  addFamily(sqlite, "deleting-family", "deleting-parent");
  sqlite.prepare(
    `INSERT INTO account_deletion_jobs(id,owner_user_id,mode,status,created_at,updated_at)
     VALUES ('delete-job','deleting-parent','family','claimed','2026-08-24','2026-08-24')`,
  ).run();
  sqlite.prepare(
    `INSERT INTO account_deletion_scopes(job_id,scope_type,scope_id,created_at)
     VALUES ('delete-job','user','deleting-parent','2026-08-24')`,
  ).run();

  const response = await requestAddChild(
    db,
    "deleting-parent",
    "deleting-family",
    validBody("deleting-family"),
  );
  assert.equal(response.status, 409);
  assert.equal((await response.json()).error, "account_deletion_in_progress");
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM family_members WHERE role='child'").get().n, 0);
});

test("이름·실제 과거 생년월일·선택 색상을 엄격히 검증하고 기본 아이를 만들지 않는다", async () => {
  const { sqlite, db } = createDb();
  addUser(sqlite, "validation-parent");
  addFamily(sqlite, "validation-family", "validation-parent");
  const invalidBodies = [
    { family_id: "validation-family", birthdate: "2017-01-02" },
    validBody("validation-family", "   "),
    { ...validBody("validation-family"), birthdate: "2025-02-30" },
    { ...validBody("validation-family"), birthdate: "2999-01-01" },
    { ...validBody("validation-family"), color_hex: "pink" },
    { ...validBody("validation-family"), unexpected: true },
  ];

  for (const body of invalidBodies) {
    const response = await requestAddChild(db, "validation-parent", "validation-family", body);
    assert.equal(response.status, 400, JSON.stringify(body));
  }
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM family_members WHERE role='child'").get().n, 0);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM family_members WHERE name='아이'").get().n, 0);

  const valid = await requestAddChild(
    db,
    "validation-parent",
    "validation-family",
    validBody("validation-family", "  혜니 김  "),
  );
  assert.equal(valid.status, 200, await valid.clone().text());
  const payload = await valid.json();
  assert.match(payload.member.id, /^[0-9a-f-]{36}$/i);
  const { id, ...memberWithoutId } = payload.member;
  assert.equal(typeof id, "string");
  assert.deepEqual({ member: memberWithoutId }, {
    member: {
      role: "child",
      name: "혜니 김",
      birthdate: "2017-01-02",
      color_hex: "#F3A6C4",
      photo_url: null,
      is_active: true,
    },
  });
});

test("Free는 1명, Premium은 2명 상한을 서버에서 강제한다", async () => {
  const { sqlite, db } = createDb();
  addUser(sqlite, "free-parent");
  addFamily(sqlite, "free-family", "free-parent");
  addChild(sqlite, "free-family", "free-existing");
  const free = await requestAddChild(db, "free-parent", "free-family", validBody("free-family", "둘째"));
  assert.equal(free.status, 403);
  assert.equal((await free.json()).code, "child_limit_reached");

  addUser(sqlite, "premium-parent");
  addFamily(sqlite, "premium-family", "premium-parent");
  addChild(sqlite, "premium-family", "premium-existing");
  makePremium(sqlite, "premium-family");
  const second = await requestAddChild(
    db,
    "premium-parent",
    "premium-family",
    validBody("premium-family", "둘째"),
  );
  assert.equal(second.status, 200, await second.clone().text());
  const third = await requestAddChild(
    db,
    "premium-parent",
    "premium-family",
    validBody("premium-family", "셋째"),
  );
  assert.equal(third.status, 403);
  assert.equal((await third.json()).code, "child_limit_reached");
  assert.equal(sqlite.prepare(
    "SELECT COUNT(*) AS n FROM family_members WHERE family_id='premium-family' AND role='child' AND is_active=1",
  ).get().n, 2);
});

test("Premium 마지막 한 자리의 동시 요청은 정확히 한 행만 삽입한다", async () => {
  const { sqlite, db } = createDb({ concurrentChildCreates: true });
  addUser(sqlite, "race-parent");
  addFamily(sqlite, "race-family", "race-parent");
  addChild(sqlite, "race-family", "race-existing");
  makePremium(sqlite, "race-family");

  const responses = await Promise.all([
    requestAddChild(db, "race-parent", "race-family", validBody("race-family", "둘째 후보 A")),
    requestAddChild(db, "race-parent", "race-family", validBody("race-family", "둘째 후보 B")),
  ]);
  assert.deepEqual(responses.map((response) => response.status).sort(), [200, 403]);
  assert.equal(sqlite.prepare(
    "SELECT COUNT(*) AS n FROM family_members WHERE family_id='race-family' AND role='child' AND is_active=1",
  ).get().n, 2);
  assert.equal(sqlite.prepare(
    "SELECT COUNT(*) AS n FROM family_members WHERE family_id='race-family' AND name LIKE '둘째 후보 %'",
  ).get().n, 1);
});
