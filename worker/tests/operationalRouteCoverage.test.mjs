import "./helpers/tsModuleResolve.mjs";

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { Hono } from "hono";

const workerDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoDir = resolve(workerDir, "..");
const forceRingRoutes = (await import("../routes/force-ring.ts")).default;
const sosRoutes = (await import("../routes/sos.ts")).default;
const subscriptionRoutes = (await import("../routes/subscriptions.ts")).default;
const smsRoutes = (await import("../routes/send-sms.ts")).default;

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
    return { success: true, meta: { changes: Number(result.changes ?? 0) } };
  }
}

class Db {
  constructor(sqlite) {
    this.sqlite = sqlite;
  }

  prepare(sql) {
    return new Statement(this.sqlite, sql);
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
  sqlite.exec(readFileSync(resolve(repoDir, "cloudflare/schema_d1.sql"), "utf8"));
  for (const userId of ["parent-a", "child-a", "parent-b"]) {
    sqlite.prepare("INSERT INTO users(id,is_anonymous) VALUES (?,0)").run(userId);
  }
  sqlite.prepare(
    "INSERT INTO families(id,parent_id,pair_code,created_at) VALUES (?,?,?,?)",
  ).run("family-a", "parent-a", "KID-FAMILYA", "2026-08-31 00:00:00+00");
  sqlite.prepare(
    "INSERT INTO families(id,parent_id,pair_code,created_at) VALUES (?,?,?,?)",
  ).run("family-b", "parent-b", "KID-FAMILYB", "2026-08-31 00:00:00+00");
  const addMember = sqlite.prepare(
    `INSERT INTO family_members
       (id,family_id,user_id,role,name,phone,is_active,created_at)
     VALUES (?,?,?,?,?,'',1,'2026-08-31 00:00:00+00')`,
  );
  addMember.run("member-parent-a", "family-a", "parent-a", "parent", "부모 A");
  addMember.run("member-child-a", "family-a", "child-a", "child", "아이 A");
  addMember.run("member-parent-b", "family-b", "parent-b", "parent", "부모 B");
  return { sqlite, db: new Db(sqlite) };
}

async function authorization(sub, familyId, role) {
  const token = await new SignJWT({ role, family_id: familyId, is_anonymous: false })
    .setProtectedHeader({ alg: "ES256" })
    .setSubject(sub)
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(privateKey);
  return `Bearer ${token}`;
}

function environment(db, extra = {}) {
  return {
    DB: db,
    JWT_PRIVATE_KEY: jwtPrivateKey,
    JWT_PUBLIC_KEY: jwtPublicKey,
    ...extra,
  };
}

const app = new Hono();
app.route("/api/force-ring", forceRingRoutes);
app.route("/api/sos", sosRoutes);
app.route("/api/subscriptions", subscriptionRoutes);
app.route("/api/sms", smsRoutes);

test("force-ring active/history/quota와 subscriptions는 인증 가족만 읽고 timestamp를 ISO로 돌린다", async () => {
  const { sqlite, db } = createDb();
  const now = new Date();
  const activeAt = new Date(now.getTime() - 60_000).toISOString().replace("T", " ").replace("Z", "+00");
  const stoppedAt = new Date(now.getTime() - 20 * 60_000).toISOString().replace("T", " ").replace("Z", "+00");
  sqlite.prepare(
    `INSERT INTO force_ring_events
       (id,family_id,initiator_user_id,target_user_id,message,triggered_at)
     VALUES ('ring-active','family-a','parent-a','child-a','지금 울리기',?)`,
  ).run(activeAt);
  sqlite.prepare(
    `INSERT INTO force_ring_events
       (id,family_id,initiator_user_id,target_user_id,message,triggered_at,stopped_at,stop_reason)
     VALUES ('ring-stopped','family-a','parent-a','child-a','이전 울리기',?,?,'parent_stop')`,
  ).run(stoppedAt, stoppedAt);
  sqlite.prepare(
    `INSERT INTO subscriptions
       (id,family_id,child_id,status,expires_at,product_id,price_krw,created_at,updated_at)
     VALUES ('sub-a','family-a','child-a','expired','2025-09-30 00:00:00+00','legacy',0,
             '2026-08-01 00:00:00+00','2026-08-02 00:00:00+00')`,
  ).run();
  const auth = await authorization("parent-a", "family-a", "parent");
  const env = environment(db);

  const active = await app.request(
    "http://test.local/api/force-ring/active?family_id=family-a",
    { headers: { authorization: auth } },
    env,
  );
  assert.equal(active.status, 200, await active.clone().text());
  const activeBody = await active.json();
  assert.equal(activeBody.id, "ring-active");
  assert.match(activeBody.triggered_at, /^\d{4}-\d{2}-\d{2}T.*(?:Z|\+00:00)$/);

  const history = await app.request(
    "http://test.local/api/force-ring/history?family_id=family-a&limit=1",
    { headers: { authorization: auth } },
    env,
  );
  assert.equal(history.status, 200, await history.clone().text());
  assert.deepEqual((await history.json()).map((row) => row.id), ["ring-active"]);

  const quota = await app.request(
    "http://test.local/api/force-ring/quota?family_id=family-a",
    { headers: { authorization: auth } },
    env,
  );
  assert.equal(quota.status, 200, await quota.clone().text());
  assert.deepEqual(await quota.json(), { allowed: false, quota: 1, used: 1, tier: "free" });

  const subscriptions = await app.request(
    "http://test.local/api/subscriptions?family_id=family-a",
    { headers: { authorization: auth } },
    env,
  );
  assert.equal(subscriptions.status, 200, await subscriptions.clone().text());
  const rows = await subscriptions.json();
  assert.equal(rows[0].id, "sub-a");
  assert.equal(rows[0].expires_at, "2025-09-30T00:00:00+00:00");

  for (const path of ["force-ring/active", "subscriptions"]) {
    const foreign = await app.request(
      `http://test.local/api/${path}?family_id=family-b`,
      { headers: { authorization: auth } },
      env,
    );
    assert.equal(foreign.status, 403, path);
  }
  sqlite.close();
});

test("SOS audit receiver는 요청 body가 아니라 가족의 활성 부모 목록을 서버에서 정한다", async () => {
  const { sqlite, db } = createDb();
  const auth = await authorization("child-a", "family-a", "child");
  const response = await app.request("http://test.local/api/sos/events", {
    method: "POST",
    headers: { authorization: auth, "content-type": "application/json" },
    body: JSON.stringify({
      family_id: "family-a",
      sender_user_id: "child-a",
      receiver_user_ids: ["parent-b", "forged-user"],
      delivery_status: { alert: "sent", location: "failed" },
      client_request_hash: "sos-route-test",
    }),
  }, environment(db));
  assert.equal(response.status, 200, await response.clone().text());
  const stored = sqlite.prepare(
    "SELECT receiver_user_ids,delivery_status FROM sos_events WHERE client_request_hash='sos-route-test'",
  ).get();
  assert.equal(stored.receiver_user_ids, "{parent-a}");
  assert.deepEqual(JSON.parse(stored.delivery_status), { alert: "sent", location: "failed" });

  const cooldown = await app.request("http://test.local/api/sos/kkuk-cooldown", {
    headers: { authorization: auth },
  }, environment(db));
  assert.equal(cooldown.status, 200, await cooldown.clone().text());
  assert.equal(await cooldown.json(), false);

  const spoofed = await app.request("http://test.local/api/sos/events", {
    method: "POST",
    headers: { authorization: auth, "content-type": "application/json" },
    body: JSON.stringify({ family_id: "family-a", sender_user_id: "parent-a" }),
  }, environment(db));
  assert.equal(spoofed.status, 403);
  sqlite.close();
});

test("send-sms는 내부 secret·설정·입력을 순서대로 닫고 provider 실패를 재시도 가능하게 반환한다", async (t) => {
  const unauthorized = await app.request("http://test.local/api/sms/send", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ phone: "01012345678", otp: "123456" }),
  }, { PUSH_INTERNAL_SECRET: "internal-secret" });
  assert.equal(unauthorized.status, 401);

  const missingConfig = await app.request("http://test.local/api/sms/send", {
    method: "POST",
    headers: { "content-type": "application/json", "x-internal-secret": "internal-secret" },
    body: JSON.stringify({ phone: "01012345678", otp: "123456" }),
  }, { PUSH_INTERNAL_SECRET: "internal-secret" });
  assert.equal(missingConfig.status, 500);
  assert.deepEqual(await missingConfig.json(), { error: "ncp_sens_not_configured" });

  const configured = {
    PUSH_INTERNAL_SECRET: "internal-secret",
    NCP_SENS_ACCESS_KEY: "access",
    NCP_SENS_SECRET_KEY: "secret",
    NCP_SENS_SERVICE_ID: "service",
    NCP_SENS_FROM_NUMBER: "0212345678",
  };
  const invalid = await app.request("http://test.local/api/sms/send", {
    method: "POST",
    headers: { "content-type": "application/json", "x-internal-secret": "internal-secret" },
    body: JSON.stringify({ phone: "01012345678", otp: "12" }),
  }, configured);
  assert.equal(invalid.status, 400);

  t.mock.method(globalThis, "fetch", async () => new Response("provider unavailable", { status: 500 }));
  t.mock.method(console, "error", () => {});
  const providerFailure = await app.request("http://test.local/api/sms/send", {
    method: "POST",
    headers: { "content-type": "application/json", "x-internal-secret": "internal-secret" },
    body: JSON.stringify({ phone: "+821012345678", otp: "123456" }),
  }, configured);
  assert.equal(providerFailure.status, 503);
  assert.equal(providerFailure.headers.get("Retry-After"), "5");
  assert.deepEqual(await providerFailure.json(), { error: "sms_provider_failed" });
});
