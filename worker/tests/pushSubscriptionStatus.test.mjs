import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";

let pushStatus = {};
try {
  pushStatus = await import("../lib/pushSubscriptionStatus.ts");
} catch (error) {
  if (error?.code !== "ERR_MODULE_NOT_FOUND") throw error;
}

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
}

test("status 판정은 endpoint와 현재 사용자 및 정본 가족이 모두 일치해야 한다", async () => {
  assert.equal(typeof pushStatus.isPushSubscriptionRegisteredForAccount, "function");
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`
    CREATE TABLE push_subscriptions(
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      family_id TEXT NOT NULL,
      endpoint TEXT NOT NULL,
      disabled_at TEXT
    );
  `);
  sqlite.prepare("INSERT INTO push_subscriptions(id,user_id,family_id,endpoint) VALUES (?,?,?,?)")
    .run("sub-1", "user-1", "family-1", "https://push.example/sub-1");
  sqlite.prepare("INSERT INTO push_subscriptions VALUES (?,?,?,?,?)")
    .run("sub-disabled", "user-1", "family-1", "https://push.example/disabled", "2026-07-14T01:00:00Z");
  const db = { prepare: (sql) => new D1StatementAdapter(sqlite, sql) };

  assert.equal(await pushStatus.isPushSubscriptionRegisteredForAccount(db, {
    endpoint: "https://push.example/sub-1",
    userId: "user-1",
    familyId: "family-1",
  }), true);
  assert.equal(await pushStatus.isPushSubscriptionRegisteredForAccount(db, {
    endpoint: "https://push.example/sub-1",
    userId: "user-2",
    familyId: "family-1",
  }), false);
  assert.equal(await pushStatus.isPushSubscriptionRegisteredForAccount(db, {
    endpoint: "https://push.example/sub-1",
    userId: "user-1",
    familyId: "family-2",
  }), false);
  assert.equal(await pushStatus.isPushSubscriptionRegisteredForAccount(db, {
    endpoint: "https://push.example/disabled",
    userId: "user-1",
    familyId: "family-1",
  }), false);
});

test("status endpoint는 인증을 거치고 소유자 세부정보 없이 registered만 반환한다", () => {
  const source = readFileSync(new URL("../routes/push-subscriptions.ts", import.meta.url), "utf8");
  assert.match(source, /get\("\/status", requireAuth/);
  assert.match(source, /return c\.json\(\{ registered \}\)/);
});
