import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { dirname, extname, resolve } from "node:path";
import test, { after } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath, pathToFileURL } from "node:url";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { Hono } from "hono";

const workerDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoDir = resolve(workerDir, "..");
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

const familyRoutes = (await import(pathToFileURL(resolve(workerDir, "routes/family.ts")).href)).default;
const { privateKey, publicKey } = await generateKeyPair("ES256", { extractable: true });
const jwtPrivateKey = JSON.stringify(await exportJWK(privateKey));
const jwtPublicKey = JSON.stringify(await exportJWK(publicKey));

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
    return { success: true, results: this.sqlite.prepare(this.sql).all(...this.bindings) };
  }

  async run() {
    const result = this.sqlite.prepare(this.sql).run(...this.bindings);
    return { success: true, meta: { changes: Number(result.changes) } };
  }
}

class ConcurrentChildMutationDb {
  constructor(sqlite) {
    this.sqlite = sqlite;
    this.targetBatchCount = 0;
    this.targetBarrier = new Promise((resolveBarrier) => { this.resolveTargetBarrier = resolveBarrier; });
    this.batchTail = Promise.resolve();
  }

  prepare(sql) {
    return new Statement(this.sqlite, sql);
  }

  isTargetBatch(statements) {
    const sql = statements.map((statement) => statement.sql).join("\n");
    return sql.includes("AS child")
      || sql.includes("UPDATE family_members SET user_id=")
      || sql.includes("UPDATE family_members SET is_active=1")
      || sql.includes("INSERT INTO family_members (id, family_id, user_id, role, name, is_active, created_at)")
      || sql.includes("UPDATE family_members SET role='parent', is_active=1")
      || sql.includes("INSERT INTO family_members (id, family_id, user_id, role, name, created_at)");
  }

  async batch(statements) {
    if (this.isTargetBatch(statements) && this.targetBatchCount < 2) {
      this.targetBatchCount += 1;
      if (this.targetBatchCount === 2) this.resolveTargetBarrier();
      await this.targetBarrier;
    }

    const previous = this.batchTail;
    let release;
    this.batchTail = new Promise((resolveTail) => { release = resolveTail; });
    await previous;
    this.sqlite.exec("BEGIN IMMEDIATE");
    try {
      const results = statements.map((statement) => {
        const result = this.sqlite.prepare(statement.sql).run(...statement.bindings);
        return { success: true, meta: { changes: Number(result.changes) } };
      });
      this.sqlite.exec("COMMIT");
      return results;
    } catch (error) {
      this.sqlite.exec("ROLLBACK");
      throw error;
    } finally {
      release();
    }
  }
}

function createDb({ concurrent = true } = {}) {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(readFileSync(resolve(repoDir, "cloudflare/schema_d1.sql"), "utf8"));
  const db = new ConcurrentChildMutationDb(sqlite);
  if (!concurrent) db.resolveTargetBarrier();
  return { sqlite, db };
}

function addUser(sqlite, id, isAnonymous) {
  sqlite.prepare("INSERT INTO users(id,is_anonymous) VALUES (?,?)").run(id, isAnonymous ? 1 : 0);
  sqlite.prepare(
    "INSERT INTO user_profiles(user_id,display_name,provider,created_at,updated_at) VALUES (?,?,'test','2026-08-01','2026-08-01')",
  ).run(id, id);
}

function addFamily(sqlite, familyId, parentId, placeholder = false) {
  sqlite.prepare(
    "INSERT INTO families(id,parent_id,pair_code,planned_child_count,created_at) VALUES (?,?,?,1,'2026-08-01')",
  ).run(familyId, parentId, `KID-${familyId}`.toUpperCase());
  sqlite.prepare(
    "INSERT INTO family_members(id,family_id,user_id,role,name,is_active,created_at) VALUES (?,?,?,'parent','부모',1,'2026-08-01')",
  ).run(`member-${parentId}`, familyId, parentId);
  if (placeholder) {
    sqlite.prepare(
      "INSERT INTO family_members(id,family_id,user_id,role,name,is_active,created_at) VALUES (?,?,NULL,'child','아이',1,'2026-08-01')",
    ).run("placeholder-1", familyId);
  }
}

async function authorization(sub, role, familyId = null, isAnonymous = false) {
  const token = await new SignJWT({ role, family_id: familyId, is_anonymous: isAnonymous })
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

async function setupRequest(db, parentId, familyId, childName) {
  const app = new Hono();
  app.route("/api/family", familyRoutes);
  return app.request("http://test.local/api/family/setup", {
    method: "POST",
    headers: {
      authorization: await authorization(parentId, "parent", familyId),
      "content-type": "application/json",
    },
    body: JSON.stringify({ parentName: "부모", plannedChildCount: 1, children: [{ name: childName }] }),
  }, environment(db));
}

async function joinRequest(db, childId, pairCode, name) {
  const app = new Hono();
  app.route("/api/family", familyRoutes);
  return app.request("http://test.local/api/family/join", {
    method: "POST",
    headers: {
      authorization: await authorization(childId, "anonymous", null, true),
      "content-type": "application/json",
    },
    body: JSON.stringify({
      pairCode,
      name,
      device_install_id: `device-${childId}`,
      device_label: `테스트 ${childId}`,
      device_platform: "android",
    }),
  }, environment(db));
}

async function joinAsParentRequest(db, parentId, pairCode, name = "보조 보호자") {
  const app = new Hono();
  app.route("/api/family", familyRoutes);
  return app.request("http://test.local/api/family/join-as-parent", {
    method: "POST",
    headers: {
      authorization: await authorization(parentId, "parent"),
      "content-type": "application/json",
    },
    body: JSON.stringify({
      pairCode,
      name,
      device_install_id: `device-${parentId}`,
      device_label: `테스트 ${parentId}`,
      device_platform: "web",
    }),
  }, environment(db));
}

test("Free 기존 가족의 동시 setup은 활성 자녀 placeholder를 1명만 만든다", async () => {
  const { sqlite, db } = createDb();
  addUser(sqlite, "parent-setup", false);
  addFamily(sqlite, "free-setup", "parent-setup");

  const responses = await Promise.all([
    setupRequest(db, "parent-setup", "free-setup", "첫째"),
    setupRequest(db, "parent-setup", "free-setup", "둘째"),
  ]);
  assert.deepEqual(responses.map((response) => response.status).sort(), [200, 403]);
  assert.equal(sqlite.prepare(
    "SELECT COUNT(*) AS count FROM family_members WHERE family_id='free-setup' AND role='child' AND is_active=1",
  ).get().count, 1);
});

test("동시 join은 같은 placeholder의 user_id를 덮어쓰지 않는다", async () => {
  const { sqlite, db } = createDb();
  addUser(sqlite, "parent-placeholder", false);
  addUser(sqlite, "child-placeholder-a", true);
  addUser(sqlite, "child-placeholder-b", true);
  addFamily(sqlite, "free-placeholder", "parent-placeholder", true);

  const pairCode = "KID-FREE-PLACEHOLDER";
  sqlite.prepare("UPDATE families SET pair_code=? WHERE id='free-placeholder'").run(pairCode);
  const responses = await Promise.all([
    joinRequest(db, "child-placeholder-a", pairCode, "첫째"),
    joinRequest(db, "child-placeholder-b", pairCode, "둘째"),
  ]);
  assert.deepEqual(responses.map((response) => response.status).sort(), [200, 409]);
  const member = sqlite.prepare(
    "SELECT user_id FROM family_members WHERE id='placeholder-1'",
  ).get();
  assert.ok(["child-placeholder-a", "child-placeholder-b"].includes(member.user_id));
  const loser = member.user_id === "child-placeholder-a" ? "child-placeholder-b" : "child-placeholder-a";
  assert.equal(sqlite.prepare("SELECT is_anonymous FROM users WHERE id=?").get(loser).is_anonymous, 1);
});

test("placeholder 없는 Free 가족의 서로 다른 이름 동시 join도 자녀 1명만 허용한다", async () => {
  const { sqlite, db } = createDb();
  addUser(sqlite, "parent-insert", false);
  addUser(sqlite, "child-insert-a", true);
  addUser(sqlite, "child-insert-b", true);
  addFamily(sqlite, "free-insert", "parent-insert");

  const pairCode = "KID-FREE-INSERT";
  sqlite.prepare("UPDATE families SET pair_code=? WHERE id='free-insert'").run(pairCode);
  const responses = await Promise.all([
    joinRequest(db, "child-insert-a", pairCode, "첫째"),
    joinRequest(db, "child-insert-b", pairCode, "둘째"),
  ]);
  assert.deepEqual(responses.map((response) => response.status).sort(), [200, 403]);
  assert.equal(sqlite.prepare(
    "SELECT COUNT(*) AS count FROM family_members WHERE family_id='free-insert' AND role='child' AND is_active=1 AND user_id IS NOT NULL",
  ).get().count, 1);
  assert.equal(sqlite.prepare(
    "SELECT COUNT(*) AS count FROM users WHERE id IN ('child-insert-a','child-insert-b') AND is_anonymous=0",
  ).get().count, 1);
});

test("Premium 가족도 동시 join에서 활성 자녀 2명 상한을 넘지 않는다", async () => {
  const { sqlite, db } = createDb();
  addUser(sqlite, "parent-premium", false);
  addUser(sqlite, "child-premium-existing", false);
  addUser(sqlite, "child-premium-a", true);
  addUser(sqlite, "child-premium-b", true);
  addFamily(sqlite, "premium-insert", "parent-premium");
  sqlite.prepare(
    "INSERT INTO family_members(id,family_id,user_id,role,name,is_active,created_at) VALUES ('premium-existing','premium-insert','child-premium-existing','child','기존 아이',1,'2026-08-01')",
  ).run();
  sqlite.prepare(
    `INSERT INTO family_subscription
       (family_id,status,product_id,qonversion_user_id,provider,current_period_end,created_at,updated_at)
     VALUES ('premium-insert','active','hyeni_premium','premium-insert','google_play','2099-08-01T00:00:00.000Z','2026-08-01','2026-08-01')`,
  ).run();

  const pairCode = "KID-PREMIUM-INSERT";
  sqlite.prepare("UPDATE families SET pair_code=? WHERE id='premium-insert'").run(pairCode);
  const responses = await Promise.all([
    joinRequest(db, "child-premium-a", pairCode, "둘째 후보 A"),
    joinRequest(db, "child-premium-b", pairCode, "둘째 후보 B"),
  ]);
  assert.deepEqual(responses.map((response) => response.status).sort(), [200, 403]);
  assert.equal(sqlite.prepare(
    "SELECT COUNT(*) AS count FROM family_members WHERE family_id='premium-insert' AND role='child' AND is_active=1 AND user_id IS NOT NULL",
  ).get().count, 2);
});

test("Free 가족의 서로 다른 비활성 자녀 동시 재활성도 1명만 성공한다", async () => {
  const { sqlite, db } = createDb();
  addUser(sqlite, "parent-reactivate", false);
  addUser(sqlite, "child-reactivate-a", true);
  addUser(sqlite, "child-reactivate-b", true);
  addFamily(sqlite, "free-reactivate", "parent-reactivate");
  sqlite.prepare(
    "INSERT INTO family_members(id,family_id,user_id,role,name,is_active,created_at) VALUES ('inactive-a','free-reactivate','child-reactivate-a','child','첫째',0,'2026-08-01'),('inactive-b','free-reactivate','child-reactivate-b','child','둘째',0,'2026-08-01')",
  ).run();

  const pairCode = "KID-FREE-REACTIVATE";
  sqlite.prepare("UPDATE families SET pair_code=? WHERE id='free-reactivate'").run(pairCode);
  const responses = await Promise.all([
    joinRequest(db, "child-reactivate-a", pairCode, "첫째"),
    joinRequest(db, "child-reactivate-b", pairCode, "둘째"),
  ]);
  assert.deepEqual(responses.map((response) => response.status).sort(), [200, 403]);
  assert.equal(sqlite.prepare(
    "SELECT COUNT(*) AS count FROM family_members WHERE family_id='free-reactivate' AND role='child' AND is_active=1 AND user_id IS NOT NULL",
  ).get().count, 1);
});

test("같은 연동 코드의 서로 다른 두 사용자가 동시에 보조 보호자로 가입해도 한 명만 활성화된다", async () => {
  const { sqlite, db } = createDb();
  addUser(sqlite, "primary-parent", false);
  addUser(sqlite, "coparent-a", false);
  addUser(sqlite, "coparent-b", false);
  addFamily(sqlite, "coparent-race-family", "primary-parent");
  const pairCode = "KID-COPARENT-RACE";
  sqlite.prepare("UPDATE families SET pair_code=? WHERE id='coparent-race-family'").run(pairCode);

  const responses = await Promise.all([
    joinAsParentRequest(db, "coparent-a", pairCode, "보조 A"),
    joinAsParentRequest(db, "coparent-b", pairCode, "보조 B"),
  ]);

  assert.deepEqual(responses.map((response) => response.status).sort(), [200, 400]);
  assert.equal(sqlite.prepare(
    `SELECT COUNT(*) AS count FROM family_members
      WHERE family_id='coparent-race-family' AND role='parent' AND is_active=1
        AND user_id<>'primary-parent'`,
  ).get().count, 1);
  assert.deepEqual({ ...sqlite.prepare(
    "SELECT parent_id FROM families WHERE id='coparent-race-family'",
  ).get() }, { parent_id: "primary-parent" });
  assert.deepEqual({ ...sqlite.prepare(
    "SELECT role, is_active FROM family_members WHERE family_id='coparent-race-family' AND user_id='primary-parent'",
  ).get() }, { role: "parent", is_active: 1 });
});

test("비활성 보조 보호자는 자리가 비어 있으면 정상 재가입한다", async () => {
  const { sqlite, db } = createDb({ concurrent: false });
  addUser(sqlite, "primary-reactivate-parent", false);
  addUser(sqlite, "inactive-coparent", false);
  addFamily(sqlite, "coparent-reactivate-family", "primary-reactivate-parent");
  sqlite.prepare(
    `INSERT INTO family_members(id,family_id,user_id,role,name,is_active,created_at)
     VALUES ('inactive-coparent-member','coparent-reactivate-family','inactive-coparent','parent','기존 보조',0,'2026-08-01')`,
  ).run();
  const pairCode = "KID-COPARENT-REACTIVATE";
  sqlite.prepare("UPDATE families SET pair_code=? WHERE id='coparent-reactivate-family'").run(pairCode);

  const response = await joinAsParentRequest(db, "inactive-coparent", pairCode, "다시 연결한 보조");

  assert.equal(response.status, 200);
  assert.deepEqual({ ...sqlite.prepare(
    "SELECT role, name, is_active FROM family_members WHERE id='inactive-coparent-member'",
  ).get() }, { role: "parent", name: "다시 연결한 보조", is_active: 1 });
});

test("서로 다른 비활성 보조 보호자의 동시 재가입도 한 명만 활성화된다", async () => {
  const { sqlite, db } = createDb();
  addUser(sqlite, "primary-reactivate-race", false);
  addUser(sqlite, "inactive-coparent-a", false);
  addUser(sqlite, "inactive-coparent-b", false);
  addFamily(sqlite, "coparent-reactivate-race-family", "primary-reactivate-race");
  sqlite.prepare(
    `INSERT INTO family_members(id,family_id,user_id,role,name,is_active,created_at)
     VALUES
       ('inactive-coparent-a-member','coparent-reactivate-race-family','inactive-coparent-a','parent','보조 A',0,'2026-08-01'),
       ('inactive-coparent-b-member','coparent-reactivate-race-family','inactive-coparent-b','parent','보조 B',0,'2026-08-01')`,
  ).run();
  const pairCode = "KID-COPARENT-REACTIVATE-RACE";
  sqlite.prepare("UPDATE families SET pair_code=? WHERE id='coparent-reactivate-race-family'").run(pairCode);

  const responses = await Promise.all([
    joinAsParentRequest(db, "inactive-coparent-a", pairCode, "보조 A"),
    joinAsParentRequest(db, "inactive-coparent-b", pairCode, "보조 B"),
  ]);

  assert.deepEqual(responses.map((response) => response.status).sort(), [200, 400]);
  assert.equal(sqlite.prepare(
    `SELECT COUNT(*) AS count FROM family_members
      WHERE family_id='coparent-reactivate-race-family' AND role='parent' AND is_active=1
        AND user_id<>'primary-reactivate-race'`,
  ).get().count, 1);
});

test("같은 보조 보호자의 동시 재호출은 멱등 성공하고 중복 멤버십을 만들지 않는다", async () => {
  const { sqlite, db } = createDb();
  addUser(sqlite, "primary-idempotent-parent", false);
  addUser(sqlite, "idempotent-coparent", false);
  addFamily(sqlite, "coparent-idempotent-family", "primary-idempotent-parent");
  sqlite.prepare(
    `INSERT INTO family_members(id,family_id,user_id,role,name,is_active,created_at)
     VALUES ('idempotent-coparent-member','coparent-idempotent-family','idempotent-coparent','parent','보조',1,'2026-08-01')`,
  ).run();
  const pairCode = "KID-COPARENT-IDEMPOTENT";
  sqlite.prepare("UPDATE families SET pair_code=? WHERE id='coparent-idempotent-family'").run(pairCode);

  const responses = await Promise.all([
    joinAsParentRequest(db, "idempotent-coparent", pairCode, "보조"),
    joinAsParentRequest(db, "idempotent-coparent", pairCode, "보조"),
  ]);

  assert.deepEqual(responses.map((response) => response.status), [200, 200]);
  assert.equal(sqlite.prepare(
    `SELECT COUNT(*) AS count FROM family_members
      WHERE family_id='coparent-idempotent-family' AND user_id='idempotent-coparent'`,
  ).get().count, 1);
});
