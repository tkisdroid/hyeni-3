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

const premiumFunnelRoutes = (
  await import(pathToFileURL(resolve(workerDir, "routes/premium-funnel.ts")).href)
).default;
const {
  MAX_PREMIUM_FUNNEL_EVENTS_PER_HOUR,
  createServerPremiumFunnelEventId,
  hashPremiumFunnelFamily,
  premiumFunnelRateWindow,
  readBoundedPremiumFunnelJson,
  recordServerPremiumFunnelEvent,
} = await import(pathToFileURL(resolve(workerDir, "lib/premiumFunnel.ts")).href);
const { cleanupPremiumFunnelRetention } = await import(
  pathToFileURL(resolve(workerDir, "cron/premium-funnel-retention.ts")).href
);

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
    if (this.owner.failFunnelInsert && /INSERT\s+(?:OR\s+IGNORE\s+)?INTO\s+premium_funnel_events/i.test(this.sql)) {
      throw new Error("injected funnel storage failure");
    }
    const result = this.owner.sqlite.prepare(this.sql).run(...this.bindings);
    return { success: true, meta: { changes: Number(result.changes) } };
  }
}

class Db {
  constructor(sqlite, { failFunnelInsert = false } = {}) {
    this.sqlite = sqlite;
    this.failFunnelInsert = failFunnelInsert;
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
  ).run("parent-a", "parent@example.com", "{}", "2026-08-01T00:00:00.000Z");
  sqlite.prepare(
    "INSERT INTO users(id,email,is_anonymous,raw_user_meta_data,created_at) VALUES (?,?,0,?,?)",
  ).run("child-a", null, "{}", "2026-08-01T00:00:00.000Z");
  sqlite.prepare(
    "INSERT INTO users(id,email,is_anonymous,raw_user_meta_data,created_at) VALUES (?,?,0,?,?)",
  ).run("old-parent", "old@example.com", "{}", "2026-08-01T00:00:00.000Z");
  sqlite.prepare("INSERT INTO families(id,parent_id,pair_code,created_at) VALUES (?,?,?,?)")
    .run("family-a", "parent-a", "PAIR-A", "2026-08-01T00:00:00.000Z");
  sqlite.prepare(
    `INSERT INTO family_members
       (id,family_id,user_id,role,name,is_active,created_at)
     VALUES (?,?,?,?,?,1,?)`,
  ).run("member-parent-a", "family-a", "parent-a", "parent", "부모", "2026-08-01T00:00:00.000Z");
  sqlite.prepare(
    `INSERT INTO family_members
       (id,family_id,user_id,role,name,is_active,created_at)
     VALUES (?,?,?,?,?,1,?)`,
  ).run("member-child-a", "family-a", "child-a", "child", "아이", "2026-08-01T00:00:00.000Z");
  sqlite.prepare(
    `INSERT INTO family_members
       (id,family_id,user_id,role,name,is_active,created_at)
     VALUES (?,?,?,?,?,0,?)`,
  ).run("member-old-parent", "family-a", "old-parent", "parent", "옛 부모", "2026-08-01T00:00:00.000Z");
  return { sqlite, db: new Db(sqlite, options) };
}

const { privateKey, publicKey } = await generateKeyPair("ES256", { extractable: true });
const jwtPrivateKey = JSON.stringify(await exportJWK(privateKey));
const jwtPublicKey = JSON.stringify(await exportJWK(publicKey));
const HASH_SECRET = "premium-funnel-test-secret-32-bytes-minimum";

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
    PREMIUM_FUNNEL_HASH_SECRET: HASH_SECRET,
    ...overrides,
  };
}

function validEvent(index = 1, overrides = {}) {
  return {
    event_id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    event: "paywall_impression",
    source: "saved_place",
    tier: "free",
    app_version: "1.2.0",
    occurred_at: new Date().toISOString(),
    ...overrides,
  };
}

function normalizeSchemaSql(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/if\s+not\s+exists/g, "")
    .replace(/["\s]/g, "");
}

function schemaDefinitions(sqlite, type, table) {
  return sqlite.prepare(`
    SELECT name,sql FROM sqlite_schema
     WHERE type=? AND tbl_name=? AND sql IS NOT NULL
     ORDER BY name
  `).all(type, table).map((row) => ({
    name: row.name,
    sql: normalizeSchemaSql(row.sql),
  }));
}

async function request(db, body, options = {}) {
  const app = new Hono();
  app.route("/api/premium-funnel", premiumFunnelRoutes);
  const headers = { "Content-Type": "application/json" };
  if (options.auth !== false) headers.Authorization = await authorization(options.actor);
  return app.request(
    "http://test.local/api/premium-funnel/events",
    { method: "POST", headers, body: typeof body === "string" ? body : JSON.stringify(body) },
    env(db, options.env),
  );
}

test("증분·정본 스키마는 원시 family/user나 JSON payload 없이 allowlist 열만 만든다", () => {
  const migration = readFileSync(resolve(workerDir, "db/premium-funnel.sql"), "utf8");
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(migration);
  sqlite.exec(migration);

  const columns = sqlite.prepare("PRAGMA table_info('premium_funnel_events')").all().map((row) => row.name);
  assert.deepEqual(columns, [
    "event_id",
    "family_key",
    "event",
    "source",
    "tier",
    "provider",
    "plan",
    "result",
    "error_code",
    "app_version",
    "occurred_at",
    "received_at",
  ]);
  assert.equal(columns.includes("family_id"), false);
  assert.equal(columns.includes("user_id"), false);
  assert.equal(columns.includes("payload"), false);
  assert.deepEqual(
    sqlite.prepare("PRAGMA table_info('premium_funnel_rate_limits')").all().map((row) => row.name),
    ["family_key", "window_key", "event_count", "updated_at"],
  );
});

test("기존 premium funnel의 행·인덱스를 보존하며 ai_friend_limit source CHECK를 전진 적용한다", () => {
  const baseMigration = readFileSync(resolve(workerDir, "db/premium-funnel.sql"), "utf8");
  const forwardMigration = readFileSync(
    resolve(workerDir, "db/premium-funnel-ai-friend-limit.sql"),
    "utf8",
  );
  const aiFriendCanonicalMigration = baseMigration.replace(
    "'remote_ring', 'remote_audio', 'ai_friend_limit', 'ai_schedule_limit', 'ai_daily_summary'",
    "'remote_ring', 'remote_audio', 'ai_friend_limit', 'ai_daily_summary'",
  );
  assert.notEqual(aiFriendCanonicalMigration, baseMigration);
  const legacyMigration = aiFriendCanonicalMigration.replace(
    "'remote_ring', 'remote_audio', 'ai_friend_limit', 'ai_daily_summary'",
    "'remote_ring', 'remote_audio', 'ai_daily_summary'",
  );
  assert.notEqual(legacyMigration, aiFriendCanonicalMigration);

  const canonical = new DatabaseSync(":memory:");
  canonical.exec(aiFriendCanonicalMigration);
  const canonicalTable = schemaDefinitions(canonical, "table", "premium_funnel_events");
  const canonicalIndexes = schemaDefinitions(canonical, "index", "premium_funnel_events");
  canonical.close();

  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(legacyMigration);
  const insert = sqlite.prepare(`
    INSERT INTO premium_funnel_events(
      event_id,family_key,event,source,tier,provider,plan,result,error_code,
      app_version,occurred_at,received_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
  `);
  const occurredAt = "2026-08-02T00:00:00.000Z";
  insert.run(
    "10000000-0000-4000-8000-000000000001",
    "a".repeat(64),
    "paywall_impression",
    "saved_place",
    "free",
    null,
    null,
    null,
    null,
    "1.3.0",
    occurredAt,
    occurredAt,
  );
  insert.run(
    "10000000-0000-4000-8000-000000000002",
    "b".repeat(64),
    "checkout_result",
    null,
    null,
    "google_play",
    null,
    "fail",
    "network_error",
    "1.3.0",
    occurredAt,
    occurredAt,
  );
  insert.run(
    "10000000-0000-4000-8000-000000000003",
    "c".repeat(64),
    "renewal",
    null,
    null,
    "toss_payments",
    "year",
    null,
    null,
    null,
    occurredAt,
    occurredAt,
  );
  assert.throws(
    () => insert.run(
      "10000000-0000-4000-8000-000000000004",
      "d".repeat(64),
      "paywall_cta",
      "ai_friend_limit",
      "free",
      null,
      null,
      null,
      null,
      "1.3.0",
      occurredAt,
      occurredAt,
    ),
    /CHECK constraint failed/,
  );

  const beforeRows = sqlite.prepare(
    "SELECT * FROM premium_funnel_events ORDER BY event_id",
  ).all().map((row) => ({ ...row }));
  sqlite.exec(forwardMigration);

  assert.deepEqual(
    sqlite.prepare("SELECT * FROM premium_funnel_events ORDER BY event_id")
      .all().map((row) => ({ ...row })),
    beforeRows,
  );
  assert.deepEqual(
    schemaDefinitions(sqlite, "table", "premium_funnel_events"),
    canonicalTable,
  );
  assert.deepEqual(
    schemaDefinitions(sqlite, "index", "premium_funnel_events"),
    canonicalIndexes,
  );
  assert.equal(
    sqlite.prepare(`
      SELECT COUNT(*) AS count FROM sqlite_schema
       WHERE name IN (
         '_premium_funnel_events_ai_friend_limit_20260802',
         '_premium_funnel_events_before_ai_friend_limit_20260802'
       )
    `).get().count,
    0,
  );

  insert.run(
    "10000000-0000-4000-8000-000000000004",
    "d".repeat(64),
    "paywall_cta",
    "ai_friend_limit",
    "free",
    null,
    null,
    null,
    null,
    "1.3.0",
    occurredAt,
    occurredAt,
  );
  assert.throws(
    () => insert.run(
      "10000000-0000-4000-8000-000000000005",
      "e".repeat(64),
      "paywall_cta",
      "unknown_source",
      "free",
      null,
      null,
      null,
      null,
      "1.3.0",
      occurredAt,
      occurredAt,
    ),
    /CHECK constraint failed/,
  );
  assert.equal(sqlite.prepare("PRAGMA integrity_check").get().integrity_check, "ok");
  sqlite.close();
});

test("기존 premium funnel의 행·인덱스를 보존하며 ai_schedule_limit source CHECK를 전진 적용한다", () => {
  const baseMigration = readFileSync(resolve(workerDir, "db/premium-funnel.sql"), "utf8");
  const forwardMigration = readFileSync(
    resolve(workerDir, "db/premium-funnel-ai-schedule-limit.sql"),
    "utf8",
  );
  const legacyMigration = baseMigration.replace(
    "'remote_ring', 'remote_audio', 'ai_friend_limit', 'ai_schedule_limit', 'ai_daily_summary'",
    "'remote_ring', 'remote_audio', 'ai_friend_limit', 'ai_daily_summary'",
  );
  assert.notEqual(legacyMigration, baseMigration);

  const canonical = new DatabaseSync(":memory:");
  canonical.exec(baseMigration);
  const canonicalTable = schemaDefinitions(canonical, "table", "premium_funnel_events");
  const canonicalIndexes = schemaDefinitions(canonical, "index", "premium_funnel_events");
  canonical.close();

  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(legacyMigration);
  const insert = sqlite.prepare(`
    INSERT INTO premium_funnel_events(
      event_id,family_key,event,source,tier,provider,plan,result,error_code,
      app_version,occurred_at,received_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
  `);
  const occurredAt = "2026-08-02T00:00:00.000Z";
  insert.run(
    "11000000-0000-4000-8000-000000000001",
    "a".repeat(64),
    "paywall_impression",
    "ai_friend_limit",
    "free",
    null,
    null,
    null,
    null,
    "1.3.0",
    occurredAt,
    occurredAt,
  );
  insert.run(
    "11000000-0000-4000-8000-000000000002",
    "b".repeat(64),
    "checkout_result",
    null,
    null,
    "google_play",
    null,
    "fail",
    "network_error",
    "1.3.0",
    occurredAt,
    occurredAt,
  );
  insert.run(
    "11000000-0000-4000-8000-000000000003",
    "c".repeat(64),
    "renewal",
    null,
    null,
    "toss_payments",
    "year",
    null,
    null,
    null,
    occurredAt,
    occurredAt,
  );
  assert.throws(
    () => insert.run(
      "11000000-0000-4000-8000-000000000004",
      "d".repeat(64),
      "paywall_cta",
      "ai_schedule_limit",
      "free",
      null,
      null,
      null,
      null,
      "1.3.0",
      occurredAt,
      occurredAt,
    ),
    /CHECK constraint failed/,
  );

  const beforeRows = sqlite.prepare(
    "SELECT * FROM premium_funnel_events ORDER BY event_id",
  ).all().map((row) => ({ ...row }));
  sqlite.exec(forwardMigration);

  assert.deepEqual(
    sqlite.prepare("SELECT * FROM premium_funnel_events ORDER BY event_id")
      .all().map((row) => ({ ...row })),
    beforeRows,
  );
  assert.deepEqual(
    schemaDefinitions(sqlite, "table", "premium_funnel_events"),
    canonicalTable,
  );
  assert.deepEqual(
    schemaDefinitions(sqlite, "index", "premium_funnel_events"),
    canonicalIndexes,
  );
  assert.equal(
    sqlite.prepare(`
      SELECT COUNT(*) AS count FROM sqlite_schema
       WHERE name IN (
         '_premium_funnel_events_ai_schedule_limit_20260802',
         '_premium_funnel_events_before_ai_schedule_limit_20260802'
       )
    `).get().count,
    0,
  );

  insert.run(
    "11000000-0000-4000-8000-000000000004",
    "d".repeat(64),
    "paywall_cta",
    "ai_schedule_limit",
    "free",
    null,
    null,
    null,
    null,
    "1.3.0",
    occurredAt,
    occurredAt,
  );
  assert.throws(
    () => insert.run(
      "11000000-0000-4000-8000-000000000005",
      "e".repeat(64),
      "paywall_cta",
      "unknown_source",
      "free",
      null,
      null,
      null,
      null,
      "1.3.0",
      occurredAt,
      occurredAt,
    ),
    /CHECK constraint failed/,
  );
  assert.equal(sqlite.prepare("PRAGMA integrity_check").get().integrity_check, "ok");
  sqlite.close();
});

test("active parent 이벤트는 서버 가족 HMAC 키와 서버 수신 시각으로만 영속한다", async () => {
  const { sqlite, db } = createDb();
  const response = await request(db, {
    events: [
      validEvent(1),
      validEvent(2, {
        event: "checkout_result",
        provider: "google_play",
        result: "success",
        error_code: null,
        source: undefined,
        tier: undefined,
      }),
      validEvent(3, { source: "first_location" }),
      validEvent(4, { event: "paywall_cta", source: "first_arrival" }),
      validEvent(5, { source: "location_live_interval" }),
      validEvent(6, { event: "paywall_cta", source: "ai_friend_limit" }),
      validEvent(7, { event: "paywall_cta", source: "ai_schedule_limit" }),
    ].map((event) => Object.fromEntries(Object.entries(event).filter(([, value]) => value !== undefined))),
  });

  assert.equal(response.status, 202);
  assert.deepEqual(await response.json(), { ok: true, accepted: 7, duplicates: 0 });
  const rows = sqlite.prepare("SELECT * FROM premium_funnel_events ORDER BY event_id").all();
  assert.equal(rows.length, 7);
  assert.equal(rows[0].family_key.length, 64);
  assert.notEqual(rows[0].family_key, "family-a");
  assert.equal(JSON.stringify(rows).includes("parent-a"), false);
  assert.equal(JSON.stringify(rows).includes("family-a"), false);
  assert.equal(new Date(rows[0].received_at).toISOString(), rows[0].received_at);
  assert.equal(rows[0].family_key, await hashPremiumFunnelFamily(HASH_SECRET, "family-a"));
});

test("인증되지 않았거나 active parent가 아닌 계정은 기록할 수 없다", async () => {
  const { db } = createDb();
  assert.equal((await request(db, { events: [validEvent()] }, { auth: false })).status, 401);
  assert.equal((await request(db, { events: [validEvent()] }, {
    actor: { sub: "child-a", role: "child", familyId: "family-a" },
  })).status, 403);
  assert.equal((await request(db, { events: [validEvent()] }, {
    actor: { sub: "old-parent", role: "parent", familyId: "family-a" },
  })).status, 403);
});

test("secret 미설정은 configured false 503이고 앱 입력의 가족 식별자는 거부한다", async () => {
  const { sqlite, db } = createDb();
  const unavailable = await request(db, { events: [validEvent()] }, {
    env: { PREMIUM_FUNNEL_HASH_SECRET: undefined },
  });
  assert.equal(unavailable.status, 503);
  assert.deepEqual(await unavailable.json(), {
    error: "premium_funnel_unavailable",
    configured: false,
  });
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM premium_funnel_events").get().count, 0);

  const forgedFamily = await request(db, {
    events: [{ ...validEvent(), family_id: "family-other" }],
  });
  assert.equal(forgedFamily.status, 400);
  assert.deepEqual(await forgedFamily.json(), { error: "invalid_premium_funnel_event" });
});

test("민감·자유 필드와 서버 정본 이벤트를 클라이언트 API에서 구조적으로 거부한다", async () => {
  const unsafe = [
    { ...validEvent(10), email: "parent@example.com" },
    { ...validEvent(11), price: 4900 },
    { ...validEvent(12), purchase_token: "token" },
    { ...validEvent(13), memo: "원문" },
    { ...validEvent(14), event: "entitlement_activated", provider: "google_play", plan: "month" },
    { ...validEvent(15), event: "trial_start", provider: "google_play", plan: "month" },
    { ...validEvent(16), event: "renewal", provider: "google_play", plan: "month" },
    { ...validEvent(17), event: "refund", provider: "google_play", plan: "month" },
  ];
  for (const event of unsafe) {
    const { db } = createDb();
    const response = await request(db, { events: [event] });
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: "invalid_premium_funnel_event" });
  }
});

test("배치·payload·UUID·앱버전·시각 편차를 서버가 제한한다", async () => {
  const { db } = createDb();
  const tooMany = await request(db, {
    events: Array.from({ length: 21 }, (_, index) => validEvent(index + 1)),
  });
  assert.equal(tooMany.status, 400);
  assert.deepEqual(await tooMany.json(), { error: "invalid_premium_funnel_batch" });

  const oversized = await request(db, JSON.stringify({ padding: "x".repeat(20_000) }));
  assert.equal(oversized.status, 413);
  assert.deepEqual(await oversized.json(), { error: "premium_funnel_payload_too_large" });

  const invalidCases = [
    { ...validEvent(31), event_id: "not-a-uuid" },
    { ...validEvent(32), app_version: "x".repeat(33) },
    { ...validEvent(33), occurred_at: new Date(Date.now() - 8 * 24 * 60 * 60_000).toISOString() },
    { ...validEvent(34), occurred_at: new Date(Date.now() + 11 * 60_000).toISOString() },
  ];
  for (const event of invalidCases) {
    const response = await request(db, { events: [event] });
    assert.equal(response.status, 400);
  }
});

test("초과 본문 스트림 취소가 실패해도 413 판정을 유지한다", async () => {
  const stream = new ReadableStream({
    pull(controller) {
      controller.enqueue(new Uint8Array(20_000));
    },
    cancel() {
      throw new Error("injected stream cancel failure");
    },
  });
  const requestWithFailingCancel = new Request("http://test.local/api/premium-funnel/events", {
    method: "POST",
    body: stream,
    duplex: "half",
  });

  assert.deepEqual(
    await readBoundedPremiumFunnelJson(requestWithFailingCancel),
    { ok: false, error: "payload_too_large" },
  );
});

test("event UUID는 재전송 멱등이고 신규 이벤트만 가족별 시간당 rate limit에 포함한다", async () => {
  const { sqlite, db } = createDb();
  const event = validEvent(41);
  const first = await request(db, { events: [event] });
  assert.equal(first.status, 202);
  const replay = await request(db, { events: [event] });
  assert.equal(replay.status, 202);
  assert.deepEqual(await replay.json(), { ok: true, accepted: 0, duplicates: 1 });
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM premium_funnel_events").get().count, 1);

  const familyKey = sqlite.prepare("SELECT family_key FROM premium_funnel_events LIMIT 1").get().family_key;
  sqlite.prepare(
    `UPDATE premium_funnel_rate_limits
        SET event_count = ?
      WHERE family_key = ? AND window_key = ?`,
  ).run(MAX_PREMIUM_FUNNEL_EVENTS_PER_HOUR, familyKey, premiumFunnelRateWindow(new Date()));
  const limited = await request(db, { events: [validEvent(42)] });
  assert.equal(limited.status, 429);
  assert.deepEqual(await limited.json(), { error: "premium_funnel_rate_limited" });

  const replayAfterLimit = await request(db, { events: [event] });
  assert.equal(replayAfterLimit.status, 202);
  assert.deepEqual(await replayAfterLimit.json(), { ok: true, accepted: 0, duplicates: 1 });
});

test("활성화·체험·갱신·환불은 실패를 전파하지 않는 서버 helper로만 기록한다", async () => {
  const { sqlite, db } = createDb();
  const stableId = await createServerPremiumFunnelEventId(HASH_SECRET, "provider-event-stable-key");
  assert.match(stableId, /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(
    await createServerPremiumFunnelEventId(HASH_SECRET, "provider-event-stable-key"),
    stableId,
  );

  for (const [index, event] of ["entitlement_activated", "trial_start", "renewal", "refund"].entries()) {
    const result = await recordServerPremiumFunnelEvent({
      DB: db,
      PREMIUM_FUNNEL_HASH_SECRET: HASH_SECRET,
    }, {
      event_id: index === 0 ? stableId : `10000000-0000-5000-8000-${String(index).padStart(12, "0")}`,
      family_id: "family-a",
      event,
      provider: "google_play",
      plan: "month",
      occurred_at: new Date().toISOString(),
    });
    assert.deepEqual(result, { stored: true, duplicate: false });
  }
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM premium_funnel_events").get().count, 4);

  const notConfigured = await recordServerPremiumFunnelEvent({ DB: db }, {
    event_id: "20000000-0000-5000-8000-000000000001",
    family_id: "family-a",
    event: "renewal",
    provider: "google_play",
    plan: "month",
    occurred_at: new Date().toISOString(),
  });
  assert.deepEqual(notConfigured, { stored: false, reason: "not_configured" });

  const failing = createDb({ failFunnelInsert: true });
  const storageFailure = await recordServerPremiumFunnelEvent({
    DB: failing.db,
    PREMIUM_FUNNEL_HASH_SECRET: HASH_SECRET,
  }, {
    event_id: "20000000-0000-5000-8000-000000000002",
    family_id: "family-a",
    event: "refund",
    provider: "toss_payments",
    plan: "year",
    occurred_at: new Date().toISOString(),
  });
  assert.deepEqual(storageFailure, { stored: false, reason: "storage_unavailable" });
});

test("hourly retention은 180일 지난 이벤트와 오래된 rate window를 멱등 삭제한다", async () => {
  const { sqlite, db } = createDb();
  const now = new Date("2026-08-01T12:00:00.000Z");
  const familyKey = await hashPremiumFunnelFamily(HASH_SECRET, "family-a");
  const insert = sqlite.prepare(
    `INSERT INTO premium_funnel_events
       (event_id, family_key, event, source, app_version, occurred_at, received_at)
     VALUES (?, ?, 'subscription_view', 'direct', '1.2.0', ?, ?)`,
  );
  insert.run("30000000-0000-4000-8000-000000000001", familyKey, "2026-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z");
  insert.run("30000000-0000-4000-8000-000000000002", familyKey, "2026-07-31T00:00:00.000Z", "2026-07-31T00:00:00.000Z");
  sqlite.prepare(
    "INSERT INTO premium_funnel_rate_limits(family_key,window_key,event_count,updated_at) VALUES (?,?,1,?)",
  ).run(familyKey, "2026-01-01T00", "2026-01-01T00:00:00.000Z");

  assert.deepEqual(await cleanupPremiumFunnelRetention(db, now), {
    removedEvents: 1,
    removedRateWindows: 1,
    removedLifecycleEvents: 0,
    removedLifecycleDays: 0,
  });
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM premium_funnel_events").get().count, 1);
  assert.deepEqual(await cleanupPremiumFunnelRetention(db, now), {
    removedEvents: 0,
    removedRateWindows: 0,
    removedLifecycleEvents: 0,
    removedLifecycleDays: 0,
  });
});
