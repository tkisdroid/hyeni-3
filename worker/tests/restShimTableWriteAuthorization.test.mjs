import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { registerHooks } from "node:module";
import { dirname, extname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test, { after } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { exportJWK, generateKeyPair, SignJWT } from "jose";

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

const restShim = (await import(
  pathToFileURL(resolve(workerDir, "routes/rest-shim.ts")).href
)).default;

class D1StatementAdapter {
  constructor(sqlite, sql, bindings = []) {
    this.sqlite = sqlite;
    this.sql = sql;
    this.bindings = bindings;
  }

  bind(...bindings) {
    return new D1StatementAdapter(this.sqlite, this.sql, bindings);
  }

  async first() {
    return this.sqlite.prepare(this.sql).get(...this.bindings) ?? null;
  }

  async all() {
    return { results: this.sqlite.prepare(this.sql).all(...this.bindings) };
  }

  async run() {
    const result = this.sqlite.prepare(this.sql).run(...this.bindings);
    return { success: true, meta: { changes: Number(result.changes ?? 0) }, results: [] };
  }
}

class D1DatabaseAdapter {
  constructor(sqlite) {
    this.sqlite = sqlite;
  }

  prepare(sql) {
    return new D1StatementAdapter(this.sqlite, sql);
  }
}

const { privateKey, publicKey } = await generateKeyPair("ES256", { extractable: true });
const jwtPublicKey = JSON.stringify(await exportJWK(publicKey));

async function accessToken(userId, role, familyId) {
  return new SignJWT({ role, family_id: familyId, is_anonymous: false })
    .setProtectedHeader({ alg: "ES256" })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime("10m")
    .sign(privateKey);
}

function createDb() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`
    CREATE TABLE users(id TEXT PRIMARY KEY);
    CREATE TABLE families(
      id TEXT PRIMARY KEY,
      parent_id TEXT NOT NULL,
      user_tier TEXT DEFAULT 'free',
      subscription_tier TEXT DEFAULT 'free',
      registered_place_alerts_enabled INTEGER DEFAULT 1
    );
    CREATE TABLE family_members(
      id TEXT PRIMARY KEY,
      family_id TEXT NOT NULL,
      user_id TEXT,
      role TEXT NOT NULL,
      name TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      device_health TEXT,
      created_at TEXT,
      last_selected_at TEXT
    );
    CREATE TABLE family_subscription(
      family_id TEXT PRIMARY KEY,
      status TEXT,
      remote_listen_enabled INTEGER DEFAULT 1,
      purchase_token_hash TEXT
    );
    CREATE TABLE saved_places(
      id TEXT PRIMARY KEY,
      family_id TEXT NOT NULL,
      name TEXT,
      location TEXT
    );
    CREATE TABLE academies(
      id TEXT PRIMARY KEY,
      family_id TEXT NOT NULL,
      name TEXT,
      location TEXT,
      schedule TEXT
    );
    CREATE TABLE force_ring_events(
      id TEXT PRIMARY KEY,
      family_id TEXT NOT NULL,
      initiator_user_id TEXT,
      target_user_id TEXT,
      triggered_at TEXT NOT NULL,
      delivered_at TEXT,
      stopped_at TEXT,
      stop_reason TEXT,
      delivery_status TEXT DEFAULT '{}'
    );
    CREATE TABLE fcm_tokens(
      id TEXT PRIMARY KEY,
      family_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      fcm_token TEXT NOT NULL,
      platform TEXT,
      registration_instance_id TEXT,
      created_at TEXT,
      updated_at TEXT,
      disabled_at TEXT,
      disabled_reason TEXT
    );
    CREATE UNIQUE INDEX idx_fcm_tokens_token_active_unique
      ON fcm_tokens(fcm_token) WHERE disabled_at IS NULL;
    CREATE TABLE account_mutation_leases(
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      family_id TEXT,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE account_deletion_scopes(
      scope_type TEXT NOT NULL,
      scope_id TEXT NOT NULL,
      PRIMARY KEY(scope_type, scope_id)
    );
    CREATE TABLE family_unpair_cleanup_jobs(
      id TEXT PRIMARY KEY,
      family_id TEXT NOT NULL,
      child_user_id TEXT NOT NULL
    );
  `);

  for (const userId of ["parent-a", "child-a", "child-sibling", "parent-b", "child-b"]) {
    sqlite.prepare("INSERT INTO users(id) VALUES (?)").run(userId);
  }
  sqlite.prepare("INSERT INTO families(id,parent_id) VALUES (?,?)").run("family-a", "parent-a");
  sqlite.prepare("INSERT INTO families(id,parent_id) VALUES (?,?)").run("family-b", "parent-b");

  const insertMember = sqlite.prepare(
    "INSERT INTO family_members(id,family_id,user_id,role,name,is_active) VALUES (?,?,?,?,?,1)",
  );
  insertMember.run("member-parent-a", "family-a", "parent-a", "parent", "보호자 A");
  insertMember.run("member-child-a", "family-a", "child-a", "child", "아이 A");
  insertMember.run("member-child-sibling", "family-a", "child-sibling", "child", "아이 A2");
  insertMember.run("member-parent-b", "family-b", "parent-b", "parent", "보호자 B");
  insertMember.run("member-child-b", "family-b", "child-b", "child", "아이 B");

  sqlite.prepare(
    "INSERT INTO family_subscription(family_id,status,remote_listen_enabled,purchase_token_hash) VALUES (?,?,?,?)",
  ).run("family-b", "active", 1, "victim-purchase-hash");
  sqlite.prepare(
    "INSERT INTO force_ring_events(id,family_id,initiator_user_id,target_user_id,triggered_at,delivered_at) VALUES (?,?,?,?,?,?)",
  ).run("ring-child-a", "family-a", "parent-a", "child-a", "2026-08-01T00:00:00.000Z", "2026-08-01T00:00:01.000Z");
  sqlite.prepare(
    "INSERT INTO force_ring_events(id,family_id,initiator_user_id,target_user_id,triggered_at,delivered_at) VALUES (?,?,?,?,?,?)",
  ).run("ring-sibling", "family-a", "parent-a", "child-sibling", "2026-08-01T00:01:00.000Z", "2026-08-01T00:01:01.000Z");
  sqlite.prepare(
    "INSERT INTO force_ring_events(id,family_id,initiator_user_id,target_user_id,triggered_at,delivered_at) VALUES (?,?,?,?,?,?)",
  ).run("ring-family-b", "family-b", "parent-b", "child-b", "2026-08-01T00:02:00.000Z", "2026-08-01T00:02:01.000Z");

  return { sqlite, db: new D1DatabaseAdapter(sqlite) };
}

function envFor(db) {
  return {
    DB: db,
    JWT_PUBLIC_KEY: jwtPublicKey,
    PUSH_INTERNAL_SECRET: "rest-shim-test-internal-secret",
  };
}

async function userRequest(env, token, path, method, body) {
  return restShim.request(path, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  }, env);
}

test("일반 PATCH는 families.parent_id와 대소문자 변형 id/family_id를 바꿀 수 없다", async () => {
  const { sqlite, db } = createDb();
  const env = envFor(db);
  const childToken = await accessToken("child-a", "child", "family-a");

  const parentTakeover = await userRequest(
    env,
    childToken,
    "/rest/v1/families?id=eq.family-a",
    "PATCH",
    { parent_id: "child-a" },
  );
  assert.equal(parentTakeover.status, 403);
  assert.equal(sqlite.prepare("SELECT parent_id FROM families WHERE id='family-a'").get().parent_id, "parent-a");

  const familyMove = await userRequest(
    env,
    childToken,
    "/rest/v1/family_members?id=eq.member-child-a",
    "PATCH",
    { Family_ID: "family-b" },
  );
  assert.equal(familyMove.status, 403);
  assert.equal(sqlite.prepare("SELECT family_id FROM family_members WHERE id='member-child-a'").get().family_id, "family-a");

  const idChange = await userRequest(
    env,
    childToken,
    "/rest/v1/family_members?id=eq.member-child-a",
    "PATCH",
    { ID: "member-stolen" },
  );
  assert.equal(idChange.status, 403);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM family_members WHERE id='member-child-a'").get().count, 1);
  sqlite.close();
});

test("일반 PATCH는 구독을 다른 가족으로 이동하거나 force-ring 쿼터 근거·대상을 변조할 수 없다", async () => {
  const { sqlite, db } = createDb();
  const env = envFor(db);
  const parentToken = await accessToken("parent-a", "parent", "family-a");

  sqlite.prepare(
    "INSERT INTO family_subscription(family_id,status,remote_listen_enabled,purchase_token_hash) VALUES (?,?,?,?)",
  ).run("family-a", "active", 1, "attacker-purchase-hash");
  const subscriptionMove = await userRequest(
    env,
    parentToken,
    "/rest/v1/family_subscription?family_id=eq.family-a",
    "PATCH",
    { Family_ID: "family-c" },
  );
  assert.equal(subscriptionMove.status, 403);
  assert.equal(sqlite.prepare("SELECT family_id FROM family_subscription WHERE purchase_token_hash='attacker-purchase-hash'").get().family_id, "family-a");

  const quotaReset = await userRequest(
    env,
    parentToken,
    "/rest/v1/force_ring_events?id=eq.ring-child-a",
    "PATCH",
    {
      delivered_at: null,
      triggered_at: "2000-01-01T00:00:00.000Z",
      target_user_id: "parent-a",
      initiator_user_id: "child-a",
    },
  );
  assert.equal(quotaReset.status, 403);
  const ring = sqlite.prepare(
    "SELECT triggered_at,delivered_at,target_user_id,initiator_user_id FROM force_ring_events WHERE id='ring-child-a'",
  ).get();
  assert.deepEqual({ ...ring }, {
    triggered_at: "2026-08-01T00:00:00.000Z",
    delivered_at: "2026-08-01T00:00:01.000Z",
    target_user_id: "child-a",
    initiator_user_id: "parent-a",
  });
  sqlite.close();
});

test("아이 Android의 device_health와 자기 force-ring 자동 종료만 PATCH된다", async () => {
  const { sqlite, db } = createDb();
  const env = envFor(db);
  const childToken = await accessToken("child-a", "child", "family-a");

  const ownHealth = await userRequest(
    env,
    childToken,
    "/rest/v1/family_members?family_id=eq.family-a&user_id=eq.child-a",
    "PATCH",
    { device_health: { batteryLevel: 75 } },
  );
  assert.equal(ownHealth.status, 204);
  assert.equal(
    JSON.parse(sqlite.prepare("SELECT device_health FROM family_members WHERE user_id='child-a'").get().device_health).batteryLevel,
    75,
  );

  const siblingHealth = await userRequest(
    env,
    childToken,
    "/rest/v1/family_members?id=eq.member-child-sibling",
    "PATCH",
    { device_health: { batteryLevel: 1 } },
  );
  assert.equal(siblingHealth.status, 204);
  assert.equal(sqlite.prepare("SELECT device_health FROM family_members WHERE id='member-child-sibling'").get().device_health, null);

  const duplicateCasing = await userRequest(
    env,
    childToken,
    "/rest/v1/family_members?id=eq.member-child-a",
    "PATCH",
    { device_health: { batteryLevel: 80 }, Device_Health: { batteryLevel: 0 } },
  );
  assert.equal(duplicateCasing.status, 400);
  assert.equal(
    JSON.parse(sqlite.prepare("SELECT device_health FROM family_members WHERE user_id='child-a'").get().device_health).batteryLevel,
    75,
  );

  const ownStop = await userRequest(
    env,
    childToken,
    "/rest/v1/force_ring_events?id=eq.ring-child-a&stopped_at=is.null",
    "PATCH",
    { stopped_at: "2000-01-01T00:00:00.000Z", stop_reason: "auto_timeout" },
  );
  assert.equal(ownStop.status, 204);
  const ownRing = sqlite.prepare("SELECT stopped_at,stop_reason FROM force_ring_events WHERE id='ring-child-a'").get();
  assert.notEqual(ownRing.stopped_at, null);
  assert.notEqual(ownRing.stopped_at, "2000-01-01T00:00:00.000Z");
  assert.equal(ownRing.stop_reason, "auto_timeout");

  const siblingStop = await userRequest(
    env,
    childToken,
    "/rest/v1/force_ring_events?id=eq.ring-sibling&stopped_at=is.null",
    "PATCH",
    { stopped_at: "2026-08-01T00:03:00.000Z", stop_reason: "auto_timeout" },
  );
  assert.equal(siblingStop.status, 204);
  assert.equal(sqlite.prepare("SELECT stopped_at FROM force_ring_events WHERE id='ring-sibling'").get().stopped_at, null);
  sqlite.close();
});

test("일반 POST/upsert는 가족·멤버십·구독·force-ring 행을 탈취하거나 이동할 수 없다", async () => {
  const { sqlite, db } = createDb();
  const env = envFor(db);
  const childToken = await accessToken("child-a", "child", "family-a");
  const parentToken = await accessToken("parent-a", "parent", "family-a");

  const familyTakeover = await userRequest(
    env,
    childToken,
    "/rest/v1/families?on_conflict=id",
    "POST",
    { id: "family-a", parent_id: "child-a" },
  );
  assert.equal(familyTakeover.status, 403);

  const memberMove = await userRequest(
    env,
    parentToken,
    "/rest/v1/family_members?on_conflict=id",
    "POST",
    { id: "member-child-b", family_id: "family-a", name: "탈취" },
  );
  assert.equal(memberMove.status, 403);

  const subscriptionMove = await userRequest(
    env,
    parentToken,
    "/rest/v1/family_subscription?on_conflict=remote_listen_enabled",
    "POST",
    { family_id: "family-a", remote_listen_enabled: 1 },
  );
  assert.equal(subscriptionMove.status, 403);

  const ringMove = await userRequest(
    env,
    parentToken,
    "/rest/v1/force_ring_events?on_conflict=id",
    "POST",
    {
      id: "ring-family-b",
      family_id: "family-a",
      target_user_id: "child-a",
      triggered_at: "2000-01-01T00:00:00.000Z",
    },
  );
  assert.equal(ringMove.status, 403);

  const duplicateFcmScope = await userRequest(
    env,
    childToken,
    "/rest/v1/fcm_tokens?on_conflict=user_id,fcm_token",
    "POST",
    {
      family_id: "family-a",
      Family_ID: "family-b",
      user_id: "child-a",
      fcm_token: "duplicate-scope-token",
      platform: "android",
    },
  );
  assert.equal(duplicateFcmScope.status, 400);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM fcm_tokens").get().count, 0);

  const validFcmRegistration = await userRequest(
    env,
    childToken,
    "/rest/v1/fcm_tokens?on_conflict=user_id,fcm_token",
    "POST",
    {
      family_id: "family-a",
      user_id: "child-a",
      fcm_token: "child-a-current-token",
      platform: "android",
      registration_instance_id: "install-child-a",
    },
  );
  assert.equal(validFcmRegistration.status, 201);
  assert.deepEqual(
    { ...sqlite.prepare("SELECT family_id,user_id,fcm_token FROM fcm_tokens").get() },
    {
      family_id: "family-a",
      user_id: "child-a",
      fcm_token: "child-a-current-token",
    },
  );

  assert.equal(sqlite.prepare("SELECT parent_id FROM families WHERE id='family-a'").get().parent_id, "parent-a");
  assert.equal(sqlite.prepare("SELECT family_id,name FROM family_members WHERE id='member-child-b'").get().family_id, "family-b");
  assert.equal(sqlite.prepare("SELECT family_id FROM family_subscription WHERE purchase_token_hash='victim-purchase-hash'").get().family_id, "family-b");
  const victimRing = sqlite.prepare("SELECT family_id,target_user_id,triggered_at FROM force_ring_events WHERE id='ring-family-b'").get();
  assert.deepEqual({ ...victimRing }, {
    family_id: "family-b",
    target_user_id: "child-b",
    triggered_at: "2026-08-01T00:02:00.000Z",
  });
  sqlite.close();
});

test("service-role POST/PATCH는 기존 generic 운영 쓰기를 유지한다", async () => {
  const { sqlite, db } = createDb();
  const env = envFor(db);
  sqlite.prepare("INSERT INTO users(id) VALUES (?)").run("service-parent");
  const headers = {
    "x-internal-secret": "rest-shim-test-internal-secret",
    "Content-Type": "application/json",
  };

  const patchResponse = await restShim.request(
    "/rest/v1/families?id=eq.family-a",
    {
      method: "PATCH",
      headers,
      body: JSON.stringify({ parent_id: "service-parent" }),
    },
    env,
  );
  assert.equal(patchResponse.status, 204);
  assert.equal(sqlite.prepare("SELECT parent_id FROM families WHERE id='family-a'").get().parent_id, "service-parent");

  const postResponse = await restShim.request(
    "/rest/v1/force_ring_events",
    {
      method: "POST",
      headers,
      body: JSON.stringify({
        id: "ring-service",
        family_id: "family-a",
        initiator_user_id: "parent-a",
        target_user_id: "child-a",
        triggered_at: "2026-08-01T01:00:00.000Z",
      }),
    },
    env,
  );
  assert.equal(postResponse.status, 201);
  assert.equal(sqlite.prepare("SELECT family_id FROM force_ring_events WHERE id='ring-service'").get().family_id, "family-a");
  sqlite.close();
});
