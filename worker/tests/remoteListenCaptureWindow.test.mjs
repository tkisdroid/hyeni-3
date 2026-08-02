import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { authorizeRemoteListenCaptureWindow } from "../lib/remoteListenConsent.ts";

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

function createDb({ ended = false } = {}) {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`
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
  `);
  sqlite.prepare(`INSERT INTO remote_listen_sessions
      (id, family_id, initiator_user_id, child_user_id, started_at, ended_at)
    VALUES (?,?,?,?,?,?)`)
    .run("request-1", "family-1", "parent-1", "child-1", "2099-01-01 00:00:00.000+00", ended ? "2099-01-01 00:00:10.000+00" : null);
  return { sqlite, db: { prepare: (sql) => new D1StatementAdapter(sqlite, sql) } };
}

test("부모 명령 확인 시각부터 60초 캡처 창을 아이 동의 없이 연다", async () => {
  const { sqlite, db } = createDb();
  const win = await authorizeRemoteListenCaptureWindow(db, {
    requestId: "request-1",
    childUserId: "child-1",
    now: "2099-01-01 00:00:50.000+00",
  });
  assert.deepEqual(win, {
    capturedAt: "2099-01-01 00:00:50.000+00",
    captureExpiresAt: "2099-01-01 00:01:50.000+00",
    captureExpiresAtMs: Date.parse("2099-01-01T00:01:50.000Z"),
  });
  // 오디오 게이트(consented_at IS NOT NULL)가 통과하도록 컬럼이 채워졌는지 확인.
  const stored = sqlite.prepare(
    "SELECT consented_at, capture_expires_at FROM remote_listen_sessions WHERE id=?",
  ).get("request-1");
  assert.equal(stored.consented_at, "2099-01-01 00:00:50.000+00");
  assert.equal(stored.capture_expires_at, "2099-01-01 00:01:50.000+00");
  sqlite.close();
});

test("명령 재시도는 창을 뒤로 밀지 않고 기존 창을 멱등 유지한다", async () => {
  const { sqlite, db } = createDb();
  await authorizeRemoteListenCaptureWindow(db, {
    requestId: "request-1", childUserId: "child-1", now: "2099-01-01 00:00:50.000+00",
  });
  const replay = await authorizeRemoteListenCaptureWindow(db, {
    requestId: "request-1", childUserId: "child-1", now: "2099-01-01 00:00:58.000+00",
  });
  // 두 번째 호출도 처음 연 창(00:00:50 → 00:01:50)을 그대로 반환해야 한다.
  assert.equal(replay.capturedAt, "2099-01-01 00:00:50.000+00");
  assert.equal(replay.captureExpiresAt, "2099-01-01 00:01:50.000+00");
  sqlite.close();
});

test("이미 종료된 세션·없는 아이는 창을 열지 않고 null 을 반환한다", async () => {
  const ended = createDb({ ended: true });
  assert.equal(await authorizeRemoteListenCaptureWindow(ended.db, {
    requestId: "request-1", childUserId: "child-1", now: "2099-01-01 00:00:50.000+00",
  }), null);
  ended.sqlite.close();

  const wrongChild = createDb();
  assert.equal(await authorizeRemoteListenCaptureWindow(wrongChild.db, {
    requestId: "request-1", childUserId: "child-other", now: "2099-01-01 00:00:50.000+00",
  }), null);
  wrongChild.sqlite.close();
});
