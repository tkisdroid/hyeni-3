import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";

let security = {};
try {
  security = await import("../lib/remoteListenSecurity.ts");
} catch (error) {
  if (error?.code !== "ERR_MODULE_NOT_FOUND") throw error;
}

class Statement {
  constructor(db, sql, bindings = []) { this.db = db; this.sql = sql; this.bindings = bindings; }
  bind(...bindings) { return new Statement(this.db, this.sql, bindings); }
  async first() { return this.db.prepare(this.sql).get(...this.bindings) ?? null; }
}

function createDb() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`
    CREATE TABLE family_members(
      family_id TEXT NOT NULL, user_id TEXT, role TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE remote_listen_sessions(
      id TEXT PRIMARY KEY, family_id TEXT NOT NULL, initiator_user_id TEXT,
      child_user_id TEXT, started_at TEXT NOT NULL, ended_at TEXT
    );
  `);
  sqlite.prepare("INSERT INTO family_members VALUES (?,?,?,?)")
    .run("family-1", "child-1", "child", 1);
  sqlite.prepare("INSERT INTO family_members VALUES (?,?,?,?)")
    .run("family-1", "child-old", "child", 0);
  sqlite.prepare("INSERT INTO remote_listen_sessions VALUES (?,?,?,?,?,NULL)")
    .run("request-1", "family-1", "parent-1", "child-1", "2026-07-14 06:00:00.000+00");
  return { sqlite, db: { prepare: (sql) => new Statement(sqlite, sql) } };
}

function api() {
  assert.equal(typeof security.authorizeRemoteListenCommand, "function");
  assert.equal(typeof security.normalizeRemoteListenEndReason, "function");
  assert.equal(typeof security.remoteListenDurationMs, "function");
  return security;
}

test("remote_listen start/stop은 정확히 같은 열린 감사 세션·요청자·활성 아이만 허용한다", async () => {
  const { sqlite, db } = createDb();
  for (const action of ["remote_listen", "remote_listen_stop"]) {
    assert.deepEqual(await api().authorizeRemoteListenCommand(db, {
      action,
      familyId: "family-1",
      callerUserId: "parent-1",
      targetUserId: "child-1",
      requestId: "request-1",
    }), { ok: true, targetUserId: "child-1", requestId: "request-1" });
  }

  const mismatches = [
    { callerUserId: "parent-2", targetUserId: "child-1", requestId: "request-1" },
    { callerUserId: "parent-1", targetUserId: "child-old", requestId: "request-1" },
    { callerUserId: "parent-1", targetUserId: "child-1", requestId: "request-other" },
  ];
  for (const mismatch of mismatches) {
    const result = await api().authorizeRemoteListenCommand(db, {
      action: "remote_listen",
      familyId: "family-1",
      ...mismatch,
    });
    assert.deepEqual(result, { ok: false, error: "remote_listen_session_mismatch" });
  }

  sqlite.prepare("UPDATE remote_listen_sessions SET ended_at=? WHERE id=?")
    .run("2026-07-14 06:01:00.000+00", "request-1");
  assert.deepEqual(await api().authorizeRemoteListenCommand(db, {
    action: "remote_listen_stop",
    familyId: "family-1",
    callerUserId: "parent-1",
    targetUserId: "child-1",
    requestId: "request-1",
  }), { ok: false, error: "remote_listen_session_mismatch" });
});

test("감사 종료 시각·길이는 서버 시각으로 0~60초만 계산하고 종료 사유를 allowlist로 제한한다", () => {
  const { remoteListenDurationMs, normalizeRemoteListenEndReason } = api();
  assert.equal(remoteListenDurationMs("2026-07-14 06:00:00.000+00", Date.parse("2026-07-14T06:00:20Z")), 20_000);
  assert.equal(remoteListenDurationMs("2026-07-14 05:00:00.000+00", Date.parse("2026-07-14T06:00:20Z")), 60_000);
  assert.equal(remoteListenDurationMs("2026-07-14 06:00:30.000+00", Date.parse("2026-07-14T06:00:20Z")), 0);
  assert.equal(remoteListenDurationMs("invalid", Date.parse("2026-07-14T06:00:20Z")), 0);

  for (const reason of [
    "timeout", "request_timeout", "user_stop", "unmount", "unmount_before_command",
    "command_failed", "command_http_503", "no_target_device",
    "audio_auth_failed", "audio_upload_failed",
  ]) {
    assert.equal(normalizeRemoteListenEndReason(reason), reason);
  }
  assert.equal(normalizeRemoteListenEndReason("command_http_200"), "unspecified");
  assert.equal(normalizeRemoteListenEndReason("<script>forged</script>"), "unspecified");
});
