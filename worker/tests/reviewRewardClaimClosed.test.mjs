import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { registerHooks } from "node:module";
import { dirname, extname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test, { after } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { Hono } from "hono";

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

const reviewRewardRoutes = (
  await import(pathToFileURL(resolve(workerDir, "routes/review-rewards.ts")).href)
).default;

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
    return { meta: { changes: Number(result.changes) }, success: true };
  }
}

class D1DatabaseAdapter {
  constructor(db) {
    this.db = db;
  }

  prepare(sql) {
    return new D1StatementAdapter(this.db, sql);
  }
}

function createDb() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`
    CREATE TABLE users(id TEXT PRIMARY KEY, is_anonymous INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE families(id TEXT PRIMARY KEY, parent_id TEXT NOT NULL, created_at TEXT);
    CREATE TABLE family_members(
      id TEXT PRIMARY KEY,
      family_id TEXT NOT NULL,
      user_id TEXT,
      role TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT,
      last_selected_at TEXT
    );
    CREATE TABLE family_review_rewards(
      family_id TEXT PRIMARY KEY,
      parent_id TEXT NOT NULL,
      reward_type TEXT NOT NULL,
      granted_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE account_deletion_scopes(
      job_id TEXT NOT NULL,
      scope_type TEXT NOT NULL,
      scope_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY(scope_type, scope_id)
    );
    CREATE TABLE account_mutation_leases(
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      family_id TEXT,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE family_unpair_cleanup_jobs(
      family_id TEXT NOT NULL,
      child_user_id TEXT NOT NULL
    );
  `);

  sqlite.prepare("INSERT INTO users(id) VALUES (?)").run("parent-a");
  for (const familyId of ["family-legacy", "family-free"]) {
    sqlite.prepare("INSERT INTO families VALUES (?,?,?)")
      .run(familyId, "parent-a", "2026-07-01 00:00:00+00");
    sqlite.prepare("INSERT INTO family_members VALUES (?,?,?,?,1,?,NULL)")
      .run(`member-${familyId}`, familyId, "parent-a", "parent", "2026-07-01 00:00:00+00");
  }
  sqlite.prepare("INSERT INTO family_review_rewards VALUES (?,?,?,?,?)").run(
    "family-legacy",
    "parent-a",
    "store_visit",
    "2026-07-10 01:02:03+00",
    "2026-07-10 01:02:03+00",
  );

  return { sqlite, db: new D1DatabaseAdapter(sqlite) };
}

const { privateKey, publicKey } = await generateKeyPair("ES256", { extractable: true });
const jwtPrivateKey = JSON.stringify(await exportJWK(privateKey));
const jwtPublicKey = JSON.stringify(await exportJWK(publicKey));

async function authorization(familyId) {
  const token = await new SignJWT({ role: "parent", family_id: familyId, is_anonymous: false })
    .setProtectedHeader({ alg: "ES256" })
    .setSubject("parent-a")
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(privateKey);
  return `Bearer ${token}`;
}

async function request(db, familyId, method = "GET") {
  const app = new Hono();
  app.route("/api/review-rewards", reviewRewardRoutes);
  const isGet = method === "GET";
  return app.request(
    `http://test.local/api/review-rewards${isGet ? `?familyId=${familyId}` : ""}`,
    {
      method,
      headers: {
        Authorization: await authorization(familyId),
        ...(isGet ? {} : { "Content-Type": "application/json" }),
      },
      ...(isGet ? {} : { body: JSON.stringify({ familyId }) }),
    },
    { DB: db, JWT_PRIVATE_KEY: jwtPrivateKey, JWT_PUBLIC_KEY: jwtPublicKey },
  );
}

const closedResponse = {
  ok: false,
  error: "review_reward_program_ended",
  message: "스토어 방문 혜택의 신규 지급은 종료되었어요. 기존에 받은 혜택은 그대로 유지됩니다.",
};

test("기존 family_review_rewards 행은 GET에서 계속 읽고 종료된 POST가 변경하지 않는다", async () => {
  const { sqlite, db } = createDb();
  const before = sqlite.prepare("SELECT * FROM family_review_rewards WHERE family_id=?")
    .get("family-legacy");

  const getResponse = await request(db, "family-legacy");
  assert.equal(getResponse.status, 200);
  assert.deepEqual(await getResponse.json(), { rewarded: true });

  const postResponse = await request(db, "family-legacy", "POST");
  assert.equal(postResponse.status, 410);
  assert.deepEqual(await postResponse.json(), closedResponse);

  const afterRow = sqlite.prepare("SELECT * FROM family_review_rewards WHERE family_id=?")
    .get("family-legacy");
  assert.deepEqual(afterRow, before);
  sqlite.close();
});

test("신규 POST claim은 보상 행을 만들지 않는다", async () => {
  const { sqlite, db } = createDb();
  const response = await request(db, "family-free", "POST");

  assert.equal(response.status, 410);
  assert.deepEqual(await response.json(), closedResponse);
  assert.equal(
    sqlite.prepare("SELECT COUNT(*) AS count FROM family_review_rewards WHERE family_id=?")
      .get("family-free").count,
    0,
  );
  sqlite.close();
});
