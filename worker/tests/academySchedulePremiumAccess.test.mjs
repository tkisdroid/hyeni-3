import test, { after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { dirname, extname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath, pathToFileURL } from "node:url";

import { generateKeyPair, exportJWK, SignJWT } from "jose";
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

const { authorizeAcademyScheduleRequest } = await import(
  pathToFileURL(resolve(workerDir, "lib/academyScheduleAccess.ts")).href
);
const aiRoutes = (
  await import(pathToFileURL(resolve(workerDir, "routes/ai.ts")).href)
).default;

test("voice-parse는 명시적 feature와 학원 목록 우회 요청을 무료 쿼터보다 먼저 서버 권한 검사한다", () => {
  const source = readFileSync(resolve(workerDir, "routes/ai.ts"), "utf8");
  const featureBranch = source.indexOf("const academyPayloadRequested");
  const accessCall = source.indexOf("authorizeAcademyScheduleRequest", featureBranch);
  const quotaCall = source.indexOf("reserveAiParseQuota", accessCall);
  assert.ok(featureBranch >= 0);
  assert.ok(accessCall > featureBranch);
  assert.ok(quotaCall > accessCall);
  assert.match(source, /feature !== undefined && feature !== "academy_schedule"/);
  assert.match(source, /feature === "academy_schedule" \|\| academyPayloadRequested[\s\S]+\{ over: null, refund: async \(\) => \{\} \}/);
});

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
    return { success: true, meta: { changes: Number(result.changes ?? 0) }, results: [] };
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

function futureTimestamp() {
  return new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
}

function pastTimestamp() {
  return new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
}

function createDb() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`
    CREATE TABLE users(id TEXT PRIMARY KEY, is_anonymous INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE families(
      id TEXT PRIMARY KEY,
      parent_id TEXT NOT NULL,
      user_tier TEXT DEFAULT 'free',
      subscription_tier TEXT DEFAULT 'free',
      created_at TEXT
    );
    CREATE TABLE family_members(
      id TEXT PRIMARY KEY,
      family_id TEXT NOT NULL,
      user_id TEXT,
      role TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT,
      last_selected_at TEXT
    );
    CREATE TABLE family_subscription(
      family_id TEXT PRIMARY KEY,
      status TEXT,
      trial_ends_at TEXT,
      current_period_end TEXT,
      remote_listen_enabled INTEGER DEFAULT 1
    );
    CREATE TABLE subscriptions(
      id TEXT PRIMARY KEY,
      family_id TEXT NOT NULL,
      status TEXT NOT NULL,
      expires_at TEXT
    );
    CREATE TABLE family_review_rewards(
      family_id TEXT PRIMARY KEY,
      granted_at TEXT
    );
    CREATE TABLE ai_chat_usage(
      family_id TEXT NOT NULL,
      child_user_id TEXT NOT NULL,
      usage_date TEXT NOT NULL,
      count INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT,
      PRIMARY KEY(family_id, child_user_id, usage_date)
    );
    CREATE TABLE account_deletion_scopes(
      job_id TEXT NOT NULL,
      scope_type TEXT NOT NULL,
      scope_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY(scope_type, scope_id)
    );
    CREATE TABLE family_unpair_cleanup_jobs(
      id TEXT PRIMARY KEY,
      family_id TEXT NOT NULL,
      child_user_id TEXT NOT NULL
    );
    CREATE TABLE account_mutation_leases(
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      family_id TEXT,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);

  for (const [familyId, parentId, legacyTier] of [
    ["family-free", "parent-free", "free"],
    ["family-reviewed", "parent-reviewed", "free"],
    ["family-premium", "parent-premium", "free"],
    ["family-expired", "parent-expired", "premium"],
  ]) {
    sqlite.prepare("INSERT INTO users(id) VALUES (?)").run(parentId);
    sqlite.prepare(
      "INSERT INTO families(id,parent_id,user_tier,subscription_tier,created_at) VALUES (?,?,?,?,?)",
    ).run(familyId, parentId, legacyTier, legacyTier, "2026-08-01T00:00:00.000Z");
    sqlite.prepare(
      "INSERT INTO family_members(id,family_id,user_id,role,is_active,created_at) VALUES (?,?,?,?,1,?)",
    ).run(`member-${parentId}`, familyId, parentId, "parent", "2026-08-01T00:00:00.000Z");
  }
  sqlite.prepare("INSERT INTO family_members VALUES (?,?,?,?,?,?,?)")
    .run("member-premium-child", "family-premium", "premium-child", "child", 1, "2026-08-01T00:00:00.000Z", null);
  sqlite.prepare("INSERT INTO users(id) VALUES (?)").run("premium-child");
  sqlite.prepare("INSERT INTO family_review_rewards VALUES (?,?)")
    .run("family-reviewed", "2026-08-01T00:00:00.000Z");
  sqlite.prepare("INSERT INTO family_subscription VALUES (?,?,?,?,?)")
    .run("family-premium", "active", null, futureTimestamp(), 1);
  sqlite.prepare("INSERT INTO family_subscription VALUES (?,?,?,?,?)")
    .run("family-expired", "expired", null, pastTimestamp(), 1);

  return { sqlite, db: new D1DatabaseAdapter(sqlite) };
}

const { privateKey, publicKey } = await generateKeyPair("ES256", { extractable: true });
const jwtPrivateKey = JSON.stringify(await exportJWK(privateKey));
const jwtPublicKey = JSON.stringify(await exportJWK(publicKey));

async function bearer(sub, role, familyId) {
  const token = await new SignJWT({ role, family_id: familyId, is_anonymous: false })
    .setProtectedHeader({ alg: "ES256" })
    .setSubject(sub)
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(privateKey);
  return `Bearer ${token}`;
}

async function voiceParseRequest(db, input, caller) {
  const app = new Hono();
  app.route("/api/ai", aiRoutes);
  return app.request(
    "http://test.local/api/ai/voice-parse",
    {
      method: "POST",
      headers: {
        Authorization: await bearer(caller.sub, caller.role, caller.familyId),
        "content-type": "application/json",
      },
      body: JSON.stringify(input),
    },
    {
      DB: db,
      JWT_PRIVATE_KEY: jwtPrivateKey,
      JWT_PUBLIC_KEY: jwtPublicKey,
      OPENAI_API_KEY: "test-openai-key",
    },
  );
}

function successfulOpenAiResponse() {
  return new Response(JSON.stringify({
    choices: [{ message: { content: JSON.stringify({ action: "add_event", title: "일반 일정" }) } }],
  }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

test("feature를 생략해도 학원 목록을 실은 요청은 Free 부모의 Premium 학원 시간표 gate를 우회하지 못한다", async (t) => {
  const { sqlite, db } = createDb();
  let openAiCalls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    openAiCalls += 1;
    return successfulOpenAiResponse();
  });

  const response = await voiceParseRequest(db, {
    text: "월요일 피아노학원 3시, 수요일 수학학원 5시",
    mode: "paste",
    academies: [{ name: "피아노학원", category: "school" }],
    currentDate: { year: 2026, month: 7, day: 1 },
  }, {
    sub: "parent-free",
    role: "parent",
    familyId: "family-free",
  });

  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { error: "premium_required" });
  assert.equal(openAiCalls, 0);
  sqlite.close();
});

test("feature를 생략해도 학원 목록을 실은 요청은 Premium 가족의 아이 세션에서 실행되지 않는다", async (t) => {
  const { sqlite, db } = createDb();
  let openAiCalls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    openAiCalls += 1;
    return successfulOpenAiResponse();
  });

  const response = await voiceParseRequest(db, {
    text: "월요일 피아노학원 3시",
    mode: "paste",
    academies: [{ name: "피아노학원", category: "school" }],
    currentDate: { year: 2026, month: 7, day: 1 },
  }, {
    sub: "premium-child",
    role: "child",
    familyId: "family-premium",
  });

  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { error: "forbidden" });
  assert.equal(openAiCalls, 0);
  sqlite.close();
});

test("feature를 생략한 구버전 학원 목록 요청도 Premium 부모에게는 정상 실행된다", async (t) => {
  const { sqlite, db } = createDb();
  let openAiCalls = 0;
  let openAiSignal = null;
  t.mock.method(globalThis, "fetch", async (_url, init) => {
    openAiCalls += 1;
    openAiSignal = init?.signal ?? null;
    return successfulOpenAiResponse();
  });

  const response = await voiceParseRequest(db, {
    text: "월요일 피아노학원 3시",
    mode: "paste",
    academies: [{ name: "피아노학원", category: "school" }],
    currentDate: { year: 2026, month: 7, day: 1 },
  }, {
    sub: "parent-premium",
    role: "parent",
    familyId: "family-premium",
  });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { action: "add_event", title: "일반 일정" });
  assert.equal(openAiCalls, 1);
  assert.ok(openAiSignal instanceof AbortSignal);
  assert.equal(openAiSignal.aborted, false);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM ai_chat_usage").get().count, 0);
  sqlite.close();
});

test("voice-parse는 필드 상한을 넘긴 요청을 OpenAI·무료 쿼터 전에 거부한다", async (t) => {
  const { sqlite, db } = createDb();
  let openAiCalls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    openAiCalls += 1;
    return successfulOpenAiResponse();
  });

  const response = await voiceParseRequest(db, {
    text: "가".repeat(20_001),
    mode: "voice",
    currentDate: { year: 2026, month: 7, day: 1 },
  }, {
    sub: "parent-free",
    role: "parent",
    familyId: "family-free",
  });

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "voice_parse_text_too_large" });
  assert.equal(openAiCalls, 0);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM ai_chat_usage").get().count, 0);
  sqlite.close();
});

test("학원 목록이 없는 일반 음성 일정 파싱은 기존 Free 경로를 유지한다", async (t) => {
  const { sqlite, db } = createDb();
  let openAiCalls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    openAiCalls += 1;
    return successfulOpenAiResponse();
  });

  const response = await voiceParseRequest(db, {
    text: "내일 오후 3시에 할머니 댁 방문",
    mode: "voice",
    currentDate: { year: 2026, month: 7, day: 1 },
  }, {
    sub: "parent-free",
    role: "parent",
    familyId: "family-free",
  });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { action: "add_event", title: "일반 일정" });
  assert.equal(openAiCalls, 1);
  sqlite.close();
});

test("일반 voice-parse는 Free 부모에게 하루 5회까지 허용하고 6회째 정확한 429를 반환한다", async (t) => {
  const { sqlite, db } = createDb();
  let openAiCalls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    openAiCalls += 1;
    return successfulOpenAiResponse();
  });

  const input = {
    text: "내일 오후 3시에 할머니 댁 방문",
    mode: "voice",
    currentDate: { year: 2026, month: 7, day: 1 },
  };
  const caller = {
    sub: "parent-free",
    role: "parent",
    familyId: "family-free",
  };

  for (let attempt = 1; attempt <= 5; attempt += 1) {
    const response = await voiceParseRequest(db, input, caller);
    assert.equal(response.status, 200, `${attempt}회째 요청은 성공해야 합니다`);
    assert.deepEqual(await response.json(), { action: "add_event", title: "일반 일정" });
  }

  const exhausted = await voiceParseRequest(db, input, caller);
  assert.equal(exhausted.status, 429);
  assert.deepEqual(await exhausted.json(), {
    error: "daily_limit_reached",
    remaining: 0,
    dailyLimit: 5,
  });
  assert.equal(openAiCalls, 5);
  assert.equal(
    sqlite.prepare(
      "SELECT count FROM ai_chat_usage WHERE family_id=? AND child_user_id=?",
    ).get("family-free", "ai-parse:parent-free").count,
    5,
  );
  sqlite.close();
});

test("일반 voice-parse는 Premium 부모에게 Free 5회 상한을 적용하지 않는다", async (t) => {
  const { sqlite, db } = createDb();
  let openAiCalls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    openAiCalls += 1;
    return successfulOpenAiResponse();
  });

  const input = {
    text: "내일 오후 3시에 할머니 댁 방문",
    mode: "voice",
    currentDate: { year: 2026, month: 7, day: 1 },
  };
  const caller = {
    sub: "parent-premium",
    role: "parent",
    familyId: "family-premium",
  };

  for (let attempt = 1; attempt <= 6; attempt += 1) {
    const response = await voiceParseRequest(db, input, caller);
    assert.equal(response.status, 200, `${attempt}회째 요청은 성공해야 합니다`);
    assert.deepEqual(await response.json(), { action: "add_event", title: "일반 일정" });
  }

  assert.equal(openAiCalls, 6);
  assert.equal(
    sqlite.prepare(
      "SELECT COUNT(*) AS count FROM ai_chat_usage WHERE family_id=? AND child_user_id=?",
    ).get("family-premium", "ai-parse:parent-premium").count,
    0,
  );
  sqlite.close();
});

test("학원 시간표 요청은 공통 엔타이틀먼트가 확인한 Premium 부모만 허용한다", async () => {
  const { sqlite, db } = createDb();
  assert.deepEqual(
    await authorizeAcademyScheduleRequest(db, {
      sub: "parent-premium",
      family_id: "family-premium",
    }),
    { ok: true, familyId: "family-premium" },
  );
  sqlite.close();
});

test("Free·review grandfather·만료 구독은 학원 시간표 요청을 열지 않는다", async () => {
  const { sqlite, db } = createDb();
  for (const [sub, familyId] of [
    ["parent-free", "family-free"],
    ["parent-reviewed", "family-reviewed"],
    ["parent-expired", "family-expired"],
  ]) {
    assert.deepEqual(
      await authorizeAcademyScheduleRequest(db, { sub, family_id: familyId }),
      { ok: false, status: 403, error: "premium_required" },
    );
  }
  sqlite.close();
});

test("Premium 가족이어도 아이 세션은 학원 시간표 요청을 할 수 없다", async () => {
  const { sqlite, db } = createDb();
  assert.deepEqual(
    await authorizeAcademyScheduleRequest(db, {
      sub: "premium-child",
      family_id: "family-premium",
    }),
    { ok: false, status: 403, error: "forbidden" },
  );
  sqlite.close();
});

test("가족 정본·엔타이틀먼트 조회 오류는 Premium으로 추정하지 않고 503으로 닫는다", async () => {
  const { sqlite, db } = createDb();
  const failingDb = {
    prepare(sql) {
      if (sql.includes("family_subscription")) throw new Error("D1 unavailable");
      return db.prepare(sql);
    },
  };
  assert.deepEqual(
    await authorizeAcademyScheduleRequest(failingDb, {
      sub: "parent-premium",
      family_id: "family-premium",
    }),
    { ok: false, status: 503, error: "family_entitlement_unavailable" },
  );
  sqlite.close();
});
