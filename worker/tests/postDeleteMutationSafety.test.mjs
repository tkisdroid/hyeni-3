import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { dirname, extname, resolve } from "node:path";
import test, { after } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath, pathToFileURL } from "node:url";
import { exportJWK, exportPKCS8, generateKeyPair, SignJWT } from "jose";
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

const requireAuth = (
  await import(pathToFileURL(resolve(workerDir, "middleware/auth.ts")).href)
).requireAuth;
const beginAccountDeletionClaim = (
  await import(pathToFileURL(resolve(workerDir, "lib/accountDeletionClaims.ts")).href)
).beginAccountDeletionClaim;
const notifSettingsRoutes = (
  await import(pathToFileURL(resolve(workerDir, "routes/notif-settings.ts")).href)
).default;
const familyRoutes = (
  await import(pathToFileURL(resolve(workerDir, "routes/family.ts")).href)
).default;
const handleInstantNotification = (
  await import(pathToFileURL(resolve(workerDir, "routes/push-notify.ts")).href)
).handleInstantNotification;
const teacherWriteRoutes = (
  await import(pathToFileURL(resolve(workerDir, "routes/teacher-write.ts")).href)
).default;

class Statement {
  constructor(db, sql, bindings = [], owner = null) {
    this.db = db;
    this.sql = sql;
    this.bindings = bindings;
    this.owner = owner;
  }

  bind(...bindings) {
    return new Statement(this.db, this.sql, bindings, this.owner);
  }

  async first() {
    await this.owner?.beforeRun?.(this);
    return this.db.prepare(this.sql).get(...this.bindings) ?? null;
  }

  async all() {
    return { results: this.db.prepare(this.sql).all(...this.bindings) };
  }

  async run() {
    await this.owner?.beforeRun?.(this);
    const result = this.db.prepare(this.sql).run(...this.bindings);
    return { success: true, meta: { changes: Number(result.changes) } };
  }
}

class Db {
  constructor(sqlite) {
    this.sqlite = sqlite;
  }

  prepare(sql) {
    return new Statement(this.sqlite, sql, [], this);
  }

  async beforeRun() {}

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

class PausingWriteDb extends Db {
  constructor(sqlite, sqlFragment) {
    super(sqlite);
    this.sqlFragment = sqlFragment;
    this.writeStarted = new Promise((resolveStarted) => {
      this.resolveStarted = resolveStarted;
    });
    this.resumePromise = new Promise((resolveResume) => {
      this.resolveResume = resolveResume;
    });
    this.paused = false;
  }

  async beforeRun(statement) {
    if (this.paused || !statement.sql.includes(this.sqlFragment)) return;
    this.paused = true;
    this.resolveStarted();
    await this.resumePromise;
  }

  resume() {
    this.resolveResume();
  }
}

class ConcurrentQuietSettingsDb extends Db {
  constructor(sqlite) {
    super(sqlite);
    this.injected = false;
  }

  async beforeRun(statement) {
    if (this.injected || !/INSERT INTO notification_settings/i.test(statement.sql)) return;
    this.injected = true;
    this.sqlite.prepare(
      `INSERT INTO notification_settings
        (user_id,family_id,child_enabled,parent_enabled,location_enabled,
         registered_place_enabled,playdate_enabled,minutes_before,updated_at)
       VALUES (?,?,?,?,?,?,?,?,?)`,
    ).run(
      "quiet-child",
      "quiet-family",
      0,
      0,
      0,
      0,
      0,
      "{30}",
      "2026-07-19T12:10:00.000Z",
    );
  }
}

class ReverseQuietWriteDb extends Db {
  constructor(sqlite) {
    super(sqlite);
    this.quietWriteCount = 0;
    this.firstQuietWriteStarted = new Promise((resolveStarted) => {
      this.resolveFirstQuietWriteStarted = resolveStarted;
    });
    this.resumeFirstQuietWrite = new Promise((resolveResume) => {
      this.resolveResumeFirstQuietWrite = resolveResume;
    });
  }

  async beforeRun(statement) {
    if (!/INSERT INTO notification_settings/i.test(statement.sql)) return;
    this.quietWriteCount += 1;
    if (this.quietWriteCount !== 1) return;
    this.resolveFirstQuietWriteStarted();
    await this.resumeFirstQuietWrite;
  }

  resume() {
    this.resolveResumeFirstQuietWrite();
  }
}

function createSqlite() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(readFileSync(resolve(repoDir, "cloudflare/schema_d1.sql"), "utf8"));
  return sqlite;
}

function addUser(sqlite, userId) {
  sqlite.prepare("INSERT INTO users(id,is_anonymous) VALUES (?,0)").run(userId);
}

function beginDeletion(sqlite, userId) {
  const jobId = `delete-${userId}`;
  sqlite.prepare(
    `INSERT INTO account_deletion_jobs
      (id,owner_user_id,mode,status,attempts,created_at,updated_at)
     VALUES (?,?,'self','claimed',0,'2026-07-14','2026-07-14')`,
  ).run(jobId, userId);
  sqlite.prepare(
    `INSERT INTO account_deletion_scopes(job_id,scope_type,scope_id,created_at)
     VALUES (?,'user',?,'2026-07-14')`,
  ).run(jobId, userId);
}

function beginFamilyDeletion(sqlite, familyId) {
  const jobId = `delete-family-${familyId}`;
  sqlite.prepare(
    `INSERT INTO account_deletion_jobs
      (id,owner_user_id,mode,status,attempts,created_at,updated_at)
     VALUES (?,?,'family','claimed',0,'2026-07-14','2026-07-14')`,
  ).run(jobId, `owner-${familyId}`);
  sqlite.prepare(
    `INSERT INTO account_deletion_scopes(job_id,scope_type,scope_id,created_at)
     VALUES (?,'family',?,'2026-07-14')`,
  ).run(jobId, familyId);
}

const { privateKey, publicKey } = await generateKeyPair("ES256", { extractable: true });
const jwtPrivateKey = JSON.stringify(await exportJWK(privateKey));
const jwtPublicKey = JSON.stringify(await exportJWK(publicKey));

async function authorization(userId, { role = "teacher", familyId = null } = {}) {
  const token = await new SignJWT({ role, family_id: familyId, is_anonymous: false })
    .setProtectedHeader({ alg: "ES256" })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(privateKey);
  return `Bearer ${token}`;
}

function env(db, { realtimeEnvelopes = [] } = {}) {
  return {
    DB: db,
    JWT_PRIVATE_KEY: jwtPrivateKey,
    JWT_PUBLIC_KEY: jwtPublicKey,
    FAMILY_ROOM: {
      idFromName: (name) => name,
      get: () => ({
        fetch: async (input, init) => {
          realtimeEnvelopes.push({
            url: String(input),
            body: JSON.parse(String(init?.body ?? "null")),
          });
          return new Response(null, { status: 204 });
        },
      }),
    },
  };
}

function createExecutionContext() {
  const waitUntilPromises = [];
  return {
    waitUntilPromises,
    waitUntil(promise) {
      waitUntilPromises.push(promise);
    },
    passThroughOnException() {},
    props: {},
  };
}

async function requestJson(app, url, userId, body) {
  return requestApi(app, url, userId, {
    method: "POST",
    body,
  });
}

async function requestApi(app, url, userId, {
  method = "GET",
  body,
  role = "teacher",
  familyId = null,
  executionCtx = createExecutionContext(),
} = {}) {
  const headers = {
    Authorization: await authorization(userId, { role, familyId }),
  };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  return app.request(
    `http://test.local${url}`,
    {
      method,
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    },
    app.env,
    executionCtx,
  );
}

function addQuietHoursFamily(sqlite) {
  for (const userId of [
    "quiet-parent",
    "quiet-co-parent",
    "quiet-child",
    "quiet-inactive-child",
    "other-parent",
    "other-child",
  ]) {
    addUser(sqlite, userId);
  }
  sqlite.prepare(
    "INSERT INTO families(id,parent_id,pair_code) VALUES (?,?,?)",
  ).run("quiet-family", "quiet-parent", "PAIR-QUIET");
  sqlite.prepare(
    "INSERT INTO families(id,parent_id,pair_code) VALUES (?,?,?)",
  ).run("other-family", "other-parent", "PAIR-OTHER");
  const insertMember = sqlite.prepare(
    `INSERT INTO family_members(id,family_id,user_id,role,name,is_active)
     VALUES (?,?,?,?,?,?)`,
  );
  insertMember.run(
    "quiet-co-parent-member",
    "quiet-family",
    "quiet-co-parent",
    "parent",
    "공동 보호자",
    1,
  );
  insertMember.run(
    "quiet-child-member",
    "quiet-family",
    "quiet-child",
    "child",
    "활성 아이",
    1,
  );
  insertMember.run(
    "quiet-inactive-child-member",
    "quiet-family",
    "quiet-inactive-child",
    "child",
    "연결 해제 아이",
    0,
  );
  insertMember.run(
    "other-child-member",
    "other-family",
    "other-child",
    "child",
    "다른 가족 아이",
    1,
  );
  sqlite.prepare(
    `INSERT INTO notification_settings
      (user_id,family_id,quiet_hours_enabled,quiet_hours_start_minute,
       quiet_hours_end_minute,quiet_hours_updated_by,quiet_hours_updated_at)
     VALUES (?,?,?,?,?,?,?)`,
  ).run(
    "quiet-parent",
    "quiet-family",
    1,
    1320,
    420,
    "quiet-parent",
    "2026-07-19T12:00:00.000Z",
  );
}

function quietHoursBody(targetUserId, overrides = {}) {
  return {
    expected_parent_user_id: "quiet-parent",
    family_id: "quiet-family",
    target_user_id: targetUserId,
    enabled: true,
    start_minute: 1320,
    end_minute: 420,
    ...overrides,
  };
}

test("삭제 완료 후 남은 access JWT는 보호 라우트에 들어갈 수 없다", async () => {
  const sqlite = createSqlite();
  const db = new Db(sqlite);
  const app = new Hono();
  app.route("/api/teacher", teacherWriteRoutes);
  app.env = env(db);

  const response = await requestJson(
    app,
    "/api/teacher/profile",
    "deleted-user",
    { display_name: "삭제 후 선생님" },
  );

  assert.equal(response.status, 401, await response.clone().text());
  assert.equal(
    sqlite.prepare("SELECT COUNT(*) AS count FROM teacher_profiles WHERE user_id='deleted-user'").get().count,
    0,
  );
});

test("계정 삭제 claim은 일반 requireAuth 라우트를 막지만 삭제 재시도 경로는 허용한다", async () => {
  const sqlite = createSqlite();
  addUser(sqlite, "deleting-user");
  beginDeletion(sqlite, "deleting-user");
  const db = new Db(sqlite);
  const app = new Hono();
  app.post("/api/protected-write", requireAuth, (c) => c.json({ ok: true }));
  app.post("/api/account/delete", requireAuth, (c) => c.json({ retry: true }));
  const bindings = env(db);
  const headers = { Authorization: await authorization("deleting-user") };

  const blocked = await app.request(
    "http://test.local/api/protected-write",
    { method: "POST", headers },
    bindings,
  );
  const retry = await app.request(
    "http://test.local/api/account/delete",
    { method: "POST", headers },
    bindings,
  );

  assert.equal(blocked.status, 409, await blocked.clone().text());
  assert.deepEqual(await blocked.json(), { error: "account_deletion_in_progress" });
  assert.equal(retry.status, 200, await retry.clone().text());
  assert.deepEqual(await retry.json(), { retry: true });
});

test("삭제 claim 이후 읽기 요청도 막고 완료 tombstone의 계정 삭제 재시도는 허용한다", async () => {
  const sqlite = createSqlite();
  addUser(sqlite, "read-deleting-user");
  beginDeletion(sqlite, "read-deleting-user");
  const db = new Db(sqlite);
  const app = new Hono();
  app.get("/api/protected-read", requireAuth, (c) => c.json({ ok: true }));
  app.post("/api/account/delete", requireAuth, (c) => c.json({ retry: true }));
  const bindings = env(db);
  const headers = { Authorization: await authorization("read-deleting-user") };

  const blockedRead = await app.request(
    "http://test.local/api/protected-read",
    { headers },
    bindings,
  );
  sqlite.prepare(
    "UPDATE account_deletion_jobs SET status='completed' WHERE owner_user_id=?",
  ).run("read-deleting-user");
  sqlite.prepare("DELETE FROM users WHERE id=?").run("read-deleting-user");
  const retry = await app.request(
    "http://test.local/api/account/delete",
    { method: "POST", headers },
    bindings,
  );

  assert.equal(blockedRead.status, 409, await blockedRead.clone().text());
  assert.equal(retry.status, 200, await retry.clone().text());
});

test("downstream 예외를 인증 실패로 오분류하지 않고 mutation lease를 해제한다", async () => {
  const sqlite = createSqlite();
  addUser(sqlite, "downstream-error-user");
  const db = new Db(sqlite);
  const app = new Hono();
  app.onError((_error, c) => c.json({ error: "downstream_failure" }, 500));
  app.post("/api/failing-write", requireAuth, () => {
    throw new Error("downstream failure");
  });
  const response = await app.request(
    "http://test.local/api/failing-write",
    {
      method: "POST",
      headers: { Authorization: await authorization("downstream-error-user") },
    },
    env(db),
  );

  assert.equal(response.status, 500, await response.clone().text());
  assert.deepEqual(await response.json(), { error: "downstream_failure" });
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM account_mutation_leases").get().count, 0);
});

test("JWT family가 비었거나 오래되어도 현재 활성 가족의 삭제 scope를 우회하지 않는다", async () => {
  const sqlite = createSqlite();
  addUser(sqlite, "canonical-child-user");
  sqlite.prepare(
    "INSERT INTO families(id,parent_id,pair_code) VALUES ('canonical-family','canonical-parent','PAIR-CURRENT')",
  ).run();
  sqlite.prepare(
    `INSERT INTO family_members(id,family_id,user_id,role,name)
     VALUES ('canonical-child-member','canonical-family','canonical-child-user','child','혜니')`,
  ).run();
  beginFamilyDeletion(sqlite, "canonical-family");
  const db = new Db(sqlite);
  const app = new Hono();
  app.get("/api/current-read", requireAuth, (c) => c.json({ ok: true }));
  app.post("/api/current-write", requireAuth, (c) => c.json({ ok: true }));
  const bindings = env(db);

  for (const familyId of [null, "stale-family"]) {
    const headers = {
      Authorization: await authorization("canonical-child-user", { role: "child", familyId }),
    };
    const read = await app.request("http://test.local/api/current-read", { headers }, bindings);
    const write = await app.request(
      "http://test.local/api/current-write",
      { method: "POST", headers },
      bindings,
    );
    assert.equal(read.status, 409, `${familyId}: ${await read.clone().text()}`);
    assert.equal(write.status, 409, `${familyId}: ${await write.clone().text()}`);
  }
});

test("알림 설정 INSERT 실행 직전에 계정 삭제가 시작되면 orphan 행을 만들지 않는다", async () => {
  const sqlite = createSqlite();
  addUser(sqlite, "notif-race-user");
  const db = new PausingWriteDb(sqlite, "INSERT INTO notification_settings");
  const app = new Hono();
  app.route("/api/notif-settings", notifSettingsRoutes);
  app.env = env(db);

  const request = requestJson(
    app,
    "/api/notif-settings",
    "notif-race-user",
    {
      expected_user_id: "notif-race-user",
      child_enabled: true,
      parent_enabled: true,
      location_enabled: true,
      registered_place_enabled: true,
      playdate_enabled: true,
      minutes_before: [15, 5],
    },
  );
  await db.writeStarted;
  beginDeletion(sqlite, "notif-race-user");
  db.resume();
  const response = await request;

  assert.equal(response.status, 409, await response.clone().text());
  assert.equal(
    sqlite.prepare("SELECT COUNT(*) AS count FROM notification_settings WHERE user_id='notif-race-user'").get().count,
    0,
  );
});

test("선생님 프로필 INSERT 실행 직전에 계정 삭제가 시작되면 orphan 행을 만들지 않는다", async () => {
  const sqlite = createSqlite();
  addUser(sqlite, "teacher-race-user");
  const db = new PausingWriteDb(sqlite, "INSERT INTO teacher_profiles");
  const app = new Hono();
  app.route("/api/teacher", teacherWriteRoutes);
  app.env = env(db);

  const request = requestJson(
    app,
    "/api/teacher/profile",
    "teacher-race-user",
    { display_name: "경합 선생님" },
  );
  await db.writeStarted;
  beginDeletion(sqlite, "teacher-race-user");
  db.resume();
  const response = await request;

  assert.equal(response.status, 409, await response.clone().text());
  assert.equal(
    sqlite.prepare("SELECT COUNT(*) AS count FROM teacher_profiles WHERE user_id='teacher-race-user'").get().count,
    0,
  );
});

test("알림 설정 UPDATE 직전 기존 가족 삭제가 시작되면 값을 바꾸지 않는다", async () => {
  const sqlite = createSqlite();
  addUser(sqlite, "notif-update-user");
  sqlite.prepare(
    "INSERT INTO families(id,parent_id,pair_code) VALUES ('notif-family','notif-update-user','PAIR-NOTIF')",
  ).run();
  sqlite.prepare(
    `INSERT INTO notification_settings
      (user_id,family_id,child_enabled,parent_enabled,location_enabled,
       registered_place_enabled,playdate_enabled,minutes_before,updated_at)
     VALUES ('notif-update-user','notif-family',1,1,1,1,1,'{15,5}','2026-07-14')`,
  ).run();
  const db = new PausingWriteDb(sqlite, "UPDATE notification_settings");
  const app = new Hono();
  app.route("/api/notif-settings", notifSettingsRoutes);
  app.env = env(db);

  const request = requestJson(
    app,
    "/api/notif-settings",
    "notif-update-user",
    {
      expected_user_id: "notif-update-user",
      family_id: "notif-family",
      child_enabled: false,
      parent_enabled: false,
      location_enabled: false,
      registered_place_enabled: false,
      playdate_enabled: false,
      minutes_before: [],
    },
  );
  await db.writeStarted;
  beginFamilyDeletion(sqlite, "notif-family");
  db.resume();
  const response = await request;

  assert.equal(response.status, 409, await response.clone().text());
  const settings = sqlite.prepare(
    "SELECT child_enabled,minutes_before FROM notification_settings WHERE user_id='notif-update-user'",
  ).get();
  assert.equal(settings.child_enabled, 1);
  assert.equal(settings.minutes_before, "{15,5}");
});

test("self GET은 quiet 정보를 더하고 가족 GET은 호출 부모 본인과 활성 아이만 반환한다", async () => {
  const sqlite = createSqlite();
  addQuietHoursFamily(sqlite);
  const db = new Db(sqlite);
  const app = new Hono();
  app.route("/api/notif-settings", notifSettingsRoutes);
  app.env = env(db);

  const self = await requestApi(app, "/api/notif-settings", "quiet-parent", {
    role: "parent",
    familyId: "quiet-family",
  });
  assert.equal(self.status, 200, await self.clone().text());
  assert.deepEqual((await self.json()).quiet_hours, {
    enabled: true,
    start_minute: 1320,
    end_minute: 420,
    updated_at: "2026-07-19T12:00:00.000Z",
    configured: true,
  });

  const family = await requestApi(
    app,
    "/api/notif-settings/family?family_id=quiet-family",
    "quiet-parent",
    { role: "parent", familyId: "quiet-family" },
  );
  assert.equal(family.status, 200, await family.clone().text());
  assert.deepEqual(await family.json(), {
    family_id: "quiet-family",
    recipients: [
      {
        target_user_id: "quiet-parent",
        role: "parent",
        enabled: true,
        start_minute: 1320,
        end_minute: 420,
        updated_at: "2026-07-19T12:00:00.000Z",
        configured: true,
      },
      {
        target_user_id: "quiet-child",
        role: "child",
        enabled: false,
        start_minute: 1320,
        end_minute: 420,
        updated_at: null,
        configured: false,
      },
    ],
  });

  const coParent = await requestApi(
    app,
    "/api/notif-settings/family?family_id=quiet-family",
    "quiet-co-parent",
    { role: "parent", familyId: "quiet-family" },
  );
  assert.equal(coParent.status, 200, await coParent.clone().text());
  assert.deepEqual(
    (await coParent.json()).recipients.map((row) => row.target_user_id),
    ["quiet-co-parent", "quiet-child"],
  );

  const child = await requestApi(
    app,
    "/api/notif-settings/family?family_id=quiet-family",
    "quiet-child",
    { role: "child", familyId: "quiet-family" },
  );
  assert.equal(child.status, 403, await child.clone().text());
  const otherFamily = await requestApi(
    app,
    "/api/notif-settings/family?family_id=other-family",
    "quiet-parent",
    { role: "parent", familyId: "quiet-family" },
  );
  assert.equal(otherFamily.status, 403, await otherFamily.clone().text());
});

test("quiet PUT은 부모 본인과 같은 가족 활성 아이만 정본 row로 저장한다", async () => {
  const sqlite = createSqlite();
  addQuietHoursFamily(sqlite);
  const db = new Db(sqlite);
  const app = new Hono();
  app.route("/api/notif-settings", notifSettingsRoutes);
  const realtimeEnvelopes = [];
  app.env = env(db, { realtimeEnvelopes });
  const childExecutionCtx = createExecutionContext();

  const childSaved = await requestApi(app, "/api/notif-settings/quiet-hours", "quiet-parent", {
    method: "PUT",
    role: "parent",
    familyId: "quiet-family",
    executionCtx: childExecutionCtx,
    body: quietHoursBody("quiet-child"),
  });
  assert.equal(childSaved.status, 200, await childSaved.clone().text());
  const childRow = await childSaved.json();
  assert.deepEqual(
    { ...childRow, updated_at: "<timestamp>" },
    {
      target_user_id: "quiet-child",
      role: "child",
      enabled: true,
      start_minute: 1320,
      end_minute: 420,
      updated_at: "<timestamp>",
      configured: true,
    },
  );
  assert.ok(Number.isFinite(Date.parse(childRow.updated_at)));
  await Promise.allSettled(childExecutionCtx.waitUntilPromises);
  assert.deepEqual(realtimeEnvelopes, [
    {
      url: "https://do.internal/notify",
      body: {
        kind: "pg",
        table: "notification_settings",
        eventType: "INSERT",
        new: { family_id: "quiet-family", user_id: "quiet-child" },
        old: null,
        targetUserIds: ["quiet-parent", "quiet-child"],
      },
    },
  ]);
  assert.deepEqual(
    { ...sqlite.prepare(
      `SELECT family_id,quiet_hours_enabled,quiet_hours_start_minute,
              quiet_hours_end_minute,quiet_hours_updated_by
         FROM notification_settings WHERE user_id='quiet-child'`,
    ).get() },
    {
      family_id: "quiet-family",
      quiet_hours_enabled: 1,
      quiet_hours_start_minute: 1320,
      quiet_hours_end_minute: 420,
      quiet_hours_updated_by: "quiet-parent",
    },
  );

  const selfExecutionCtx = createExecutionContext();
  const selfSaved = await requestApi(app, "/api/notif-settings/quiet-hours", "quiet-parent", {
    method: "PUT",
    role: "parent",
    familyId: "quiet-family",
    executionCtx: selfExecutionCtx,
    body: quietHoursBody("quiet-parent", {
      enabled: false,
      start_minute: 1200,
      end_minute: 360,
    }),
  });
  assert.equal(selfSaved.status, 200, await selfSaved.clone().text());
  assert.equal((await selfSaved.json()).role, "parent");
  await Promise.allSettled(selfExecutionCtx.waitUntilPromises);
  assert.equal(
    sqlite.prepare("SELECT COUNT(*) AS count FROM account_mutation_leases").get().count,
    0,
    "성공 뒤 middleware와 quiet route lease가 모두 해제되어야 합니다",
  );

  const forbiddenTargets = ["quiet-co-parent", "quiet-inactive-child", "other-child"];
  for (const targetUserId of forbiddenTargets) {
    const response = await requestApi(app, "/api/notif-settings/quiet-hours", "quiet-parent", {
      method: "PUT",
      role: "parent",
      familyId: "quiet-family",
      body: quietHoursBody(targetUserId),
    });
    assert.equal(response.status, 403, `${targetUserId}: ${await response.clone().text()}`);
  }
  const childCaller = await requestApi(app, "/api/notif-settings/quiet-hours", "quiet-child", {
    method: "PUT",
    role: "child",
    familyId: "quiet-family",
    body: quietHoursBody("quiet-child", { expected_parent_user_id: "quiet-child" }),
  });
  assert.equal(childCaller.status, 403, await childCaller.clone().text());
});

test("quiet 최초 저장은 동시 행 생성과 경합해도 quiet 컬럼만 원자 upsert한다", async () => {
  const sqlite = createSqlite();
  addQuietHoursFamily(sqlite);
  const db = new ConcurrentQuietSettingsDb(sqlite);
  const app = new Hono();
  app.route("/api/notif-settings", notifSettingsRoutes);
  app.env = env(db);

  const response = await requestApi(app, "/api/notif-settings/quiet-hours", "quiet-parent", {
    method: "PUT",
    role: "parent",
    familyId: "quiet-family",
    body: quietHoursBody("quiet-child", {
      enabled: true,
      start_minute: 1260,
      end_minute: 390,
    }),
  });

  assert.equal(response.status, 200, await response.clone().text());
  assert.deepEqual(
    { ...(await response.json()), updated_at: "<timestamp>" },
    {
      target_user_id: "quiet-child",
      role: "child",
      enabled: true,
      start_minute: 1260,
      end_minute: 390,
      updated_at: "<timestamp>",
      configured: true,
    },
  );
  assert.deepEqual(
    { ...sqlite.prepare(
      `SELECT COUNT(*) AS row_count, child_enabled, parent_enabled, location_enabled,
              registered_place_enabled, playdate_enabled, minutes_before, updated_at,
              quiet_hours_enabled, quiet_hours_start_minute, quiet_hours_end_minute,
              quiet_hours_updated_by
         FROM notification_settings WHERE user_id='quiet-child'`,
    ).get() },
    {
      row_count: 1,
      child_enabled: 0,
      parent_enabled: 0,
      location_enabled: 0,
      registered_place_enabled: 0,
      playdate_enabled: 0,
      minutes_before: "{30}",
      updated_at: "2026-07-19T12:10:00.000Z",
      quiet_hours_enabled: 1,
      quiet_hours_start_minute: 1260,
      quiet_hours_end_minute: 390,
      quiet_hours_updated_by: "quiet-parent",
    },
  );
});

test("quiet PUT은 세션 mismatch와 잘못된 분 범위를 쓰기 전에 거부한다", async () => {
  const sqlite = createSqlite();
  addQuietHoursFamily(sqlite);
  const db = new Db(sqlite);
  const app = new Hono();
  app.route("/api/notif-settings", notifSettingsRoutes);
  app.env = env(db);

  const cases = [
    [quietHoursBody("quiet-child", { expected_parent_user_id: "quiet-co-parent" }), 409],
    [quietHoursBody("quiet-child", { start_minute: -1 }), 400],
    [quietHoursBody("quiet-child", { end_minute: 1440 }), 400],
    [quietHoursBody("quiet-child", { start_minute: 600, end_minute: 600 }), 400],
  ];
  for (const [body, expectedStatus] of cases) {
    const response = await requestApi(app, "/api/notif-settings/quiet-hours", "quiet-parent", {
      method: "PUT",
      role: "parent",
      familyId: "quiet-family",
      body,
    });
    assert.equal(response.status, expectedStatus, await response.clone().text());
  }
  assert.equal(
    sqlite.prepare("SELECT COUNT(*) AS count FROM notification_settings WHERE user_id='quiet-child'").get().count,
    0,
  );
});

test("quiet PUT은 대상 삭제 scope와 lease 장애를 409와 503으로 구분하고 lease를 해제한다", async () => {
  const sqlite = createSqlite();
  addQuietHoursFamily(sqlite);
  beginDeletion(sqlite, "quiet-child");
  const db = new Db(sqlite);
  const app = new Hono();
  app.route("/api/notif-settings", notifSettingsRoutes);
  app.env = env(db);

  const blocked = await requestApi(app, "/api/notif-settings/quiet-hours", "quiet-parent", {
    method: "PUT",
    role: "parent",
    familyId: "quiet-family",
    body: quietHoursBody("quiet-child"),
  });
  assert.equal(blocked.status, 409, await blocked.clone().text());
  assert.deepEqual(await blocked.json(), { error: "account_mutation_blocked" });
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM account_mutation_leases").get().count, 0);

  const unavailable = await requestApi(app, "/api/notif-settings/quiet-hours", "quiet-parent", {
    method: "PUT",
    role: "parent",
    familyId: "quiet-family",
    body: quietHoursBody("invalid target id"),
  });
  assert.equal(unavailable.status, 503, await unavailable.clone().text());
  assert.deepEqual(await unavailable.json(), { error: "account_mutation_unavailable" });
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM account_mutation_leases").get().count, 0);
});

test("기존 self POST는 quiet 컬럼을 보존한다", async () => {
  const sqlite = createSqlite();
  addQuietHoursFamily(sqlite);
  const db = new Db(sqlite);
  const app = new Hono();
  app.route("/api/notif-settings", notifSettingsRoutes);
  app.env = env(db);

  const response = await requestApi(app, "/api/notif-settings", "quiet-parent", {
    method: "POST",
    role: "parent",
    familyId: "quiet-family",
    body: {
      expected_user_id: "quiet-parent",
      family_id: "quiet-family",
      child_enabled: false,
      parent_enabled: false,
      location_enabled: false,
      registered_place_enabled: false,
      playdate_enabled: false,
      minutes_before: [],
    },
  });
  assert.equal(response.status, 200, await response.clone().text());
  assert.deepEqual(
    { ...sqlite.prepare(
      `SELECT quiet_hours_enabled,quiet_hours_start_minute,quiet_hours_end_minute,
              quiet_hours_updated_by,quiet_hours_updated_at
         FROM notification_settings WHERE user_id='quiet-parent'`,
    ).get() },
    {
      quiet_hours_enabled: 1,
      quiet_hours_start_minute: 1320,
      quiet_hours_end_minute: 420,
      quiet_hours_updated_by: "quiet-parent",
      quiet_hours_updated_at: "2026-07-19T12:00:00.000Z",
    },
  );
});

test("quiet 저장은 command 전달 실패와 분리되어 정본 row를 성공 응답한다", async () => {
  const sqlite = createSqlite();
  addQuietHoursFamily(sqlite);
  sqlite.prepare(
    `INSERT INTO fcm_tokens(id,user_id,family_id,fcm_token,platform)
     VALUES ('quiet-child-token','quiet-child','quiet-family','quiet-child-fcm','android')`,
  ).run();
  const db = new Db(sqlite);
  const app = new Hono();
  app.route("/api/notif-settings", notifSettingsRoutes);
  app.env = env(db);
  const executionCtx = createExecutionContext();
  const originalError = console.error;
  const errors = [];
  console.error = (...args) => errors.push(args);
  try {
    const response = await requestApi(app, "/api/notif-settings/quiet-hours", "quiet-parent", {
      method: "PUT",
      role: "parent",
      familyId: "quiet-family",
      executionCtx,
      body: quietHoursBody("quiet-child"),
    });
    assert.equal(response.status, 200, await response.clone().text());
    const row = await response.json();
    assert.equal(row.target_user_id, "quiet-child");
    assert.equal(row.configured, true);
    assert.equal(
      sqlite.prepare(
        "SELECT quiet_hours_enabled FROM notification_settings WHERE user_id='quiet-child'",
      ).get().quiet_hours_enabled,
      1,
    );
    await Promise.allSettled(executionCtx.waitUntilPromises);
  } finally {
    console.error = originalError;
  }
  const serializedErrors = JSON.stringify(errors);
  assert.doesNotMatch(serializedErrors, /quiet-child-fcm|endpoint/i);
});

test("quiet PUT은 지연된 FCM fetch를 기다리지 않고 canonical row를 응답한다", async () => {
  const sqlite = createSqlite();
  addQuietHoursFamily(sqlite);
  sqlite.prepare(
    `INSERT INTO fcm_tokens(id,user_id,family_id,fcm_token,platform)
     VALUES ('quiet-child-delayed','quiet-child','quiet-family','quiet-child-delayed-fcm','android')`,
  ).run();
  const db = new Db(sqlite);
  const app = new Hono();
  const { privateKey: delayedPrivateKey } = await generateKeyPair("RS256", { extractable: true });
  const delayedPrivateKeyPem = await exportPKCS8(delayedPrivateKey);
  app.route("/api/notif-settings", notifSettingsRoutes);
  app.route("/api/family", familyRoutes);
  app.env = {
    ...env(db),
    FCM_PROJECT_ID: "quiet-delay-project",
    FCM_CLIENT_EMAIL: "quiet-delay@example.com",
    FCM_PRIVATE_KEY: delayedPrivateKeyPem,
  };
  const executionCtx = createExecutionContext();
  const originalFetch = globalThis.fetch;
  let resolveFcmStarted;
  const fcmStarted = new Promise((resolveStarted) => {
    resolveFcmStarted = resolveStarted;
  });
  let resolveFcm;
  const delayedFcmResponse = new Promise((resolveResponse) => {
    resolveFcm = resolveResponse;
  });
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url === "https://oauth2.googleapis.com/token") {
      return Response.json({ access_token: "quiet-delay-access-token", expires_in: 3_600 });
    }
    if (url.includes("/messages:send")) {
      resolveFcmStarted();
      return delayedFcmResponse;
    }
    throw new Error(`unexpected_fetch:${url}`);
  };

  let requestSettled = false;
  const request = requestApi(app, "/api/notif-settings/quiet-hours", "quiet-parent", {
    method: "PUT",
    role: "parent",
    familyId: "quiet-family",
    executionCtx,
    body: quietHoursBody("quiet-child", {
      enabled: false,
      start_minute: 1230,
      end_minute: 360,
    }),
  }).then((response) => {
    requestSettled = true;
    return response;
  });

  try {
    await fcmStarted;
    await Promise.resolve();
    assert.equal(requestSettled, true, "FCM 응답 전에도 PUT 응답이 완료되어야 합니다");
    assert.equal(executionCtx.waitUntilPromises.length, 1);
    const response = await request;
    assert.equal(response.status, 200, await response.clone().text());
    assert.deepEqual(
      { ...(await response.json()), updated_at: "<timestamp>" },
      {
        target_user_id: "quiet-child",
        role: "child",
        enabled: false,
        start_minute: 1230,
        end_minute: 360,
        updated_at: "<timestamp>",
        configured: true,
      },
    );
    assert.equal(
      sqlite.prepare("SELECT COUNT(*) AS count FROM account_mutation_leases").get().count,
      2,
      "지연된 FCM이 끝날 때까지 호출 부모와 대상 아이 lease를 유지해야 합니다",
    );
    const deletion = await beginAccountDeletionClaim(db, { ownerUserId: "quiet-child" });
    assert.equal(deletion.status, "conflict", "FCM pending 동안 대상 계정 삭제 claim을 막아야 합니다");
    const unpair = await requestApi(app, "/api/family/unpair", "quiet-parent", {
      method: "POST",
      role: "parent",
      familyId: "quiet-family",
      body: { family_id: "quiet-family", child_user_id: "quiet-child" },
    });
    assert.equal(unpair.status, 409, await unpair.clone().text());
    assert.deepEqual(await unpair.json(), { error: "child_mutation_in_progress" });
  } finally {
    resolveFcm(Response.json({ name: "messages/delayed" }));
    await Promise.allSettled([request, ...executionCtx.waitUntilPromises]);
    globalThis.fetch = originalFetch;
  }
  assert.equal(
    sqlite.prepare("SELECT COUNT(*) AS count FROM account_mutation_leases").get().count,
    0,
    "realtime과 FCM 완료 뒤 이전한 lease를 모두 해제해야 합니다",
  );
});

test("quiet 역순 동시 저장은 같은 밀리초에도 DB write 순서대로 고유한 버전을 반환한다", async () => {
  const sqlite = createSqlite();
  addQuietHoursFamily(sqlite);
  sqlite.prepare(
    `INSERT INTO notification_settings
      (user_id,family_id,quiet_hours_enabled,quiet_hours_start_minute,
       quiet_hours_end_minute,quiet_hours_updated_by,quiet_hours_updated_at)
     VALUES (?,?,?,?,?,?,?)`,
  ).run(
    "quiet-child",
    "quiet-family",
    1,
    1320,
    420,
    "quiet-parent",
    "2099-01-01T00:00:00.000Z",
  );
  const db = new ReverseQuietWriteDb(sqlite);
  const app = new Hono();
  app.route("/api/notif-settings", notifSettingsRoutes);
  app.env = env(db);
  const firstExecutionCtx = createExecutionContext();
  const secondExecutionCtx = createExecutionContext();
  const RealDate = globalThis.Date;
  const fixedNowMs = RealDate.now();
  class FixedDate extends RealDate {
    constructor(...args) {
      super(...(args.length > 0 ? args : [fixedNowMs]));
    }

    static now() {
      return fixedNowMs;
    }
  }
  globalThis.Date = FixedDate;

  let firstRequest;
  try {
    firstRequest = requestApi(app, "/api/notif-settings/quiet-hours", "quiet-parent", {
      method: "PUT",
      role: "parent",
      familyId: "quiet-family",
      executionCtx: firstExecutionCtx,
      body: quietHoursBody("quiet-child", {
        enabled: true,
        start_minute: 1260,
        end_minute: 390,
      }),
    });
    await db.firstQuietWriteStarted;

    const secondResponse = await requestApi(
      app,
      "/api/notif-settings/quiet-hours",
      "quiet-parent",
      {
        method: "PUT",
        role: "parent",
        familyId: "quiet-family",
        executionCtx: secondExecutionCtx,
        body: quietHoursBody("quiet-child", {
          enabled: false,
          start_minute: 1200,
          end_minute: 360,
        }),
      },
    );
    assert.equal(secondResponse.status, 200, await secondResponse.clone().text());
    const secondRow = await secondResponse.json();

    db.resume();
    const firstResponse = await firstRequest;
    assert.equal(firstResponse.status, 200, await firstResponse.clone().text());
    const firstRow = await firstResponse.json();

    assert.ok(Number.isFinite(Date.parse(secondRow.updated_at)));
    assert.ok(Number.isFinite(Date.parse(firstRow.updated_at)));
    assert.equal(secondRow.updated_at, "2099-01-01T00:00:00.001Z");
    assert.equal(firstRow.updated_at, "2099-01-01T00:00:00.002Z");
    assert.ok(
      Date.parse(firstRow.updated_at) > Date.parse(secondRow.updated_at),
      "나중에 실행된 첫 요청 write가 동일 밀리초 선행 write보다 큰 버전을 받아야 합니다",
    );
    assert.notEqual(firstRow.updated_at, secondRow.updated_at);
    assert.equal(
      sqlite.prepare(
        "SELECT quiet_hours_updated_at FROM notification_settings WHERE user_id='quiet-child'",
      ).get().quiet_hours_updated_at,
      firstRow.updated_at,
      "DB에는 실제 마지막 write가 RETURNING한 최대 버전이 남아야 합니다",
    );
  } finally {
    db.resume();
    await Promise.allSettled([
      ...(firstRequest ? [firstRequest] : []),
      ...firstExecutionCtx.waitUntilPromises,
      ...secondExecutionCtx.waitUntilPromises,
    ]);
    globalThis.Date = RealDate;
  }
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM account_mutation_leases").get().count, 0);
});

test("quiet 설정 command는 exact-target active FCM에만 표시 없이 보내고 pending을 만들지 않는다", async () => {
  assert.equal(typeof handleInstantNotification, "function");
  const sqlite = createSqlite();
  addQuietHoursFamily(sqlite);
  sqlite.prepare(
    `INSERT INTO fcm_tokens(id,user_id,family_id,fcm_token,platform)
     VALUES (?,?,?,?,?)`,
  ).run("quiet-child-token", "quiet-child", "quiet-family", "fcm-quiet-child", "android");
  sqlite.prepare(
    `INSERT INTO fcm_tokens(id,user_id,family_id,fcm_token,platform,disabled_at)
     VALUES (?,?,?,?,?,?)`,
  ).run(
    "quiet-child-disabled-token",
    "quiet-child",
    "quiet-family",
    "fcm-quiet-child-disabled",
    "android",
    "2026-07-19T11:00:00.000Z",
  );
  sqlite.prepare(
    `INSERT INTO fcm_tokens(id,user_id,family_id,fcm_token,platform)
     VALUES (?,?,?,?,?)`,
  ).run("quiet-parent-token", "quiet-parent", "quiet-family", "fcm-quiet-parent", "android");
  sqlite.prepare(
    `INSERT INTO push_subscriptions(id,user_id,family_id,endpoint,subscription)
     VALUES (?,?,?,?,?)`,
  ).run(
    "quiet-child-web",
    "quiet-child",
    "quiet-family",
    "https://push.example/quiet-child",
    JSON.stringify({ endpoint: "https://push.example/quiet-child", keys: { p256dh: "x", auth: "y" } }),
  );
  const db = new Db(sqlite);
  const { privateKey: fcmPrivateKey } = await generateKeyPair("RS256", { extractable: true });
  const fcmPrivateKeyPem = await exportPKCS8(fcmPrivateKey);
  const originalFetch = globalThis.fetch;
  const fcmMessages = [];
  let webPushCalls = 0;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url === "https://oauth2.googleapis.com/token") {
      return Response.json({ access_token: "quiet-test-access-token", expires_in: 3_600 });
    }
    if (url.includes("/messages:send")) {
      fcmMessages.push(JSON.parse(String(init?.body ?? "{}")));
      return Response.json({ name: `messages/${fcmMessages.length}` });
    }
    if (url.startsWith("https://push.example/")) {
      webPushCalls += 1;
    }
    throw new Error(`unexpected_fetch:${url}`);
  };
  try {
    const updatedAt = "2026-07-19T12:34:56.000Z";
    const response = await handleInstantNotification(
      {
        FCM_PROJECT_ID: "quiet-test-project",
        FCM_CLIENT_EMAIL: "quiet-fcm@example.com",
        FCM_PRIVATE_KEY: fcmPrivateKeyPem,
      },
      db,
      {
        action: "notification_quiet_hours_updated",
        familyId: "quiet-family",
        targetUserId: "quiet-child",
        enabled: true,
        startMinute: 1320,
        endMinute: 420,
        updatedAt,
      },
      "quiet-parent",
      "parent",
      null,
    );
    assert.equal(response.status, 200, await response.clone().text());
    assert.equal(fcmMessages.length, 1);
    assert.equal(webPushCalls, 0);
    assert.equal(fcmMessages[0].message.token, "fcm-quiet-child");
    assert.equal(fcmMessages[0].message.notification, undefined);
    assert.deepEqual(fcmMessages[0].message.data, {
      action: "notification_quiet_hours_updated",
      type: "notification_quiet_hours_updated",
      familyId: "quiet-family",
      targetUserId: "quiet-child",
      enabled: "true",
      startMinute: "1320",
      endMinute: "420",
      timeZoneId: "Asia/Seoul",
      updatedAt,
    });
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM pending_notifications").get().count, 0);

    const invalidTarget = await handleInstantNotification(
      {
        FCM_PROJECT_ID: "quiet-test-project",
        FCM_CLIENT_EMAIL: "quiet-fcm@example.com",
        FCM_PRIVATE_KEY: fcmPrivateKeyPem,
      },
      db,
      {
        action: "notification_quiet_hours_updated",
        familyId: "quiet-family",
        targetUserId: "other-child",
        enabled: true,
        startMinute: 1320,
        endMinute: 420,
        updatedAt,
      },
      "quiet-parent",
      "parent",
      null,
    );
    assert.equal(invalidTarget.status, 403, await invalidTarget.clone().text());
    assert.equal(fcmMessages.length, 1);
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM pending_notifications").get().count, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("교사 출석 INSERT 직전 대상 가족 삭제가 시작되면 출석과 부모 알림을 만들지 않는다", async () => {
  const sqlite = createSqlite();
  addUser(sqlite, "attendance-teacher-user");
  addUser(sqlite, "attendance-parent");
  sqlite.prepare(
    "INSERT INTO families(id,parent_id,pair_code) VALUES ('attendance-family','attendance-parent','PAIR-ATTEND')",
  ).run();
  sqlite.prepare(
    `INSERT INTO family_members(id,family_id,user_id,role,name)
     VALUES ('attendance-child-member','attendance-family','attendance-child-user','child','혜니')`,
  ).run();
  sqlite.prepare(
    `INSERT INTO teacher_profiles(id,user_id,display_name,created_at,updated_at)
     VALUES ('attendance-teacher','attendance-teacher-user','담임 선생님','2026-07-14','2026-07-14')`,
  ).run();
  sqlite.prepare(
    `INSERT INTO teacher_child_pairings
      (id,teacher_id,child_member_id,family_id,pairing_status,permission_scope,created_at,updated_at)
     VALUES ('attendance-pairing','attendance-teacher','attendance-child-member','attendance-family',
             'approved','schedule_attendance','2026-07-14','2026-07-14')`,
  ).run();
  const db = new PausingWriteDb(sqlite, "INSERT INTO teacher_attendance_logs");
  const app = new Hono();
  app.route("/api/teacher", teacherWriteRoutes);
  app.env = env(db);

  const request = requestJson(
    app,
    "/api/teacher/attendance",
    "attendance-teacher-user",
    {
      child_member_id: "attendance-child-member",
      date_key: "2026-6-14",
      status: "attended",
    },
  );
  await db.writeStarted;
  const protocolClaim = await beginAccountDeletionClaim(db, {
    ownerUserId: "attendance-parent",
  });
  assert.equal(protocolClaim.status, "conflict");
  beginFamilyDeletion(sqlite, "attendance-family");
  db.resume();
  const response = await request;

  assert.equal(response.status, 409, await response.clone().text());
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM teacher_attendance_logs").get().count, 0);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM parent_alerts").get().count, 0);
});

test("삭제 중이 아닌 현재 사용자는 알림 설정과 선생님 프로필을 계속 저장할 수 있다", async () => {
  const sqlite = createSqlite();
  addUser(sqlite, "active-user");
  const db = new Db(sqlite);
  const app = new Hono();
  app.route("/api/notif-settings", notifSettingsRoutes);
  app.route("/api/teacher", teacherWriteRoutes);
  app.env = env(db);

  const notification = await requestJson(
    app,
    "/api/notif-settings",
    "active-user",
    {
      expected_user_id: "active-user",
      child_enabled: true,
      parent_enabled: true,
      location_enabled: true,
      registered_place_enabled: true,
      playdate_enabled: true,
      minutes_before: [15, 5],
    },
  );
  const teacher = await requestJson(
    app,
    "/api/teacher/profile",
    "active-user",
    { display_name: "현재 선생님" },
  );

  assert.equal(notification.status, 200, await notification.clone().text());
  assert.equal(teacher.status, 200, await teacher.clone().text());
  assert.equal(
    sqlite.prepare("SELECT COUNT(*) AS count FROM notification_settings WHERE user_id='active-user'").get().count,
    1,
  );
  assert.equal(
    sqlite.prepare("SELECT COUNT(*) AS count FROM teacher_profiles WHERE user_id='active-user'").get().count,
    1,
  );
});
