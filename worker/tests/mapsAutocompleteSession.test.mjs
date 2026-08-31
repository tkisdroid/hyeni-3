import "./helpers/tsModuleResolve.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const session = await import("../lib/maps/autocompleteSession.ts");
const SECRET = "maps-session-secret-with-at-least-32-bytes";

class Statement {
  constructor(sqlite, sql, bindings = []) { this.sqlite = sqlite; this.sql = sql; this.bindings = bindings; }
  bind(...bindings) { return new Statement(this.sqlite, this.sql, bindings); }
  async first() { return this.sqlite.prepare(this.sql).get(...this.bindings) ?? null; }
  async run() {
    const result = this.sqlite.prepare(this.sql).run(...this.bindings);
    return { meta: { changes: Number(result.changes) } };
  }
}

function fixture() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(readFileSync(new URL("../db/maps-request-control.sql", import.meta.url), "utf8"));
  return { sqlite, db: { prepare: (sql) => new Statement(sqlite, sql) } };
}

test("autocomplete handle은 ID를 노출하지 않고 사용자·가족·공급자에 5분간 결합된다", async () => {
  const { sqlite, db } = fixture();
  const created = await session.createAutocompleteSession({
    db, secret: SECRET, userId: "user-secret", familyId: "family-secret", provider: "google", nowMs: 1_000_000,
  });

  assert.equal(created.expiresAt, new Date(1_300_000).toISOString());
  assert.equal(created.handle.includes("user-secret"), false);
  assert.equal(created.handle.includes("family-secret"), false);
  assert.equal(await session.inspectAutocompleteHandle({
    handle: created.handle, secret: SECRET, userId: "other", familyId: "family-secret", provider: "google", nowMs: 1_000_001,
  }), null);
  assert.equal(await session.inspectAutocompleteHandle({
    handle: created.handle, secret: SECRET, userId: "user-secret", familyId: "other", provider: "google", nowMs: 1_000_001,
  }), null);
  assert.equal(await session.inspectAutocompleteHandle({
    handle: created.handle, secret: SECRET, userId: "user-secret", familyId: "family-secret", provider: "kakao", nowMs: 1_000_001,
  }), null);

  const row = sqlite.prepare("SELECT * FROM map_autocomplete_sessions").get();
  const serialized = JSON.stringify(row);
  assert.equal(serialized.includes(created.handle), false);
  assert.equal(serialized.includes("user-secret"), false);
  assert.equal(serialized.includes("family-secret"), false);
  sqlite.close();
});

test("변조·만료 handle을 거부하고 Details 동시 consume은 정확히 한 번만 성공한다", async () => {
  const { sqlite, db } = fixture();
  const created = await session.createAutocompleteSession({
    db, secret: SECRET, userId: "user-a", familyId: "family-a", provider: "google", nowMs: 2_000_000,
  });
  const input = {
    db, secret: SECRET, handle: created.handle, userId: "user-a", familyId: "family-a",
    provider: "google", providerPlaceId: "provider-place", nowMs: 2_000_001,
  };
  const outcomes = await Promise.all([
    session.consumeAutocompleteHandleAtomically(input),
    session.consumeAutocompleteHandleAtomically(input),
  ]);
  assert.deepEqual(outcomes.sort(), ["consumed", "reused"]);

  const tampered = `${created.handle.slice(0, -1)}x`;
  assert.equal(await session.consumeAutocompleteHandleAtomically({ ...input, handle: tampered }), "invalid");
  const expired = await session.createAutocompleteSession({
    db, secret: SECRET, userId: "user-a", familyId: "family-a", provider: "google", nowMs: 3_000_000,
  });
  assert.equal(await session.consumeAutocompleteHandleAtomically({
    ...input, handle: expired.handle, nowMs: 3_300_001,
  }), "expired");
  sqlite.close();
});

test("같은 handle은 isolate가 달라도 같은 RFC 4122 UUID v4 provider token을 만든다", async () => {
  const { sqlite, db } = fixture();
  const created = await session.createAutocompleteSession({
    db, secret: SECRET, userId: "user-a", familyId: "family-a", provider: "google", nowMs: 4_000_000,
  });
  const input = {
    handle: created.handle, secret: SECRET, userId: "user-a", familyId: "family-a", provider: "google", nowMs: 4_000_001,
  };
  const first = await session.deriveProviderSessionToken(input);
  const second = await session.deriveProviderSessionToken({ ...input });
  assert.equal(first, second);
  assert.match(first, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  sqlite.close();
});

test("D1 insert 실패 시 발급되지 않은 handle을 응답하지 않는다", async () => {
  const db = { prepare: () => ({ bind: () => ({ run: async () => { throw new Error("d1 unavailable"); } }) }) };
  await assert.rejects(
    session.createAutocompleteSession({
      db, secret: SECRET, userId: "user-a", familyId: "family-a", provider: "google", nowMs: 5_000_000,
    }),
    (error) => error?.code === "map_request_control_unavailable",
  );
});
