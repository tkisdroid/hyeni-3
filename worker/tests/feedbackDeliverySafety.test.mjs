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

const feedbackRoutes = (
  await import(pathToFileURL(resolve(workerDir, "routes/feedback.ts")).href)
).default;

class Statement {
  constructor(owner, sql, bindings = []) {
    this.owner = owner;
    this.sql = sql;
    this.bindings = bindings;
  }

  bind(...bindings) {
    return new Statement(this.owner, this.sql, bindings);
  }

  async first() {
    return this.owner.sqlite.prepare(this.sql).get(...this.bindings) ?? null;
  }

  async all() {
    return { results: this.owner.sqlite.prepare(this.sql).all(...this.bindings) };
  }

  async run() {
    if (this.owner.failFeedbackInsert && /INSERT\s+(?:OR\s+IGNORE\s+)?INTO\s+user_feedback/i.test(this.sql)) {
      throw new Error("injected feedback storage failure");
    }
    const result = this.owner.sqlite.prepare(this.sql).run(...this.bindings);
    return { success: true, meta: { changes: Number(result.changes) } };
  }
}

class Db {
  constructor(sqlite, { failFeedbackInsert = false } = {}) {
    this.sqlite = sqlite;
    this.failFeedbackInsert = failFeedbackInsert;
  }

  prepare(sql) {
    return new Statement(this, sql);
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

function createDb(options = {}) {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(readFileSync(resolve(repoDir, "cloudflare/schema_d1.sql"), "utf8"));
  sqlite.prepare(
    "INSERT INTO users(id,email,is_anonymous,raw_user_meta_data,created_at) VALUES (?,?,0,?,?)",
  ).run("parent-a", "canonical@example.com", JSON.stringify({ name: "메타 이름" }), "2026-07-14");
  sqlite.prepare("INSERT INTO families(id,parent_id,pair_code,created_at) VALUES (?,?,?,?)")
    .run("family-a", "parent-a", "PAIR-A", "2026-07-14");
  sqlite.prepare(
    `INSERT INTO family_members
       (id,family_id,user_id,role,name,is_active,created_at)
     VALUES (?,?,?,?,?,1,?)`,
  ).run("member-parent-a", "family-a", "parent-a", "parent", "정본 부모", "2026-07-14");
  sqlite.prepare(
    `INSERT INTO user_profiles
       (user_id,display_name,provider,created_at,updated_at)
     VALUES (?,?,'phone',?,?)`,
  ).run("parent-a", "프로필 이름", "2026-07-14", "2026-07-14");
  return { sqlite, db: new Db(sqlite, options) };
}

const { privateKey, publicKey } = await generateKeyPair("ES256", { extractable: true });
const jwtPrivateKey = JSON.stringify(await exportJWK(privateKey));
const jwtPublicKey = JSON.stringify(await exportJWK(publicKey));

async function authorization({ sub = "parent-a", role = "parent", familyId = "family-a" } = {}) {
  const token = await new SignJWT({ role, family_id: familyId, is_anonymous: false })
    .setProtectedHeader({ alg: "ES256" })
    .setSubject(sub)
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(privateKey);
  return `Bearer ${token}`;
}

function env(db, overrides = {}) {
  return {
    DB: db,
    JWT_PRIVATE_KEY: jwtPrivateKey,
    JWT_PUBLIC_KEY: jwtPublicKey,
    ...overrides,
  };
}

async function request(db, body, options = {}) {
  const app = new Hono();
  app.route("/api/feedback", feedbackRoutes);
  const headers = {
    "Content-Type": "application/json",
    "User-Agent": "HyeniTest/1.0",
  };
  if (options.auth !== false) headers.Authorization = await authorization(options.actor);
  return app.request(
    "http://test.local/api/feedback",
    { method: "POST", headers, body: JSON.stringify(body) },
    env(db, options.env),
  );
}

function validBody(index = 1) {
  return {
    requestId: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    familyId: "family-a",
    feedbackKind: "problem",
    category: "location_safety",
    content: `위치 문제 ${index}`,
    appOrigin: "https://hyeni-calendar.pages.dev",
    diagnosticSchemaVersion: 1,
    currentScreen: "/parent/location/37.5123/127.0123",
    deviceInfo: {
      appVersion: "1.2.0",
      runtime: "ios-pwa",
      platform: "ios",
      userAgent: "본문에서 위조한 User-Agent",
      language: "ko-KR",
      timezone: "Asia/Seoul",
      viewport: { width: 390, height: 844, pixelRatio: 3 },
      online: true,
      pwaStandalone: true,
      serviceWorker: "activated",
      notificationPermission: "granted",
      networkType: "4g",
      accessToken: "본문 토큰",
      coordinates: { latitude: 37.5, longitude: 127 },
    },
    errorLogs: [{
      at: "2026-07-31T01:02:03.000Z",
      kind: "api",
      code: "location_timeout",
      screen: "/parent/location/37.5123/127.0123",
      count: 2,
      status: 503,
      method: "GET",
      path: "/api/location/550e8400-e29b-41d4-a716-446655440000",
      source: "index-ABC123.js:42:7",
      refreshToken: "본문 토큰",
      message: "민감한 오류 원문",
    }],
  };
}

test("피드백 relay는 인증 없이는 본문을 접수하거나 이메일을 보내지 않는다", async () => {
  const { sqlite, db } = createDb();
  let emailCalls = 0;

  const response = await request(db, validBody(), {
    auth: false,
    env: {
      FEEDBACK_EMAIL: {
        async send() {
          emailCalls += 1;
          return { messageId: "email-id" };
        },
      },
    },
  });

  assert.equal(response.status, 401, await response.clone().text());
  assert.equal(emailCalls, 0);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM user_feedback").get().count, 0);
});

test("서버 정본 사용자·가족만 저장하고 저장 완료 뒤 Cloudflare Email Service로 전달한다", async () => {
  const { sqlite, db } = createDb();
  let emailRequest = null;
  const emailBinding = {
    async send(message) {
      const durable = sqlite.prepare(
        "SELECT status FROM user_feedback WHERE type='feature_feedback'",
      ).get();
      assert.equal(durable?.status, "queued", "이메일 호출 전에 durable 접수가 끝나야 한다");
      emailRequest = message;
      return { messageId: "email-id" };
    },
  };

  const response = await request(
    db,
    {
      ...validBody(),
      senderUserId: "attacker",
      senderRole: "admin",
      senderName: "위조 이름",
      senderEmail: "spoof@example.com",
      accessToken: "공격자 토큰",
    },
    { env: { FEEDBACK_EMAIL: emailBinding } },
  );

  assert.equal(response.status, 200, await response.clone().text());
  assert.deepEqual(await response.json(), { ok: true, status: "sent" });
  const row = sqlite.prepare(
    `SELECT family_id,user_id,type,message,error_logs,device_info,current_screen,status
       FROM user_feedback`,
  ).get();
  assert.equal(row.family_id, "family-a");
  assert.equal(row.user_id, "parent-a");
  assert.equal(row.type, "feature_feedback");
  assert.equal(row.status, "sent");
  assert.equal(row.current_screen, "/parent/location/:n/:n");
  const stored = JSON.parse(row.message);
  assert.equal(stored.feedbackKind, "problem");
  assert.equal(stored.category, "location_safety");
  assert.equal(stored.content, "위치 문제 1");
  assert.equal(stored.appOrigin, "https://hyeni-calendar.pages.dev");
  assert.equal(stored.diagnosticSchemaVersion, 1);
  assert.equal(stored.requestId, validBody().requestId);
  assert.equal("senderEmail" in stored, false);
  assert.equal("accessToken" in stored, false);

  const storedDevice = JSON.parse(row.device_info);
  assert.equal(storedDevice.runtime, "ios-pwa");
  assert.equal(storedDevice.platform, "ios");
  assert.equal(storedDevice.userAgent, "HyeniTest/1.0");
  assert.equal("accessToken" in storedDevice, false);
  assert.equal("coordinates" in storedDevice, false);
  const storedLogs = JSON.parse(row.error_logs);
  assert.deepEqual(storedLogs, [{
    at: "2026-07-31T01:02:03.000Z",
    kind: "api",
    code: "location_timeout",
    screen: "/parent/location/:n/:n",
    count: 2,
    status: 503,
    method: "GET",
    path: "/api/location/:id",
    source: "index-ABC123.js:42:7",
  }]);

  const email = emailRequest;
  assert.match(email.text, /정본 부모/);
  assert.match(email.text, /canonical@example\.com/);
  assert.match(email.text, /parent-a/);
  assert.match(email.text, /family-a/);
  assert.match(email.text, /location_timeout/);
  assert.match(email.text, /ios-pwa/);
  assert.doesNotMatch(
    email.text,
    /attacker|위조 이름|spoof@example\.com|admin|본문 토큰|민감한 오류 원문|37\.5/,
  );
  assert.equal(email.from, "feedback@hyenicalendar.com");
  assert.equal(email.to, "tkisdroid@gmail.com");
  assert.equal(email.replyTo, "canonical@example.com");
  assert.equal(email.subject, "[혜니캘린더] 문제 신고");
});

test("Cloudflare 이메일 바인딩 미설정·실패는 접수 행을 queued로 보존하고 PII를 응답하지 않는다", async (t) => {
  t.mock.method(console, "error", () => {});
  t.mock.method(console, "warn", () => {});
  const missing = createDb();
  const missingResponse = await request(missing.db, validBody());
  assert.equal(missingResponse.status, 202, await missingResponse.clone().text());
  assert.deepEqual(await missingResponse.json(), { ok: true, status: "queued" });
  assert.equal(
    missing.sqlite.prepare("SELECT status FROM user_feedback").get().status,
    "queued",
  );

  const failed = createDb();
  const failedResponse = await request(failed.db, validBody(), {
    env: {
      FEEDBACK_EMAIL: {
        async send() {
          throw new Error("provider secret detail");
        },
      },
    },
  });
  assert.equal(failedResponse.status, 202, await failedResponse.clone().text());
  assert.deepEqual(await failedResponse.json(), { ok: true, status: "queued" });
  assert.equal(failed.sqlite.prepare("SELECT status FROM user_feedback").get().status, "queued");
});

test("requestId 멱등 재시도는 rate limit보다 우선하고 사용자별 시간당 5건으로 제한한다", async () => {
  const { sqlite, db } = createDb();
  for (let index = 1; index <= 5; index += 1) {
    const response = await request(db, validBody(index));
    assert.equal(response.status, 202, await response.clone().text());
  }
  const duplicate = await request(db, validBody(1));
  assert.equal(duplicate.status, 202, await duplicate.clone().text());
  assert.deepEqual(await duplicate.json(), { ok: true, status: "queued" });

  const limited = await request(db, validBody(6));
  assert.equal(limited.status, 429, await limited.clone().text());
  assert.deepEqual(await limited.json(), { error: "feedback_rate_limited" });
  assert.equal(
    sqlite.prepare("SELECT COUNT(*) AS count FROM user_feedback WHERE type='feature_feedback'").get().count,
    5,
  );
});

test("familyId·content·appOrigin·requestId를 보수적으로 검증한다", async () => {
  const { db } = createDb();
  const invalidCases = [
    [{ ...validBody(), content: "" }, 400, "invalid_feedback_content"],
    [{ ...validBody(), content: "x".repeat(4001) }, 400, "invalid_feedback_content"],
    [{ ...validBody(), appOrigin: "javascript:alert(1)" }, 400, "invalid_app_origin"],
    [{ ...validBody(), requestId: "not-a-uuid" }, 400, "invalid_feedback_request_id"],
    [{ ...validBody(), diagnosticSchemaVersion: 2 }, 400, "invalid_feedback_diagnostics"],
    [{ ...validBody(), feedbackKind: "complaint" }, 400, "invalid_feedback_kind"],
    [{ ...validBody(), category: "billing_secret" }, 400, "invalid_feedback_category"],
    [{ ...validBody(), currentScreen: "/parent/location?token=secret" }, 400, "invalid_feedback_diagnostics"],
    [{ ...validBody(), errorLogs: Array.from({ length: 13 }, () => validBody().errorLogs[0]) }, 400, "invalid_feedback_diagnostics"],
    [{
      ...validBody(),
      errorLogs: [{ ...validBody().errorLogs[0], code: "사용자 원문 오류" }],
    }, 400, "invalid_feedback_diagnostics"],
    [{
      ...validBody(),
      deviceInfo: { ...validBody().deviceInfo, viewport: { width: -1, height: 844, pixelRatio: 3 } },
    }, 400, "invalid_feedback_diagnostics"],
  ];
  for (const [body, status, error] of invalidCases) {
    const response = await request(db, body);
    assert.equal(response.status, status, await response.clone().text());
    assert.deepEqual(await response.json(), { error });
  }

  const otherFamily = await request(db, { ...validBody(), familyId: "family-b" });
  assert.equal(otherFamily.status, 403, await otherFamily.clone().text());
  assert.deepEqual(await otherFamily.json(), { error: "family_forbidden" });
});

test("구버전 기능 제안은 진단 정보 없이도 기존 의미로 접수한다", async () => {
  const { sqlite, db } = createDb();
  const legacy = validBody();
  delete legacy.feedbackKind;
  delete legacy.category;
  delete legacy.currentScreen;
  delete legacy.diagnosticSchemaVersion;
  delete legacy.deviceInfo;
  delete legacy.errorLogs;

  const response = await request(db, legacy);
  assert.equal(response.status, 202, await response.clone().text());
  const row = sqlite.prepare(
    "SELECT message,error_logs,device_info,current_screen,status FROM user_feedback",
  ).get();
  assert.equal(row.status, "queued");
  assert.equal(row.error_logs, null);
  assert.equal(row.device_info, null);
  assert.equal(row.current_screen, "/feedback");
  assert.equal(JSON.parse(row.message).feedbackKind, "suggestion");
  assert.equal(JSON.parse(row.message).category, null);
  assert.equal(JSON.parse(row.message).diagnosticSchemaVersion, null);
});

test("운영 로그는 requestId로 상관관계만 남기고 사용자·본문을 출력하지 않는다", async (t) => {
  const entries = [];
  t.mock.method(console, "info", (value) => entries.push(String(value)));
  const { db } = createDb();
  const response = await request(db, validBody(41));
  assert.equal(response.status, 202, await response.clone().text());
  assert.equal(entries.length, 1);
  const entry = JSON.parse(entries[0]);
  assert.deepEqual(entry, {
    scope: "feedback",
    event: "accepted_queued",
    requestId: validBody(41).requestId,
    feedbackKind: "problem",
    category: "location_safety",
    diagnosticCount: 1,
    diagnosticSchemaVersion: 1,
    reason: "email_not_configured",
  });
  assert.equal("userId" in entry, false);
  assert.equal("familyId" in entry, false);
  assert.equal("content" in entry, false);
});

test("durable 접수 저장 실패는 성공으로 위장하지 않고 503으로 닫는다", async (t) => {
  t.mock.method(console, "error", () => {});
  const { db } = createDb({ failFeedbackInsert: true });
  const response = await request(db, validBody());
  assert.equal(response.status, 503, await response.clone().text());
  assert.deepEqual(await response.json(), { error: "feedback_storage_unavailable" });
});

test("피드백 rate-limit 인덱스는 additive migration과 fresh bootstrap에 같은 열 순서로 존재한다", () => {
  const migration = readFileSync(
    resolve(workerDir, "db/feedback-delivery-safety.sql"),
    "utf8",
  );
  const migrated = new DatabaseSync(":memory:");
  migrated.exec(`
    CREATE TABLE user_feedback(
      id TEXT PRIMARY KEY, family_id TEXT, user_id TEXT NOT NULL, type TEXT NOT NULL,
      message TEXT NOT NULL, error_logs TEXT, device_info TEXT, current_screen TEXT,
      status TEXT NOT NULL DEFAULT 'new', created_at TEXT NOT NULL
    );
  `);
  migrated.exec(migration);

  const canonical = new DatabaseSync(":memory:");
  canonical.exec(readFileSync(resolve(repoDir, "cloudflare/schema_d1.sql"), "utf8"));
  const columns = (db) => db.prepare(
    "PRAGMA index_info('idx_user_feedback_feature_rate')",
  ).all().map((row) => row.name);
  assert.deepEqual(columns(migrated), ["user_id", "type", "created_at"]);
  assert.deepEqual(columns(canonical), columns(migrated));
});
