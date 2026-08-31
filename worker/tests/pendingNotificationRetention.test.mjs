import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

const retention = await import("../cron/pending-notification-retention.ts");

class Statement {
  constructor(sqlite, sql, bindings = []) {
    this.sqlite = sqlite;
    this.sql = sql;
    this.bindings = bindings;
  }

  bind(...bindings) {
    return new Statement(this.sqlite, this.sql, bindings);
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
}

function createDb() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`
    CREATE TABLE pending_notifications(
      id TEXT PRIMARY KEY,
      family_id TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      created_at TEXT NOT NULL,
      delivered INTEGER NOT NULL DEFAULT 0,
      data TEXT NOT NULL DEFAULT '{}',
      delivered_at TEXT,
      expires_at TEXT NOT NULL
    );
  `);
  return { sqlite, db: new Db(sqlite) };
}

function add(sqlite, id, expiresAt) {
  sqlite.prepare(
    `INSERT INTO pending_notifications
       (id,family_id,title,body,created_at,expires_at)
     VALUES (?,'family-a','제목','본문','2026-08-01T00:00:00.000Z',?)`,
  ).run(id, expiresAt);
}

test("pending retention은 만료 후 24시간 grace가 지난 행만 최대 batch만큼 지운다", async () => {
  const { sqlite, db } = createDb();
  const now = new Date("2026-08-31T12:00:00.000Z");
  add(sqlite, "expired-old", "2026-08-30T11:59:59.000Z");
  add(sqlite, "expired-boundary", "2026-08-30T12:00:00.000Z");
  add(sqlite, "expired-grace", "2026-08-30T12:00:01.000Z");
  add(sqlite, "future", "2026-09-01T12:00:00.000Z");

  const first = await retention.cleanupPendingNotificationRetention(db, now, 1);
  assert.deepEqual(first, { removed: 1 });
  assert.deepEqual(
    sqlite.prepare("SELECT id FROM pending_notifications ORDER BY id").all().map((row) => row.id),
    ["expired-grace", "future", "expired-boundary"].sort(),
  );

  const second = await retention.cleanupPendingNotificationRetention(db, now, 5_000);
  assert.deepEqual(second, { removed: 1 });
  assert.deepEqual(
    sqlite.prepare("SELECT id FROM pending_notifications ORDER BY id").all().map((row) => row.id),
    ["expired-grace", "future"],
  );
  assert.deepEqual(
    await retention.cleanupPendingNotificationRetention(db, now, 5_000),
    { removed: 0 },
  );
  sqlite.close();
});

test("pending retention migration과 fresh schema는 timestamp 형식 혼재를 견디는 expiry 범위 인덱스를 공유한다", () => {
  const migration = readFileSync(
    new URL("../db/pending-notification-retention.sql", import.meta.url),
    "utf8",
  );
  const migrated = new DatabaseSync(":memory:");
  migrated.exec("CREATE TABLE pending_notifications(id TEXT PRIMARY KEY, expires_at TEXT NOT NULL);");
  migrated.exec(migration);

  const canonical = new DatabaseSync(":memory:");
  canonical.exec(
    readFileSync(new URL("../../cloudflare/schema_d1.sql", import.meta.url), "utf8"),
  );
  const indexSql = (db) => String(db.prepare(
    "SELECT sql FROM sqlite_master WHERE type='index' AND name='idx_pending_notifications_expiry'",
  ).get()?.sql ?? "").replace(/\s+/g, " ");
  assert.match(
    indexSql(migrated),
    /replace\(substr\(expires_at,\s*1,\s*19\),\s*'T',\s*' '\),\s*id/i,
  );
  assert.equal(indexSql(canonical), indexSql(migrated));
  migrated.close();
  canonical.close();
});

test("기본 batch는 운영 backlog를 bounded하게 회수한다", () => {
  assert.equal(retention.PENDING_NOTIFICATION_RETENTION_GRACE_MS, 24 * 60 * 60_000);
  assert.equal(retention.PENDING_NOTIFICATION_RETENTION_BATCH, 5_000);
});
