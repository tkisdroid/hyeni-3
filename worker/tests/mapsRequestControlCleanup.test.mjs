import "./helpers/tsModuleResolve.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const cleanup = await import("../lib/maps/requestControlCleanup.ts");
const quota = await import("../lib/maps/quota.ts");

class Statement {
  constructor(sqlite, sql, bindings = []) { this.sqlite = sqlite; this.sql = sql; this.bindings = bindings; }
  bind(...bindings) { return new Statement(this.sqlite, this.sql, bindings); }
  async first() { return this.sqlite.prepare(this.sql).get(...this.bindings) ?? null; }
  async run() {
    const result = this.sqlite.prepare(this.sql).run(...this.bindings);
    return { meta: { changes: Number(result.changes) } };
  }
}

test("만료 session과 quota만 grace 뒤 정리한다", async () => {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(readFileSync(new URL("../db/maps-request-control.sql", import.meta.url), "utf8"));
  sqlite.exec(`
    INSERT INTO map_autocomplete_sessions VALUES ('old',1000,NULL,0),('recent',10500000,NULL,0);
    INSERT INTO map_request_quota VALUES ('old-family','details',0,1,'{}',3600000),('recent-family','details',7200000,1,'{}',10800000);
  `);
  const db = { prepare: (sql) => new Statement(sqlite, sql) };
  const result = await cleanup.cleanupMapRequestControl(db, 10_800_000);
  assert.deepEqual(result, { sessionsRemoved: 1, quotaRowsRemoved: 1 });
  assert.deepEqual(
    sqlite.prepare("SELECT handle_digest FROM map_autocomplete_sessions ORDER BY 1").all().map((row) => row.handle_digest),
    ["recent"],
  );
  assert.deepEqual(
    sqlite.prepare("SELECT family_scope_digest FROM map_request_quota ORDER BY 1").all().map((row) => row.family_scope_digest),
    ["recent-family"],
  );
  sqlite.close();
});

test("계정 정리는 user digest count를 family total에서 빼고 가족 삭제는 행 전체를 지운다", async () => {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(readFileSync(new URL("../db/maps-request-control.sql", import.meta.url), "utf8"));
  const db = { prepare: (sql) => new Statement(sqlite, sql) };
  const secret = "maps-cleanup-secret-with-at-least-32-bytes";
  await quota.claimMapQuota({ db, secret, userId: "user-a", familyId: "family-a", action: "details", nowMs: 0 });
  await quota.claimMapQuota({ db, secret, userId: "user-b", familyId: "family-a", action: "details", nowMs: 0 });
  await cleanup.removeMapQuotaForUser({ db, secret, userId: "user-a", familyId: "family-a" });
  let row = sqlite.prepare("SELECT family_count,user_counts_json FROM map_request_quota").get();
  assert.equal(row.family_count, 1);
  assert.equal(Object.keys(JSON.parse(row.user_counts_json)).length, 1);
  await cleanup.removeMapQuotaForFamily({ db, secret, familyId: "family-a" });
  row = sqlite.prepare("SELECT * FROM map_request_quota").get();
  assert.equal(row, undefined);
  sqlite.close();
});
