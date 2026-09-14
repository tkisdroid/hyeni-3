import test, { after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { dirname, extname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath, pathToFileURL } from "node:url";

const workerDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const quotaMigration = readFileSync(
  resolve(workerDir, "db/location-history-ingest-quota.sql"),
  "utf8",
);
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
const quota = await import(
  pathToFileURL(resolve(workerDir, "lib/locationHistoryIngestQuota.ts")).href
);

class D1StatementAdapter {
  constructor(owner, sql, bindings = []) {
    this.owner = owner;
    this.sql = sql;
    this.bindings = bindings;
  }

  bind(...bindings) {
    this.owner.boundParameterCounts.push(bindings.length);
    if (bindings.length > 100) {
      throw new Error(`D1_ERROR: too many SQL variables: ${bindings.length}`);
    }
    return new D1StatementAdapter(this.owner, this.sql, bindings);
  }

  async first() {
    this.owner.recordQuery();
    return this.owner.sqlite.prepare(this.sql).get(...this.bindings) ?? null;
  }

  async all() {
    this.owner.recordQuery();
    return { results: this.owner.sqlite.prepare(this.sql).all(...this.bindings) };
  }

  async run() {
    this.owner.recordQuery();
    const result = this.owner.sqlite.prepare(this.sql).run(...this.bindings);
    return { success: true, meta: { changes: Number(result.changes ?? 0) }, results: [] };
  }
}

class D1DatabaseAdapter {
  constructor(sqlite, maxQueries = Number.POSITIVE_INFINITY) {
    this.sqlite = sqlite;
    this.maxQueries = maxQueries;
    this.queryCount = 0;
    this.boundParameterCounts = [];
    this.beforeBatch = null;
  }

  recordQuery() {
    this.queryCount += 1;
    if (this.queryCount > this.maxQueries) {
      throw new Error(`D1 query budget exceeded: ${this.queryCount}/${this.maxQueries}`);
    }
  }

  resetBudget(maxQueries = this.maxQueries) {
    this.maxQueries = maxQueries;
    this.queryCount = 0;
    this.boundParameterCounts.length = 0;
  }

  prepare(sql) {
    return new D1StatementAdapter(this, sql);
  }

  async batch(statements) {
    if (this.beforeBatch) {
      const beforeBatch = this.beforeBatch;
      this.beforeBatch = null;
      await beforeBatch();
    }
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

function createDb(maxQueries = Number.POSITIVE_INFINITY) {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`
    CREATE TABLE families(id TEXT PRIMARY KEY, time_zone TEXT NOT NULL DEFAULT 'Asia/Seoul');
    INSERT INTO families(id) VALUES ('family-1');
    CREATE TABLE family_members(
      id TEXT PRIMARY KEY,
      family_id TEXT NOT NULL,
      user_id TEXT,
      role TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE location_history(
      id INTEGER PRIMARY KEY,
      user_id TEXT NOT NULL,
      family_id TEXT NOT NULL,
      lat REAL NOT NULL,
      lng REAL NOT NULL,
      accuracy_m REAL,
      recorded_at TEXT NOT NULL,
      is_estimated INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX idx_location_history_user_recorded
      ON location_history(user_id, recorded_at);
    CREATE TABLE location_history_trigger_log(
      history_id INTEGER PRIMARY KEY,
      recorded_at TEXT NOT NULL
    );
    CREATE TRIGGER location_history_test_trigger
    AFTER INSERT ON location_history
    BEGIN
      INSERT INTO location_history_trigger_log(history_id, recorded_at)
      VALUES (NEW.id, NEW.recorded_at);
    END;
    INSERT INTO family_members(id, family_id, user_id, role, is_active)
    VALUES ('member-child', 'family-1', 'child-1', 'child', 1);
  `);
  sqlite.exec(quotaMigration);
  sqlite.exec(readFileSync(new URL("../db/global-location-ingest-time-zone.sql", import.meta.url), "utf8"));
  return { sqlite, db: new D1DatabaseAdapter(sqlite, maxQueries) };
}

function createContext(db, rows) {
  return {
    env: { DB: db },
    req: { json: async () => ({ p_rows: rows }) },
    executionCtx: { waitUntil() {} },
    json(value, status = 200) {
      return Response.json(value, { status });
    },
    body(value, status = 200) {
      return new Response(value, { status });
    },
  };
}

function caller() {
  return { serviceRole: false, sub: "child-1", familyIds: ["family-1"] };
}

function row(recordedAt, index = 0) {
  return {
    user_id: "child-1",
    family_id: "family-1",
    lat: 37.2 + index / 1_000_000,
    lng: 127.1 + index / 1_000_000,
    accuracy_m: 8,
    recorded_at: recordedAt,
  };
}

test("Android 최대 400행 flush는 D1 bind 100·호출 query 50 한도 안에서 원자 저장되고 중복·trigger가 보존된다", async () => {
  const { sqlite, db } = createDb(37);
  const baseMs = Date.now() - 36 * 60 * 60_000;
  const rows = Array.from({ length: 400 }, (_, index) =>
    row(new Date(baseMs + index * 1_000).toISOString(), index));

  const response = await dispatchRpc(
    createContext(db, rows),
    "record_location_history_rows",
    caller(),
  );

  assert.equal(response.status, 204);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM location_history").get().count, 400);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM location_history_trigger_log").get().count, 400);
  assert.ok(db.queryCount <= 37, `RPC 내부 D1 query가 ${db.queryCount}회입니다`);
  assert.ok(Math.max(...db.boundParameterCounts) <= 100);
  assert.equal(
    sqlite.prepare("SELECT row_count AS n FROM location_history_ingest_daily_usage").get().n,
    400,
  );

  db.resetBudget(37);
  const duplicate = await dispatchRpc(
    createContext(db, rows),
    "record_location_history_rows",
    caller(),
  );
  assert.equal(duplicate.status, 204);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM location_history").get().count, 400);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM location_history_trigger_log").get().count, 400);
  assert.equal(
    sqlite.prepare("SELECT row_count AS n FROM location_history_ingest_daily_usage").get().n,
    400,
  );
  sqlite.close();
});

test("stale 중복 prefetch 뒤 다른 요청이 먼저 저장해도 실제 INSERT 0건이면 quota가 증가하지 않는다", async () => {
  const { sqlite, db } = createDb(37);
  const recordedAt = new Date(Date.now() - 60_000).toISOString();
  const storedRecordedAt = recordedAt.replace("T", " ").replace("Z", "+00");
  db.beforeBatch = () => {
    sqlite.prepare(
      `INSERT INTO location_history
         (user_id,family_id,lat,lng,accuracy_m,recorded_at,is_estimated)
       VALUES (?,?,?,?,?,?,?)`,
    ).run("child-1", "family-1", 37.2, 127.1, 8, storedRecordedAt, 0);
  };

  const response = await dispatchRpc(
    createContext(db, [row(recordedAt)]),
    "record_location_history_rows",
    caller(),
  );

  assert.equal(response.status, 204);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM location_history").get().n, 1);
  assert.equal(
    sqlite.prepare("SELECT row_count AS n FROM location_history_ingest_daily_usage").get().n,
    1,
  );
  sqlite.close();
});

test("400행을 넘는 payload는 저장 전에 거부한다", async () => {
  const { sqlite, db } = createDb(47);
  const baseMs = Date.now() - 60 * 60_000;
  const rows = Array.from({ length: 401 }, (_, index) =>
    row(new Date(baseMs + index * 1_000).toISOString(), index));

  const response = await dispatchRpc(
    createContext(db, rows),
    "record_location_history_rows",
    caller(),
  );

  assert.equal(response.status, 413);
  assert.deepEqual(await response.json(), { error: "too_many_rows", max: 400 });
  assert.equal(db.queryCount, 0);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM location_history").get().count, 0);
  sqlite.close();
});

test("recorded_at은 기존 fix 시각 계약대로 과거를 보존하고 작은 미래 오차만 현재로 clamp한다", async () => {
  const { sqlite, db } = createDb(47);
  const offlineAt = new Date(Date.now() - 47 * 60 * 60_000).toISOString();
  const nearFutureAt = new Date(Date.now() + 30_000).toISOString();
  const beforeMs = Date.now();

  const response = await dispatchRpc(
    createContext(db, [row(offlineAt), row(nearFutureAt, 1)]),
    "record_location_history_rows",
    caller(),
  );
  const afterMs = Date.now();

  assert.equal(response.status, 204);
  const stored = sqlite.prepare(
    "SELECT recorded_at FROM location_history ORDER BY recorded_at ASC",
  ).all();
  assert.equal(stored.length, 2);
  assert.equal(Date.parse(stored[0].recorded_at.replace(" ", "T").replace(/\+00$/, "Z")), Date.parse(offlineAt));
  const clampedMs = Date.parse(stored[1].recorded_at.replace(" ", "T").replace(/\+00$/, "Z"));
  assert.ok(clampedMs >= beforeMs && clampedMs <= afterMs);
  sqlite.close();
});

test("허용 오차를 넘는 미래 recorded_at은 전체 payload를 거부하고 저장하지 않는다", async () => {
  const { sqlite, db } = createDb(47);
  const futureAt = new Date(Date.now() + 2 * 60_000).toISOString();

  const response = await dispatchRpc(
    createContext(db, [row(futureAt)]),
    "record_location_history_rows",
    caller(),
  );

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "invalid_args" });
  assert.equal(db.queryCount, 0);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM location_history").get().count, 0);
  sqlite.close();
});

test("KST 기록일별 7,200행 상한은 초과 batch 전체를 429로 거부한다", async () => {
  const { sqlite, db } = createDb(47);
  // KST 자정 직후 실행돼도 201개 fixture가 서로 다른 기록일로 갈라지지 않게
  // 가장 최근의 KST 정오를 기준으로 고정한다.
  const nowMs = Date.now();
  const kstDate = new Date(nowMs + 9 * 60 * 60_000).toISOString().slice(0, 10);
  const currentKstNoonMs = Date.parse(`${kstDate}T03:00:00.000Z`);
  const baseMs = currentKstNoonMs <= nowMs - 5 * 60_000
    ? currentKstNoonMs
    : currentKstNoonMs - 24 * 60 * 60_000;
  const dateKey = new Date(baseMs + 9 * 60 * 60_000).toISOString().slice(0, 10);
  sqlite.prepare(
    `INSERT INTO location_history_ingest_daily_usage
       (user_id,date_key,row_count,last_claim_id,updated_at)
     VALUES (?,?,7000,?,?)`,
  ).run("child-1", dateKey, crypto.randomUUID(), new Date().toISOString());
  const rows = Array.from({ length: 201 }, (_, index) =>
    row(new Date(baseMs + index * 1_000).toISOString(), index));

  const response = await dispatchRpc(
    createContext(db, rows),
    "record_location_history_rows",
    caller(),
  );
  assert.equal(response.status, 429);
  assert.deepEqual(await response.json(), {
    error: "location_history_daily_quota_exceeded",
    maxPerDay: 7200,
  });
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM location_history").get().n, 0);
  assert.equal(
    sqlite.prepare("SELECT row_count AS n FROM location_history_ingest_daily_usage").get().n,
    7000,
  );
  sqlite.close();
});

test("위치 INSERT 실패는 같은 batch의 일일 quota claim도 rollback한다", async () => {
  const { sqlite, db } = createDb(47);
  sqlite.exec(`
    CREATE TRIGGER fail_location_history_insert
    BEFORE INSERT ON location_history
    BEGIN
      SELECT RAISE(ABORT, 'injected location failure');
    END;
  `);
  const response = await dispatchRpc(
    createContext(db, [row(new Date(Date.now() - 60_000).toISOString())]),
    "record_location_history_rows",
    caller(),
  );
  assert.equal(response.status, 500);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM location_history").get().n, 0);
  assert.equal(
    sqlite.prepare("SELECT COUNT(*) AS n FROM location_history_ingest_daily_usage").get().n,
    0,
  );
  sqlite.close();
});

test("31일보다 오래된 offline fix는 최신 버퍼를 막지 않도록 204로 폐기한다", async () => {
  const { sqlite, db } = createDb(47);
  const response = await dispatchRpc(
    createContext(db, [row(new Date(Date.now() - 32 * 24 * 60 * 60_000).toISOString())]),
    "record_location_history_rows",
    caller(),
  );
  assert.equal(response.status, 204);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM location_history").get().n, 0);
  assert.equal(
    sqlite.prepare("SELECT COUNT(*) AS n FROM location_history_ingest_daily_usage").get().n,
    0,
  );
  sqlite.close();
});

test("quota migration·정본 스키마와 35일 bounded cleanup이 일치한다", async () => {
  const migration = quotaMigration;
  const canonical = readFileSync(
    resolve(workerDir, "../cloudflare/schema_d1.sql"),
    "utf8",
  );
  assert.match(migration, /row_count[\s\S]*BETWEEN 0 AND 7200/);
  assert.match(migration, /idx_location_history_ingest_usage_date/);
  assert.match(migration, /trg_location_history_ingest_daily_quota/);
  assert.match(migration, /RAISE\(ABORT,'location_history_daily_quota_exceeded'\)/);
  assert.match(canonical, /location_history_ingest_daily_usage/);
  assert.match(canonical, /trg_location_history_ingest_daily_quota/);

  const backfill = new DatabaseSync(":memory:");
  backfill.exec(`
    CREATE TABLE location_history(
      id INTEGER PRIMARY KEY,
      user_id TEXT NOT NULL,
      family_id TEXT NOT NULL,
      lat REAL NOT NULL,
      lng REAL NOT NULL,
      recorded_at TEXT NOT NULL
    );
    INSERT INTO location_history(user_id,family_id,lat,lng,recorded_at) VALUES
      ('child-backfill','family-1',37.2,127.1,'2026-07-31 14:59:59.000+00'),
      ('child-backfill','family-1',37.2,127.1,'2026-07-31 15:00:00.000+00');
  `);
  backfill.exec(migration);
  backfill.exec(migration);
  assert.deepEqual(
    backfill.prepare(
      `SELECT date_key,row_count FROM location_history_ingest_daily_usage
        WHERE user_id='child-backfill' ORDER BY date_key`,
    ).all().map((row) => ({ ...row })),
    [
      { date_key: "2026-07-31", row_count: 1 },
      { date_key: "2026-08-01", row_count: 1 },
    ],
  );
  backfill.prepare(
    `INSERT INTO location_history(user_id,family_id,lat,lng,recorded_at)
     VALUES (?,?,?,?,?)`,
  ).run("child-backfill", "family-1", 37.2, 127.1, "2026-07-31 15:01:00.000+00");
  assert.equal(
    backfill.prepare(
      `SELECT row_count AS n FROM location_history_ingest_daily_usage
        WHERE user_id='child-backfill' AND date_key='2026-08-01'`,
    ).get().n,
    2,
  );
  backfill.close();

  const { sqlite, db } = createDb(47);
  sqlite.exec(migration);
  sqlite.exec(migration);
  const insert = sqlite.prepare(
    `INSERT INTO location_history_ingest_daily_usage
       (user_id,date_key,row_count,last_claim_id,updated_at)
     VALUES (?,?,?,?,?)`,
  );
  insert.run("old-child", "2026-06-01", 1, crypto.randomUUID(), "2026-06-01 00:00:00");
  insert.run("fresh-child", "2026-07-31", 1, crypto.randomUUID(), "2026-07-31 00:00:00");
  assert.deepEqual(
    await quota.cleanupLocationHistoryIngestDailyUsage(
      db,
      new Date("2026-08-01T00:00:00.000Z"),
    ),
    { removedRows: 1 },
  );
  assert.deepEqual(
    sqlite.prepare(
      "SELECT user_id FROM location_history_ingest_daily_usage ORDER BY user_id",
    ).all().map((row) => row.user_id),
    ["fresh-child"],
  );
  sqlite.close();
});

test("해외 업로드 한도는 서버가 정한 현지 기록일을 DB trigger와 공유하며 입력 위조를 무시한다", async () => {
  const { sqlite, db } = createDb(50);
  try {
    sqlite.exec("UPDATE families SET time_zone='America/Los_Angeles' WHERE id='family-1'");
    const now = new Date();
    const at = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()-1, 1);
    const point = { ...row(new Date(at).toISOString()), ingest_date_key: "1900-01-01" };
    const response = await dispatchRpc(createContext(db, [point]), "record_location_history_rows", caller());
    assert.equal(response.status, 204);
    const { isoDateAt } = await import("../lib/timeZone.ts");
    const dateKey = isoDateAt(at, "America/Los_Angeles");
    assert.notEqual(dateKey, isoDateAt(at, "Asia/Seoul"));
    assert.equal(sqlite.prepare("SELECT date_key FROM location_history_ingest_daily_usage").get().date_key, dateKey);
    assert.equal(sqlite.prepare("SELECT ingest_date_key FROM location_history").get().ingest_date_key, dateKey);
    assert.equal((await dispatchRpc(createContext(db,[point]), "record_location_history_rows", caller())).status,204);
    assert.equal(sqlite.prepare("SELECT row_count FROM location_history_ingest_daily_usage").get().row_count,1);
  } finally { sqlite.close(); }
});
