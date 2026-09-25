// 반복 일정 "이후 반복 모두 삭제"(scope=following) 회귀 가드.
// 2026-09-25 브라우저 QA — 매주 반복 일정(8회)을 끊으려면 한 건씩 8번 지워야 했다.
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
const eventRoutes = (await import("../routes/events.ts")).default;
const { privateKey, publicKey } = await generateKeyPair("ES256", { extractable: true });
const jwtPrivateKey = JSON.stringify(await exportJWK(privateKey));
const jwtPublicKey = JSON.stringify(await exportJWK(publicKey));

class Statement {
  constructor(sqlite, sql, bindings = []) {
    this.sqlite = sqlite;
    this.sql = sql;
    this.bindings = bindings;
  }
  bind(...bindings) { return new Statement(this.sqlite, this.sql, bindings); }
  async first() { return this.sqlite.prepare(this.sql).get(...this.bindings) ?? null; }
  async all() { return { success: true, results: this.sqlite.prepare(this.sql).all(...this.bindings) }; }
  async run() {
    const result = this.sqlite.prepare(this.sql).run(...this.bindings);
    return { success: true, meta: { changes: Number(result.changes) } };
  }
}

class Db {
  constructor(sqlite) { this.sqlite = sqlite; }
  prepare(sql) { return new Statement(this.sqlite, sql); }
  async batch(statements) {
    this.sqlite.exec("BEGIN IMMEDIATE");
    try {
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      this.sqlite.exec("COMMIT");
      return results;
    } catch (error) {
      this.sqlite.exec("ROLLBACK");
      throw error;
    }
  }
}

function setup() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(readFileSync(resolve(workerDir, "../cloudflare/schema_d1.sql"), "utf8"));
  sqlite.prepare("INSERT INTO users(id,is_anonymous) VALUES ('parent-1',0)").run();
  sqlite.prepare("INSERT INTO families(id,parent_id,pair_code,created_at) VALUES ('fam-1','parent-1','KID-SERIES','2026-09-25')").run();
  const insert = sqlite.prepare(
    `INSERT INTO events(id,family_id,date_key,title,time,category,emoji,color,bg,created_by,is_family_event,series_id,updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  );
  for (const [id, dateKey, seriesId] of [
    ["s-1", "2026-8-21", "series-a"],
    ["s-2", "2026-8-28", "series-a"],
    ["s-3", "2026-9-5", "series-a"],
    ["s-4", "2026-10-2", "series-a"],
    ["other", "2026-9-5", "series-b"],
    ["single", "2026-9-5", null],
  ]) {
    insert.run(id, "fam-1", dateKey, "태권도", "16:00", "sports", "", "", "", "parent-1", 1, seriesId, "2026-09-25 00:00:00+00");
  }
  const app = new Hono();
  app.route("/api/events", eventRoutes);
  const env = {
    DB: new Db(sqlite),
    JWT_PRIVATE_KEY: jwtPrivateKey,
    JWT_PUBLIC_KEY: jwtPublicKey,
    FAMILY_ROOM: {
      idFromName: (name) => name,
      get: () => ({ fetch: async () => new Response(null, { status: 204 }) }),
    },
  };
  return { app, env, sqlite };
}

async function remove(app, env, path) {
  const token = await new SignJWT({ role: "parent", family_id: "fam-1", is_anonymous: false })
    .setProtectedHeader({ alg: "ES256" })
    .setSubject("parent-1")
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(privateKey);
  return app.fetch(new Request(`http://test.local${path}`, {
    method: "DELETE",
    headers: { authorization: `Bearer ${token}` },
  }), env);
}

const remaining = (sqlite) => sqlite.prepare("SELECT id FROM events ORDER BY id").all().map((row) => row.id);

test("scope=following 은 같은 반복 묶음에서 이 날짜와 이후 일정만 지운다(월 경계 포함)", async () => {
  const { app, env, sqlite } = setup();
  const response = await remove(app, env, "/api/events/s-2?scope=following");
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, deleted: 3 });
  assert.deepEqual(remaining(sqlite), ["other", "s-1", "single"]);
});

test("scope 없이 지우면 그 일정 하나만 지운다(기존 동작 유지)", async () => {
  const { app, env, sqlite } = setup();
  const response = await remove(app, env, "/api/events/s-2");
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, deleted: 1 });
  assert.deepEqual(remaining(sqlite), ["other", "s-1", "s-3", "s-4", "single"]);
});

test("반복이 아닌 일정에 scope=following 을 줘도 그 일정 하나만 지운다", async () => {
  const { app, env, sqlite } = setup();
  const response = await remove(app, env, "/api/events/single?scope=following");
  assert.equal(response.status, 200);
  assert.deepEqual(remaining(sqlite), ["other", "s-1", "s-2", "s-3", "s-4"]);
});
