import test, { after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
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

const retention = await import(
  pathToFileURL(resolve(workerDir, "cron/location-history-retention.ts")).href
);

class D1StatementAdapter {
  constructor(db, sql, bindings = [], beforeExecute = () => {}) {
    this.db = db;
    this.sql = sql;
    this.bindings = bindings;
    this.beforeExecute = beforeExecute;
  }

  bind(...bindings) {
    return new D1StatementAdapter(this.db, this.sql, bindings, this.beforeExecute);
  }

  async first() {
    this.beforeExecute();
    return this.db.prepare(this.sql).get(...this.bindings) ?? null;
  }

  async all() {
    this.beforeExecute();
    return { results: this.db.prepare(this.sql).all(...this.bindings) };
  }

  async run() {
    this.beforeExecute();
    const result = this.db.prepare(this.sql).run(...this.bindings);
    return { success: true, meta: { changes: Number(result.changes ?? 0) }, results: [] };
  }
}

class D1DatabaseAdapter {
  constructor(db, maxQueries = Number.POSITIVE_INFINITY) {
    this.db = db;
    this.maxQueries = maxQueries;
    this.queryCount = 0;
  }

  recordQuery() {
    this.queryCount += 1;
    if (this.queryCount > this.maxQueries) {
      throw new Error(`D1 query budget exceeded: ${this.queryCount}/${this.maxQueries}`);
    }
  }

  prepare(sql) {
    return new D1StatementAdapter(this.db, sql, [], () => this.recordQuery());
  }
}

function createDb() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`
    CREATE TABLE families(
      id TEXT PRIMARY KEY,
      parent_id TEXT NOT NULL,
      user_tier TEXT DEFAULT 'free',
      subscription_tier TEXT DEFAULT 'free'
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
    CREATE TABLE location_history(
      id INTEGER PRIMARY KEY,
      user_id TEXT NOT NULL,
      family_id TEXT NOT NULL,
      lat REAL NOT NULL,
      lng REAL NOT NULL,
      recorded_at TEXT NOT NULL,
      is_estimated INTEGER,
      accuracy_m REAL
    );
    CREATE INDEX idx_location_history_recorded_family
      ON location_history(substr(recorded_at, 1, 19), family_id);
    CREATE INDEX idx_location_history_family_recorded_norm
      ON location_history(family_id, substr(recorded_at, 1, 19));
  `);
  for (const familyId of ["family-free", "family-reviewed", "family-premium", "family-error"]) {
    sqlite.prepare("INSERT INTO families(id,parent_id) VALUES (?,?)")
      .run(familyId, `parent-${familyId}`);
  }
  sqlite.prepare("INSERT INTO family_review_rewards VALUES (?,?)")
    .run("family-reviewed", "2026-07-01 00:00:00+00");
  sqlite.prepare(
    "INSERT INTO family_subscription(family_id,status,current_period_end) VALUES (?,?,?)",
  ).run("family-premium", "active", "2026-09-01 00:00:00+00");
  return { sqlite, db: new D1DatabaseAdapter(sqlite) };
}

function addPoint(sqlite, familyId, recordedAt, lat) {
  sqlite.prepare(
    `INSERT INTO location_history(user_id,family_id,lat,lng,recorded_at,is_estimated,accuracy_m)
     VALUES (?,?,?,?,?,0,5)`,
  ).run(`child-${familyId}`, familyId, lat, 127, recordedAt);
}

test("보존 cutoff는 Free의 KST 08시 조회일과 Premium의 정확한 30일을 사용한다", () => {
  const now = new Date("2026-08-01T03:00:00.000Z");
  assert.equal(
    retention.locationHistoryRetentionCutoff("free", now).toISOString(),
    "2026-07-31T23:00:00.000Z",
  );
  assert.equal(
    retention.locationHistoryRetentionCutoff("premium", now).toISOString(),
    "2026-07-02T03:00:00.000Z",
  );
});

test("hourly retention은 Free·reviewed 당일과 Premium 30일을 남기며 재실행해도 멱등이다", async () => {
  const now = new Date("2026-08-01T03:00:00.000Z");
  const { sqlite, db } = createDb();

  addPoint(sqlite, "family-free", "2026-07-31 22:59:59+00", 1);
  addPoint(sqlite, "family-free", "2026-07-31 23:00:00+00", 2);
  addPoint(sqlite, "family-reviewed", "2026-07-30 00:00:00+00", 3);
  addPoint(sqlite, "family-reviewed", "2026-08-01 00:00:00+00", 4);
  addPoint(sqlite, "family-premium", "2026-07-02 02:59:59+00", 5);
  addPoint(sqlite, "family-premium", "2026-07-02 03:00:00+00", 6);
  addPoint(sqlite, "orphan-family", "2026-06-01 00:00:00+00", 7);

  const first = await retention.cleanupLocationHistoryRetention(db, now);
  assert.deepEqual(first, {
    removedRows: 4,
    processedFamilies: 3,
    skippedFamilies: 0,
    removedOrphanRows: 1,
  });
  assert.deepEqual(
    sqlite.prepare("SELECT family_id,lat FROM location_history ORDER BY family_id,lat").all()
      .map((row) => ({ ...row })),
    [
      { family_id: "family-free", lat: 2 },
      { family_id: "family-premium", lat: 6 },
      { family_id: "family-reviewed", lat: 4 },
    ],
  );

  const second = await retention.cleanupLocationHistoryRetention(db, now);
  assert.deepEqual(second, {
    removedRows: 0,
    processedFamilies: 0,
    skippedFamilies: 0,
    removedOrphanRows: 0,
  });
  sqlite.close();
});

test("30일 안 Premium 후보가 Free 정리 가족을 batch 밖으로 밀어내지 않는다", async () => {
  const now = new Date("2026-08-01T03:00:00.000Z");
  const { sqlite, db } = createDb();
  sqlite.prepare("DELETE FROM family_subscription WHERE family_id = ?").run("family-premium");

  for (let index = 0; index < retention.LOCATION_HISTORY_RETENTION_FAMILY_BATCH; index += 1) {
    const familyId = `a-premium-${String(index).padStart(3, "0")}`;
    sqlite.prepare("INSERT INTO families(id,parent_id) VALUES (?,?)").run(familyId, `parent-${index}`);
    sqlite.prepare(
      "INSERT INTO family_subscription(family_id,status,current_period_end) VALUES (?,?,?)",
    ).run(familyId, "active", "2099-01-01T00:00:00.000Z");
    addPoint(sqlite, familyId, "2026-07-30 03:00:00+00", index);
  }
  sqlite.prepare("INSERT INTO families(id,parent_id) VALUES (?,?)").run("z-family-free", "z-parent");
  addPoint(sqlite, "z-family-free", "2026-07-30 03:00:00+00", 999);

  const result = await retention.cleanupLocationHistoryRetention(db, now);
  assert.deepEqual(result, {
    removedRows: 1,
    processedFamilies: 1,
    skippedFamilies: 0,
    removedOrphanRows: 0,
  });
  assert.equal(
    sqlite.prepare("SELECT COUNT(*) AS n FROM location_history WHERE family_id=?")
      .get("z-family-free").n,
    0,
  );
  assert.equal(
    sqlite.prepare("SELECT COUNT(*) AS n FROM location_history WHERE family_id LIKE 'a-premium-%'")
      .get().n,
    retention.LOCATION_HISTORY_RETENTION_FAMILY_BATCH,
  );
  sqlite.close();
});

test("한 번의 retention 실행은 Free D1 호출당 50 query 예산을 넘지 않는다", async () => {
  const now = new Date("2026-08-01T03:00:00.000Z");
  const { sqlite } = createDb();
  const db = new D1DatabaseAdapter(sqlite, 50);

  for (let index = 0; index < 10; index += 1) {
    const familyId = `budget-family-${String(index).padStart(2, "0")}`;
    sqlite.prepare("INSERT INTO families(id,parent_id) VALUES (?,?)")
      .run(familyId, `budget-parent-${index}`);
    addPoint(sqlite, familyId, "2026-07-01 00:00:00+00", index);
  }

  const result = await retention.cleanupLocationHistoryRetention(db, now);

  assert.equal(result.processedFamilies, 9);
  assert.equal(db.queryCount, 47);
  assert.equal(
    sqlite.prepare("SELECT COUNT(DISTINCT family_id) AS n FROM location_history").get().n,
    1,
  );
  sqlite.close();
});

test("제한된 family batch는 식별자 순서가 아니라 가장 오래된 만료 원본부터 정리한다", async () => {
  const now = new Date("2026-08-01T03:00:00.000Z");
  const { sqlite, db } = createDb();

  for (let index = 0; index < 9; index += 1) {
    const familyId = `a-recent-${String(index).padStart(2, "0")}`;
    sqlite.prepare("INSERT INTO families(id,parent_id) VALUES (?,?)")
      .run(familyId, `recent-parent-${index}`);
    addPoint(sqlite, familyId, "2026-07-30 00:00:00+00", index);
  }
  sqlite.prepare("INSERT INTO families(id,parent_id) VALUES (?,?)")
    .run("z-oldest", "oldest-parent");
  addPoint(sqlite, "z-oldest", "2026-06-01 00:00:00+00", 999);

  const result = await retention.cleanupLocationHistoryRetention(db, now);

  assert.equal(result.processedFamilies, 9);
  assert.equal(
    sqlite.prepare("SELECT COUNT(*) AS n FROM location_history WHERE family_id = ?")
      .get("z-oldest").n,
    0,
  );
  assert.equal(
    sqlite.prepare("SELECT COUNT(*) AS n FROM location_history WHERE family_id LIKE 'a-recent-%'")
      .get().n,
    1,
  );
  sqlite.close();
});

test("엔타이틀먼트 판정 실패 가족은 원본을 삭제하지 않고 다른 가족 정리는 계속한다", async (t) => {
  t.mock.method(console, "warn", () => {});
  const now = new Date("2026-08-01T03:00:00.000Z");
  const { sqlite, db } = createDb();
  addPoint(sqlite, "family-free", "2026-07-01 00:00:00+00", 1);
  addPoint(sqlite, "family-error", "2026-07-01 00:00:00+00", 2);

  const resolver = async (database, familyId, at) => {
    if (familyId === "family-error") throw new Error("D1 entitlement unavailable");
    return retention.resolveFamilyEntitlementForRetention(database, familyId, at);
  };
  const result = await retention.cleanupLocationHistoryRetention(db, now, resolver);
  assert.deepEqual(result, {
    removedRows: 1,
    processedFamilies: 1,
    skippedFamilies: 1,
    removedOrphanRows: 0,
  });
  assert.deepEqual(
    sqlite.prepare("SELECT family_id,lat FROM location_history").all().map((row) => ({ ...row })),
    [{ family_id: "family-error", lat: 2 }],
  );
  sqlite.close();
});

test("보존 migration은 좌표 원본 범위 인덱스만 추가하고 확인자료로 위장하지 않는다", () => {
  const migration = readFileSync(resolve(workerDir, "db/location-history-retention.sql"), "utf8");
  assert.match(migration, /idx_location_history_recorded_family/);
  assert.match(migration, /idx_location_history_family_recorded_norm/);
  assert.doesNotMatch(migration, /location_usage_audit|lat\s+REAL|lng\s+REAL/i);
});
