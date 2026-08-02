import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { authorizeRemoteListenConsent } from "../lib/remoteListenConsent.ts";

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

  async run() {
    const result = this.db.prepare(this.sql).run(...this.bindings);
    return { success: true, meta: { changes: Number(result.changes) } };
  }
}

function createDb({ expiresAt = "2099-01-01 00:01:00.000+00" } = {}) {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`
    CREATE TABLE family_members(
      family_id TEXT NOT NULL,
      user_id TEXT,
      role TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE remote_listen_sessions(
      id TEXT PRIMARY KEY,
      family_id TEXT NOT NULL,
      initiator_user_id TEXT,
      child_user_id TEXT,
      started_at TEXT NOT NULL,
      ended_at TEXT,
      consented_at TEXT,
      capture_expires_at TEXT
    );
    CREATE TABLE pending_notifications(
      id TEXT PRIMARY KEY,
      family_id TEXT NOT NULL,
      data TEXT,
      expires_at TEXT,
      created_at TEXT NOT NULL
    );
  `);
  sqlite.prepare("INSERT INTO family_members VALUES (?,?,?,?)")
    .run("family-1", "child-1", "child", 1);
  sqlite.prepare(`INSERT INTO remote_listen_sessions
      (id, family_id, initiator_user_id, child_user_id, started_at)
    VALUES (?,?,?,?,?)`)
    .run("request-1", "family-1", "parent-1", "child-1", "2099-01-01 00:00:00.000+00");
  sqlite.prepare("INSERT INTO pending_notifications VALUES (?,?,?,?,?)").run(
    "pending-1",
    "family-1",
    JSON.stringify({
      type: "remote_listen",
      requestId: "request-1",
      targetUserId: "child-1",
      senderUserId: "parent-1",
    }),
    expiresAt,
    "2099-01-01 00:00:01.000+00",
  );
  return {
    sqlite,
    db: { prepare: (sql) => new D1StatementAdapter(sqlite, sql) },
  };
}

test("서버 동의는 서버 수신 시각부터 60초를 열고, 창 안 재요청은 같은 창을 멱등 반환한다", async () => {
  const { sqlite, db } = createDb();
  const result = await authorizeRemoteListenConsent(db, {
    requestId: "request-1",
    childUserId: "child-1",
    now: "2099-01-01 00:00:50.000+00",
  });

  assert.deepEqual(result, {
    ok: true,
    consentedAt: "2099-01-01 00:00:50.000+00",
    captureExpiresAt: "2099-01-01 00:01:50.000+00",
    captureExpiresAtMs: Date.parse("2099-01-01T00:01:50.000Z"),
  });
  const stored = sqlite.prepare(
    "SELECT consented_at, capture_expires_at FROM remote_listen_sessions WHERE id=?",
  ).get("request-1");
  assert.equal(stored.consented_at, result.consentedAt);
  assert.equal(stored.capture_expires_at, result.captureExpiresAt);

  // 창 안에서의 재요청(구버전 아이 앱 탭 등)은 409 가 아니라 기존 창을 멱등 반환한다.
  const replay = await authorizeRemoteListenConsent(db, {
    requestId: "request-1",
    childUserId: "child-1",
    now: "2099-01-01 00:00:51.000+00",
  });
  assert.deepEqual(replay, {
    ok: true,
    consentedAt: "2099-01-01 00:00:50.000+00",
    captureExpiresAt: "2099-01-01 00:01:50.000+00",
    captureExpiresAtMs: Date.parse("2099-01-01T00:01:50.000Z"),
  });

  // 창이 만료된 뒤의 재요청은 fail-closed(409)로 거부한다.
  const afterExpiry = await authorizeRemoteListenConsent(db, {
    requestId: "request-1",
    childUserId: "child-1",
    now: "2099-01-01 00:02:00.000+00",
  });
  assert.deepEqual(afterExpiry, {
    ok: false,
    status: 409,
    error: "remote_listen_consent_already_used",
  });
  sqlite.close();
});

test("요청 만료 후 동의와 다른 아이의 동의는 fail-closed로 거부한다", async () => {
  const expired = createDb({ expiresAt: "2099-01-01 00:00:49.000+00" });
  assert.deepEqual(await authorizeRemoteListenConsent(expired.db, {
    requestId: "request-1",
    childUserId: "child-1",
    now: "2099-01-01 00:00:50.000+00",
  }), {
    ok: false,
    status: 409,
    error: "remote_listen_consent_expired",
  });
  expired.sqlite.close();

  const wrongChild = createDb();
  assert.deepEqual(await authorizeRemoteListenConsent(wrongChild.db, {
    requestId: "request-1",
    childUserId: "child-other",
    now: "2099-01-01 00:00:50.000+00",
  }), {
    ok: false,
    status: 403,
    error: "remote_listen_consent_forbidden",
  });
  wrongChild.sqlite.close();
});
