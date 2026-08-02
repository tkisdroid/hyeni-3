import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { dirname, extname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test, { after } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

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

const migration = readFileSync(resolve(workerDir, "db/family-lifecycle-funnel.sql"), "utf8");
const canonicalSchema = readFileSync(resolve(repoDir, "cloudflare/schema_d1.sql"), "utf8");
const operationsSql = readFileSync(resolve(workerDir, "ops/family-lifecycle-kpis.sql"), "utf8");
const {
  recordFamilyLifecycleEvent,
  recordFamilyDailySignal,
} = await import(pathToFileURL(resolve(workerDir, "lib/familyLifecycleFunnel.ts")).href);
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
    if (this.owner.failLifecycleWrite && /family_lifecycle_(?:events|daily)/i.test(this.sql)) {
      throw new Error("injected lifecycle storage failure");
    }
    const result = this.owner.sqlite.prepare(this.sql).run(...this.bindings);
    return { success: true, meta: { changes: Number(result.changes) } };
  }
}

class Db {
  constructor(sqlite, { failLifecycleWrite = false } = {}) {
    this.sqlite = sqlite;
    this.failLifecycleWrite = failLifecycleWrite;
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
  sqlite.exec(`
    CREATE TABLE families(
      id TEXT PRIMARY KEY,
      parent_id TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE family_members(
      id TEXT PRIMARY KEY,
      family_id TEXT NOT NULL,
      user_id TEXT,
      role TEXT NOT NULL,
      name TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    );
    CREATE TABLE premium_funnel_events(event_id TEXT PRIMARY KEY, received_at TEXT NOT NULL);
    CREATE TABLE premium_funnel_rate_limits(
      family_key TEXT NOT NULL,
      window_key TEXT NOT NULL,
      event_count INTEGER NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY(family_key, window_key)
    );
  `);
  sqlite.exec(migration);
  sqlite.prepare("INSERT INTO families VALUES (?,?,?)")
    .run("family-a", "parent-a", "2026-08-01 00:00:00.000+00");
  sqlite.prepare("INSERT INTO family_members VALUES (?,?,?,?,?,?,?)")
    .run("parent-member", "family-a", "parent-a", "parent", "보호자", 1, "2026-08-01 00:00:00.000+00");
  return { sqlite, db: new Db(sqlite, options) };
}

function env(db, secret = "lifecycle-funnel-secret-32-bytes-minimum") {
  return { DB: db, PREMIUM_FUNNEL_HASH_SECRET: secret };
}

test("migration과 정본 스키마는 원시 가족·사용자·위치 없이 milestone·daily fact만 만든다", () => {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(migration);
  sqlite.exec(migration);
  const eventColumns = sqlite.prepare("PRAGMA table_info('family_lifecycle_events')").all().map((row) => row.name);
  const dailyColumns = sqlite.prepare("PRAGMA table_info('family_lifecycle_daily')").all().map((row) => row.name);

  assert.deepEqual(eventColumns, [
    "event_id", "family_key", "event", "elapsed_ms", "child_count", "child_platform",
    "occurred_at", "received_at",
  ]);
  assert.deepEqual(dailyColumns, [
    "family_key", "activity_date", "parent_active", "child_signal", "first_recorded_at", "updated_at",
  ]);
  const forbidden = /family_id|user_id|child_id|name|location|latitude|longitude|address|token|email|phone/i;
  assert.equal(eventColumns.some((column) => forbidden.test(column)), false);
  assert.equal(dailyColumns.some((column) => forbidden.test(column)), false);
  assert.match(canonicalSchema, /CREATE TABLE "family_lifecycle_events"/);
  assert.match(canonicalSchema, /CREATE TABLE "family_lifecycle_daily"/);
  sqlite.close();
});

test("가족 생성과 자녀 페어링은 같은 HMAC 가족키에 멱등 기록되고 Android·소요시간·자녀 수만 남긴다", async () => {
  const { sqlite, db } = createDb();
  const lifecycleEnv = env(db);
  const createdAt = "2026-08-01T00:00:00.000Z";

  const created = await recordFamilyLifecycleEvent(lifecycleEnv, {
    familyId: "family-a",
    event: "family_created",
    occurredAt: createdAt,
  }, new Date(createdAt));
  const duplicateCreated = await recordFamilyLifecycleEvent(lifecycleEnv, {
    familyId: "family-a",
    event: "family_created",
    occurredAt: createdAt,
  }, new Date("2026-08-01T00:01:00.000Z"));
  assert.deepEqual(created, { stored: true, duplicate: false });
  assert.deepEqual(duplicateCreated, { stored: true, duplicate: true });

  sqlite.prepare("INSERT INTO family_members VALUES (?,?,?,?,?,?,?)")
    .run("child-member-a", "family-a", "child-a", "child", "첫째", 1, "2026-08-01 00:05:00.000+00");
  assert.deepEqual(await recordFamilyLifecycleEvent(lifecycleEnv, {
    familyId: "family-a",
    event: "child_paired",
    dedupeKey: "unverified-client",
    occurredAt: "2026-08-01T00:04:00.000Z",
  }), { stored: false, reason: "invalid_input" });
  const firstPair = await recordFamilyLifecycleEvent(lifecycleEnv, {
    familyId: "family-a",
    event: "child_paired",
    dedupeKey: "child-a",
    childPlatform: "android",
    occurredAt: "2026-08-01T00:05:00.000Z",
  }, new Date("2026-08-01T00:05:00.000Z"));
  const duplicatePair = await recordFamilyLifecycleEvent(lifecycleEnv, {
    familyId: "family-a",
    event: "child_paired",
    dedupeKey: "child-a",
    childPlatform: "android",
    occurredAt: "2026-08-01T00:06:00.000Z",
  }, new Date("2026-08-01T00:06:00.000Z"));
  sqlite.prepare("INSERT INTO family_members VALUES (?,?,?,?,?,?,?)")
    .run("child-member-b", "family-a", "child-b", "child", "둘째", 1, "2026-08-01 00:10:00.000+00");
  const secondPair = await recordFamilyLifecycleEvent(lifecycleEnv, {
    familyId: "family-a",
    event: "child_paired",
    dedupeKey: "child-b",
    childPlatform: "android",
    occurredAt: "2026-08-01T00:10:00.000Z",
  }, new Date("2026-08-01T00:10:00.000Z"));

  assert.deepEqual(firstPair, { stored: true, duplicate: false });
  assert.deepEqual(duplicatePair, { stored: true, duplicate: true });
  assert.deepEqual(secondPair, { stored: true, duplicate: false });
  const pairs = sqlite.prepare(
    "SELECT elapsed_ms,child_count,child_platform FROM family_lifecycle_events WHERE event='child_paired' ORDER BY occurred_at",
  ).all();
  assert.deepEqual(pairs.map((row) => ({ ...row })), [
    { elapsed_ms: 300_000, child_count: 1, child_platform: "android" },
    { elapsed_ms: 600_000, child_count: 2, child_platform: "android" },
  ]);
  const persisted = JSON.stringify([
    ...sqlite.prepare("SELECT * FROM family_lifecycle_events").all(),
    ...sqlite.prepare("SELECT * FROM family_lifecycle_daily").all(),
  ]);
  for (const forbidden of ["family-a", "parent-a", "child-a", "child-b", "보호자", "첫째", "둘째"]) {
    assert.equal(persisted.includes(forbidden), false, `${forbidden}가 분석 fact에 남으면 안 됩니다`);
  }
  sqlite.close();
});

test("첫 실측 위치·첫 도착은 가족당 최초 1건만 남고 첫 위치는 KST child signal도 원자 upsert한다", async () => {
  const { sqlite, db } = createDb();
  const lifecycleEnv = env(db);
  const firstLocation = await recordFamilyLifecycleEvent(lifecycleEnv, {
    familyId: "family-a",
    event: "first_location",
    occurredAt: "2026-08-01T15:30:00.000Z",
  }, new Date("2026-08-01T15:30:01.000Z"));
  const laterLocation = await recordFamilyLifecycleEvent(lifecycleEnv, {
    familyId: "family-a",
    event: "first_location",
    occurredAt: "2026-08-01T16:00:00.000Z",
  }, new Date("2026-08-01T16:00:01.000Z"));
  await recordFamilyLifecycleEvent(lifecycleEnv, {
    familyId: "family-a",
    event: "first_arrival",
    occurredAt: "2026-08-02T01:00:00.000Z",
  }, new Date("2026-08-02T01:00:01.000Z"));
  const laterArrival = await recordFamilyLifecycleEvent(lifecycleEnv, {
    familyId: "family-a",
    event: "first_arrival",
    occurredAt: "2026-08-03T01:00:00.000Z",
  }, new Date("2026-08-03T01:00:01.000Z"));

  assert.deepEqual(firstLocation, { stored: true, duplicate: false });
  assert.deepEqual(laterLocation, { stored: true, duplicate: true });
  assert.deepEqual(laterArrival, { stored: true, duplicate: true });
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM family_lifecycle_events WHERE event='first_location'").get().n, 1);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM family_lifecycle_events WHERE event='first_arrival'").get().n, 1);
  assert.deepEqual({ ...sqlite.prepare("SELECT activity_date,parent_active,child_signal FROM family_lifecycle_daily").get() }, {
    activity_date: "2026-08-02",
    parent_active: 0,
    child_signal: 1,
  });
  sqlite.close();
});

test("일별 활동은 같은 KST 가족·날짜 행에 부모와 자녀 신호를 합쳐 D7/D30·MAF 원천을 만든다", async () => {
  const { sqlite, db } = createDb();
  const lifecycleEnv = env(db);
  await recordFamilyDailySignal(lifecycleEnv, {
    familyId: "family-a",
    signal: "parent_active",
    occurredAt: "2026-08-08T15:10:00.000Z",
  }, new Date("2026-08-08T15:10:01.000Z"));
  await recordFamilyDailySignal(lifecycleEnv, {
    familyId: "family-a",
    signal: "child_signal",
    occurredAt: "2026-08-09T02:00:00.000Z",
  }, new Date("2026-08-09T02:00:01.000Z"));
  await recordFamilyDailySignal(lifecycleEnv, {
    familyId: "family-a",
    signal: "parent_active",
    occurredAt: "2026-08-09T02:30:00.000Z",
  }, new Date("2026-08-09T02:30:01.000Z"));

  const rows = sqlite.prepare(
    "SELECT activity_date,parent_active,child_signal FROM family_lifecycle_daily ORDER BY activity_date",
  ).all();
  assert.deepEqual(rows.map((row) => ({ ...row })), [{
    activity_date: "2026-08-09",
    parent_active: 1,
    child_signal: 1,
  }]);
  assert.match(operationsSql, /D7/i);
  assert.match(operationsSql, /D30/i);
  assert.match(operationsSql, /MAF/i);
  assert.match(operationsSql, /premium_funnel_events/);
  assert.match(operationsSql, /gross/i);
  assert.match(operationsSql, /순매출[^\n]*(?:계산|산출)[^\n]*(?:않|불가)/);
  sqlite.close();
});

test("계측 설정·저장소 오류는 제품 흐름으로 전파하지 않고 원시 payload도 받지 않는다", async () => {
  const { sqlite, db } = createDb();
  assert.deepEqual(await recordFamilyLifecycleEvent(env(db, ""), {
    familyId: "family-a",
    event: "first_location",
    occurredAt: "2026-08-02T00:00:00.000Z",
  }), { stored: false, reason: "not_configured" });

  const failing = new Db(sqlite, { failLifecycleWrite: true });
  assert.deepEqual(await recordFamilyDailySignal(env(failing), {
    familyId: "family-a",
    signal: "parent_active",
    occurredAt: "2026-08-02T00:00:00.000Z",
  }), { stored: false, reason: "storage_unavailable" });
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM family_lifecycle_events").get().n, 0);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM family_lifecycle_daily").get().n, 0);
  sqlite.close();
});

test("180일 retention은 결제 퍼널과 lifecycle milestone·daily를 함께 멱등 삭제한다", async () => {
  const { sqlite, db } = createDb();
  const old = "2026-01-01T00:00:00.000Z";
  const fresh = "2026-07-31T00:00:00.000Z";
  const familyKey = "a".repeat(64);
  sqlite.prepare("INSERT INTO premium_funnel_events VALUES (?,?)").run("old-premium", old);
  sqlite.prepare("INSERT INTO premium_funnel_events VALUES (?,?)").run("fresh-premium", fresh);
  sqlite.prepare("INSERT INTO premium_funnel_rate_limits VALUES (?,?,?,?)").run(familyKey, "2026-01-01T00", 1, old);
  sqlite.prepare(
    "INSERT INTO family_lifecycle_events(event_id,family_key,event,elapsed_ms,occurred_at,received_at) VALUES (?,?,?,?,?,?)",
  ).run("11111111-1111-5111-8111-111111111111", familyKey, "first_location", 0, old, old);
  sqlite.prepare(
    "INSERT INTO family_lifecycle_events(event_id,family_key,event,elapsed_ms,occurred_at,received_at) VALUES (?,?,?,?,?,?)",
  ).run("22222222-2222-5222-8222-222222222222", familyKey, "first_arrival", 0, fresh, fresh);
  sqlite.prepare(
    "INSERT INTO family_lifecycle_daily(family_key,activity_date,parent_active,child_signal,first_recorded_at,updated_at) VALUES (?,?,?,?,?,?)",
  ).run(familyKey, "2026-01-01", 1, 1, old, old);
  sqlite.prepare(
    "INSERT INTO family_lifecycle_daily(family_key,activity_date,parent_active,child_signal,first_recorded_at,updated_at) VALUES (?,?,?,?,?,?)",
  ).run(familyKey, "2026-07-31", 1, 1, fresh, fresh);

  const now = new Date("2026-08-01T00:00:00.000Z");
  assert.deepEqual(await cleanupPremiumFunnelRetention(db, now), {
    removedEvents: 1,
    removedRateWindows: 1,
    removedLifecycleEvents: 1,
    removedLifecycleDays: 1,
  });
  assert.deepEqual(await cleanupPremiumFunnelRetention(db, now), {
    removedEvents: 0,
    removedRateWindows: 0,
    removedLifecycleEvents: 0,
    removedLifecycleDays: 0,
  });
  sqlite.close();
});

test("lifecycle retention은 시간 선두 인덱스와 5천 행 상한 삭제를 사용한다", () => {
  assert.match(migration, /idx_family_lifecycle_received[\s\S]*received_at[\s\S]*event_id/);
  assert.match(migration, /idx_family_lifecycle_daily_updated[\s\S]*updated_at/);
  assert.match(canonicalSchema, /idx_family_lifecycle_received/);
  assert.match(canonicalSchema, /idx_family_lifecycle_daily_updated/);
  const retention = readFileSync(
    resolve(workerDir, "cron/premium-funnel-retention.ts"),
    "utf8",
  );
  assert.equal((retention.match(/LIMIT \?/g) ?? []).length, 4);
  assert.match(retention, /PREMIUM_FUNNEL_DELETE_BATCH\s*=\s*5_000/);
});

test("가족 생성·페어링·위치·도착·부모 세션의 실제 성공 경로가 fail-soft recorder에 연결된다", () => {
  const familyRoute = readFileSync(resolve(workerDir, "routes/family.ts"), "utf8");
  const locationRpc = readFileSync(resolve(workerDir, "routes/rest-shim-rpc.ts"), "utf8");
  const locationFallback = readFileSync(resolve(workerDir, "routes/rest-shim-table.ts"), "utf8");
  const parentAlert = readFileSync(resolve(workerDir, "routes/push-notify.ts"), "utf8");
  const jwt = readFileSync(resolve(workerDir, "lib/jwt.ts"), "utf8");

  assert.match(familyRoute, /event:\s*"family_created"/);
  assert.match(familyRoute, /event:\s*"child_paired"/);
  assert.match(familyRoute, /dedupeKey:\s*sessionUserId/);
  assert.match(familyRoute, /childPlatform:\s*"android"/);
  assert.match(locationRpc, /event:\s*"first_location"/);
  assert.match(locationFallback, /event:\s*"first_location"/);
  assert.match(parentAlert, /event:\s*"first_arrival"/);
  assert.match(jwt, /signal:\s*"parent_active"/);
});
