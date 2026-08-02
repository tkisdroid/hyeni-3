import test, { after } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { registerHooks } from "node:module";
import { dirname, extname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
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

const { dispatchRpc } = await import(
  pathToFileURL(resolve(workerDir, "routes/rest-shim-rpc.ts")).href
);

class D1Statement {
  constructor(db, sql, bindings = []) {
    this.db = db;
    this.sql = sql;
    this.bindings = bindings;
  }

  bind(...bindings) {
    return new D1Statement(this.db, this.sql, bindings);
  }

  async first() {
    return this.db.sqlite.prepare(this.sql).get(...this.bindings) ?? null;
  }

  async all() {
    return { results: this.db.sqlite.prepare(this.sql).all(...this.bindings) };
  }

  async run() {
    const result = this.db.sqlite.prepare(this.sql).run(...this.bindings);
    return { success: true, meta: { changes: Number(result.changes ?? 0) } };
  }
}

class D1DatabaseAdapter {
  constructor(sqlite) {
    this.sqlite = sqlite;
  }

  prepare(sql) {
    return new D1Statement(this, sql);
  }

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

function createDb() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`
    CREATE TABLE families(id TEXT PRIMARY KEY,parent_id TEXT NOT NULL);
    CREATE TABLE family_members(
      id TEXT PRIMARY KEY,family_id TEXT NOT NULL,user_id TEXT,
      role TEXT NOT NULL,is_active INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE child_location_link_state(
      family_id TEXT NOT NULL,child_user_id TEXT NOT NULL,
      last_shutdown_at TEXT,updated_at TEXT,
      PRIMARY KEY(family_id,child_user_id)
    );
    CREATE TABLE force_ring_events(
      id TEXT PRIMARY KEY,family_id TEXT NOT NULL,target_user_id TEXT,
      acknowledged_at TEXT,stopped_at TEXT,stop_reason TEXT
    );
    INSERT INTO families(id,parent_id) VALUES ('family-1','parent-1'),('family-2','parent-2');
    INSERT INTO family_members(id,family_id,user_id,role,is_active) VALUES
      ('parent-member-1','family-1','parent-1','parent',1),
      ('child-member-1','family-1','child-1','child',1),
      ('child-member-2','family-1','child-2','child',1),
      ('intruder-member','family-2','intruder','parent',1);
  `);
  return { sqlite, db: new D1DatabaseAdapter(sqlite) };
}

function context(db, payload) {
  return {
    env: {
      DB: db,
      FAMILY_ROOM: {
        idFromName(value) { return value; },
        get() { return { fetch: async () => new Response(null, { status: 204 }) }; },
      },
    },
    req: { json: async () => payload },
    executionCtx: { waitUntil() {} },
    json(value, status = 200) { return Response.json(value, { status }); },
    body(value, status = 200) { return new Response(value, { status }); },
  };
}

test("record_child_shutdown은 비-service 호출자의 정확한 활성 child 본인만 허용한다", async () => {
  const { sqlite, db } = createDb();
  const response = await dispatchRpc(
    context(db, { p_family_id: "family-1", p_child_user_id: "child-1" }),
    "record_child_shutdown",
    { serviceRole: false, sub: "intruder", familyIds: ["family-2"] },
  );

  assert.equal(response.status, 403);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM child_location_link_state").get().n, 0);
  sqlite.close();
});

test("record_child_shutdown은 호출자 본인 ID여도 요청 가족의 활성 child가 아니면 거부한다", async () => {
  const { sqlite, db } = createDb();
  const response = await dispatchRpc(
    context(db, { p_family_id: "family-2", p_child_user_id: "child-1" }),
    "record_child_shutdown",
    { serviceRole: false, sub: "child-1", familyIds: ["family-1"] },
  );

  assert.equal(response.status, 403);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM child_location_link_state").get().n, 0);
  sqlite.close();
});

test("targeted force ring은 형제 child가 ACK할 수 없다", async () => {
  const { sqlite, db } = createDb();
  sqlite.prepare(
    "INSERT INTO force_ring_events(id,family_id,target_user_id) VALUES ('ring-targeted','family-1','child-2')",
  ).run();

  const response = await dispatchRpc(
    context(db, { p_event_id: "ring-targeted" }),
    "force_ring_acknowledge",
    { serviceRole: false, sub: "child-1", familyIds: ["family-1"] },
  );

  assert.deepEqual(await response.json(), { error: "forbidden" });
  assert.equal(sqlite.prepare(
    "SELECT acknowledged_at FROM force_ring_events WHERE id='ring-targeted'",
  ).get().acknowledged_at, null);
  sqlite.close();
});

test("target이 없는 legacy force ring은 같은 가족의 활성 child가 ACK할 수 있다", async () => {
  const { sqlite, db } = createDb();
  sqlite.prepare(
    "INSERT INTO force_ring_events(id,family_id,target_user_id) VALUES ('ring-legacy','family-1',NULL)",
  ).run();

  const response = await dispatchRpc(
    context(db, { p_event_id: "ring-legacy" }),
    "force_ring_acknowledge",
    { serviceRole: false, sub: "child-1", familyIds: ["family-1"] },
  );

  assert.equal((await response.json()).ok, true);
  assert.notEqual(sqlite.prepare(
    "SELECT acknowledged_at FROM force_ring_events WHERE id='ring-legacy'",
  ).get().acknowledged_at, null);
  sqlite.close();
});
