import "./helpers/tsModuleResolve.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const quota = await import("../lib/maps/quota.ts");
const SECRET = "maps-quota-secret-with-at-least-32-bytes";

class Statement {
  constructor(sqlite, sql, bindings = []) { this.sqlite = sqlite; this.sql = sql; this.bindings = bindings; }
  bind(...bindings) { return new Statement(this.sqlite, this.sql, bindings); }
  async first() { return this.sqlite.prepare(this.sql).get(...this.bindings) ?? null; }
}

function fixture() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(readFileSync(new URL("../db/maps-request-control.sql", import.meta.url), "utf8"));
  return { sqlite, db: { prepare: (sql) => new Statement(sqlite, sql) } };
}

test("각 지도 action은 user·family 시간당 상한을 원자적으로 지킨다", async () => {
  const expected = {
    autocomplete: [120, 360], details: [30, 90], reverse_object: [120, 360], reverse_raw: [30, 90], directions: [30, 90],
  };
  assert.deepEqual(quota.MAP_QUOTA_LIMITS, expected);

  for (const [action, [userLimit]] of Object.entries(expected)) {
    const { sqlite, db } = fixture();
    const claims = await Promise.all(Array.from({ length: userLimit }, () => quota.claimMapQuota({
      db, secret: SECRET, userId: "user-a", familyId: "family-a", action, nowMs: 7_200_001,
    })));
    assert.equal(claims.filter((claim) => claim.allowed).length, userLimit, action);
    const overflow = await quota.claimMapQuota({
      db, secret: SECRET, userId: "user-a", familyId: "family-a", action, nowMs: 7_200_001,
    });
    assert.equal(overflow.allowed, false, action);
    sqlite.close();
  }
});

test("여러 사용자의 요청도 family 상한을 넘지 않는다", async () => {
  const { sqlite, db } = fixture();
  const claims = await Promise.all(Array.from({ length: 90 }, (_, index) => quota.claimMapQuota({
    db, secret: SECRET, userId: `user-${index}`, familyId: "family-a", action: "details", nowMs: 10_800_000,
  })));
  assert.equal(claims.filter((claim) => claim.allowed).length, 90);
  const overflow = await quota.claimMapQuota({
    db, secret: SECRET, userId: "user-overflow", familyId: "family-a", action: "details", nowMs: 10_800_000,
  });
  assert.equal(overflow.allowed, false);
  assert.equal(overflow.retryAfterSeconds, 3600);
  sqlite.close();
});

test("D1에는 raw user/family 값 대신 서로 다른 HMAC digest만 저장한다", async () => {
  const { sqlite, db } = fixture();
  await quota.claimMapQuota({
    db, secret: SECRET, userId: "raw-user", familyId: "raw-family", action: "reverse_raw", nowMs: 20_000_000,
  });
  const row = sqlite.prepare("SELECT * FROM map_request_quota").get();
  const serialized = JSON.stringify(row);
  assert.equal(serialized.includes("raw-user"), false);
  assert.equal(serialized.includes("raw-family"), false);
  assert.match(row.family_scope_digest, /^[a-f0-9]{64}$/);
  const keys = Object.keys(JSON.parse(row.user_counts_json));
  assert.equal(keys.length, 1);
  assert.match(keys[0], /^[a-f0-9]{64}$/);
  sqlite.close();
});

test("quota DB 오류는 허용으로 강등하지 않는다", async () => {
  const db = { prepare: () => ({ bind: () => ({ first: async () => { throw new Error("d1 unavailable"); } }) }) };
  await assert.rejects(quota.claimMapQuota({
    db, secret: SECRET, userId: "user-a", familyId: "family-a", action: "details", nowMs: 0,
  }), (error) => error?.code === "map_request_control_unavailable");
});
