import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { dirname, extname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test, { after } from "node:test";
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

const aiDataRoutes = (
  await import(pathToFileURL(resolve(workerDir, "routes/ai-chat-data.ts")).href)
).default;

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

  async run() {
    const result = this.sqlite.prepare(this.sql).run(...this.bindings);
    return { success: true, meta: { changes: Number(result.changes) } };
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

const { privateKey, publicKey } = await generateKeyPair("ES256", { extractable: true });
const jwtPrivateKey = JSON.stringify(await exportJWK(privateKey));
const jwtPublicKey = JSON.stringify(await exportJWK(publicKey));

function createDb() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(readFileSync(resolve(repoDir, "cloudflare/schema_d1.sql"), "utf8"));
  const createdAt = "2026-08-02T00:00:00.000Z";

  for (const suffix of ["free", "premium"]) {
    const familyId = `family-${suffix}`;
    const parentId = `parent-${suffix}`;
    const childId = `child-${suffix}`;
    sqlite.prepare(
      "INSERT INTO users(id,email,is_anonymous,raw_user_meta_data,created_at) VALUES (?,?,0,?,?)",
    ).run(parentId, `${parentId}@example.com`, "{}", createdAt);
    sqlite.prepare(
      "INSERT INTO users(id,email,is_anonymous,raw_user_meta_data,created_at) VALUES (?,?,0,?,?)",
    ).run(childId, null, "{}", createdAt);
    sqlite.prepare("INSERT INTO families(id,parent_id,pair_code,created_at) VALUES (?,?,?,?)")
      .run(familyId, parentId, `PAIR-${suffix}`, createdAt);
    sqlite.prepare(
      "INSERT INTO family_members(id,family_id,user_id,role,name,is_active,created_at) VALUES (?,?,?,?,?,1,?)",
    ).run(`member-${parentId}`, familyId, parentId, "parent", "부모", createdAt);
    sqlite.prepare(
      "INSERT INTO family_members(id,family_id,user_id,role,name,is_active,created_at) VALUES (?,?,?,?,?,1,?)",
    ).run(`member-${childId}`, familyId, childId, "child", "아이", createdAt);
  }
  sqlite.prepare(
    "INSERT INTO family_subscription(family_id,status,product_id,qonversion_user_id,current_period_end,remote_listen_enabled,updated_at) VALUES (?,?,?,?,?,?,?)",
  ).run(
    "family-premium",
    "active",
    "hyeni_premium_monthly_4900",
    "test-family-premium",
    new Date(Date.now() + 24 * 60 * 60_000).toISOString(),
    1,
    createdAt,
  );
  return { sqlite, db: new Db(sqlite) };
}

async function authorization(sub, role, familyId) {
  const token = await new SignJWT({ role, family_id: familyId, is_anonymous: false })
    .setProtectedHeader({ alg: "ES256" })
    .setSubject(sub)
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(privateKey);
  return `Bearer ${token}`;
}

async function request(db, path, method, actor, body) {
  const app = new Hono();
  app.route("/api/ai", aiDataRoutes);
  return app.request(`http://test.local/api/ai${path}`, {
    method,
    headers: {
      Authorization: await authorization(actor.sub, actor.role, actor.familyId),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  }, {
    DB: db,
    JWT_PRIVATE_KEY: jwtPrivateKey,
    JWT_PUBLIC_KEY: jwtPublicKey,
  });
}

test("부모가 AI를 처음 켜면 Free 5회·Premium 20회를 명시 저장한다", async () => {
  const { sqlite, db } = createDb();
  for (const [suffix, expectedLimit] of [["free", 5], ["premium", 20]]) {
    const response = await request(db, "/settings/friend", "PATCH", {
      sub: `parent-${suffix}`,
      role: "parent",
      familyId: `family-${suffix}`,
    }, {
      family_id: `family-${suffix}`,
      child_user_id: `child-${suffix}`,
      ai_enabled: true,
    });
    assert.equal(response.status, 200);
    const row = sqlite.prepare(
      "SELECT ai_enabled,daily_limit FROM ai_parent_settings WHERE family_id=? AND child_user_id=?",
    ).get(`family-${suffix}`, `child-${suffix}`);
    assert.equal(row?.ai_enabled, 1);
    assert.equal(row?.daily_limit, expectedLimit);
  }
  sqlite.close();
});

test("아이가 AI 친구 이름을 먼저 정해도 현재 가족 티어의 5회·20회 기본값을 보존한다", async () => {
  const { sqlite, db } = createDb();
  for (const [suffix, expectedLimit] of [["free", 5], ["premium", 20]]) {
    const response = await request(db, "/settings/friend-name", "POST", {
      sub: `child-${suffix}`,
      role: "child",
      familyId: `family-${suffix}`,
    }, {
      familyId: `family-${suffix}`,
      name: "별이",
    });
    assert.equal(response.status, 200);
    const row = sqlite.prepare(
      "SELECT ai_friend_name,daily_limit FROM ai_parent_settings WHERE family_id=? AND child_user_id=?",
    ).get(`family-${suffix}`, `child-${suffix}`);
    assert.equal(row?.ai_friend_name, "별이");
    assert.equal(row?.daily_limit, expectedLimit);
  }
  sqlite.close();
});

test("부모 최초 설정과 아이 최초 이름 저장이 겹쳐도 한 행에서 서로의 값을 보존한다", async () => {
  const { sqlite, db } = createDb();
  const [parentResponse, childResponse] = await Promise.all([
    request(db, "/settings/friend", "PATCH", {
      sub: "parent-free",
      role: "parent",
      familyId: "family-free",
    }, {
      family_id: "family-free",
      child_user_id: "child-free",
      ai_enabled: true,
    }),
    request(db, "/settings/friend-name", "POST", {
      sub: "child-free",
      role: "child",
      familyId: "family-free",
    }, {
      familyId: "family-free",
      name: "별이",
    }),
  ]);

  assert.equal(parentResponse.status, 200);
  assert.equal(childResponse.status, 200);
  const count = sqlite.prepare(
    "SELECT COUNT(*) AS n FROM ai_parent_settings WHERE family_id=? AND child_user_id=?",
  ).get("family-free", "child-free");
  const row = sqlite.prepare(
    "SELECT ai_enabled,ai_friend_name,daily_limit FROM ai_parent_settings WHERE family_id=? AND child_user_id=?",
  ).get("family-free", "child-free");
  assert.equal(count?.n, 1);
  assert.equal(row?.ai_enabled, 1);
  assert.equal(row?.ai_friend_name, "별이");
  assert.equal(row?.daily_limit, 5);
  sqlite.close();
});

test("운영 unique migration은 중복 설정을 삭제하지 않고 선행 정규화 없이는 실패한다", () => {
  const migration = readFileSync(resolve(repoDir, "worker/db/ai-parent-settings-uniqueness.sql"), "utf8");
  assert.doesNotMatch(migration, /\b(?:DELETE|DROP|UPDATE)\b/i);

  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`
    CREATE TABLE ai_parent_settings (
      id TEXT PRIMARY KEY,
      family_id TEXT NOT NULL,
      child_user_id TEXT NOT NULL
    );
    INSERT INTO ai_parent_settings VALUES ('one','family','child');
    INSERT INTO ai_parent_settings VALUES ('two','family','child');
  `);
  assert.throws(() => sqlite.exec(migration), /UNIQUE constraint failed/);
  const count = sqlite.prepare("SELECT COUNT(*) AS n FROM ai_parent_settings").get();
  assert.equal(count?.n, 2);
  sqlite.close();
});
