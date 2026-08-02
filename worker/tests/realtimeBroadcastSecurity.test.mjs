import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { FamilyRoom } from "../realtime/FamilyRoom.ts";

let broadcastSecurity = {};
try {
  broadcastSecurity = await import("../lib/realtimeBroadcastSecurity.ts");
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

  async all() {
    return { results: this.db.prepare(this.sql).all(...this.bindings) };
  }
}

function createDb() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`
    CREATE TABLE families(
      id TEXT PRIMARY KEY,
      parent_id TEXT
    );
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
  sqlite.prepare("INSERT INTO families VALUES (?,?)").run("family-1", "parent-1");
  return {
    sqlite,
    db: { prepare: (sql) => new D1StatementAdapter(sqlite, sql) },
  };
}

test("broadcast 인증기는 비활성·타사용자 위치 주입을 거부한다", async () => {
  assert.equal(typeof broadcastSecurity.authorizeRealtimeBroadcast, "function");
  const { sqlite, db } = createDb();
  sqlite.prepare("INSERT INTO family_members VALUES (?,?,?,?)")
    .run("family-1", "child-active", "child", 1);
  sqlite.prepare("INSERT INTO family_members VALUES (?,?,?,?)")
    .run("family-1", "child-old", "child", 0);

  const allowed = await broadcastSecurity.authorizeRealtimeBroadcast(db, {
    callerUserId: "child-active",
    familyId: "family-1",
    event: "child_location",
    payload: { user_id: "child-active", userId: "child-active", family_id: "family-1" },
  });
  assert.equal(allowed.ok, true);
  assert.equal(allowed.targetUserId, null);

  const spoofed = await broadcastSecurity.authorizeRealtimeBroadcast(db, {
    callerUserId: "child-active",
    familyId: "family-1",
    event: "child_location",
    payload: { user_id: "someone-else", family_id: "family-1" },
  });
  assert.deepEqual(spoofed, { ok: false, status: 403, error: "broadcast_identity_mismatch" });

  const inactive = await broadcastSecurity.authorizeRealtimeBroadcast(db, {
    callerUserId: "child-old",
    familyId: "family-1",
    event: "child_device_status",
    payload: { user_id: "child-old", family_id: "family-1" },
  });
  assert.deepEqual(inactive, { ok: false, status: 403, error: "active_child_required" });
  sqlite.close();
});

test("audio_chunk는 열린 감사 세션과 정확히 연결된 requestId만 initiator에게 보낸다", async () => {
  assert.equal(typeof broadcastSecurity.authorizeRealtimeBroadcast, "function");
  const { sqlite, db } = createDb();
  sqlite.prepare("INSERT INTO family_members VALUES (?,?,?,?)")
    .run("family-1", "child-1", "child", 1);
  sqlite.prepare(`INSERT INTO remote_listen_sessions
      (id, family_id, initiator_user_id, child_user_id, started_at, ended_at,
       consented_at, capture_expires_at)
    VALUES (?,?,?,?,?,NULL,?,?)`)
    .run(
      "request-1", "family-1", "parent-1", "child-1",
      "2099-01-01 00:00:00.000+00",
      "2099-01-01 00:00:50.000+00",
      "2099-01-01 00:01:50.000+00",
    );
  sqlite.prepare("INSERT INTO pending_notifications VALUES (?,?,?,?,?)").run(
    "pending-1",
    "family-1",
    JSON.stringify({
      type: "remote_listen",
      requestId: "request-1",
      targetUserId: "child-1",
      senderUserId: "parent-1",
    }),
    "2099-01-01 00:00:55.000+00",
    "2099-01-01 00:00:01.000+00",
  );

  const allowed = await broadcastSecurity.authorizeRealtimeBroadcast(db, {
    callerUserId: "child-1",
    familyId: "family-1",
    event: "audio_chunk",
    payload: {
      childUserId: "child-1",
      requestId: "request-1",
      data: "UklGRg==",
      mimeType: "audio/wav",
      sequenceNumber: 7,
      durationMs: 1000,
      unknownField: "drop-me",
      initiatorUserId: "spoofed-parent",
    },
    now: "2099-01-01 00:01:00.000+00",
  });
  assert.equal(allowed.ok, true);
  assert.equal(allowed.targetUserId, "parent-1");
  assert.equal(allowed.payload.initiatorUserId, "parent-1");
  assert.equal(allowed.payload.mimeType, "audio/wav");
  assert.equal(allowed.payload.sequenceNumber, 7);
  assert.equal(allowed.payload.durationMs, 1000);
  assert.equal(allowed.payload.unknownField, undefined);

  sqlite.prepare("UPDATE remote_listen_sessions SET capture_expires_at=? WHERE id=?")
    .run("2099-01-01 00:00:59.000+00", "request-1");
  const expiredCapture = await broadcastSecurity.authorizeRealtimeBroadcast(db, {
    callerUserId: "child-1",
    familyId: "family-1",
    event: "audio_chunk",
    payload: {
      childUserId: "child-1", requestId: "request-1", data: "UklGRg==",
      mimeType: "audio/wav", sequenceNumber: 8, durationMs: 1000,
    },
    now: "2099-01-01 00:01:00.000+00",
  });
  assert.deepEqual(expiredCapture, { ok: false, status: 403, error: "remote_listen_session_required" });
  sqlite.prepare("UPDATE remote_listen_sessions SET capture_expires_at=? WHERE id=?")
    .run("2099-01-01 00:01:50.000+00", "request-1");

  const wrongRequest = await broadcastSecurity.authorizeRealtimeBroadcast(db, {
    callerUserId: "child-1",
    familyId: "family-1",
    event: "audio_chunk",
    payload: {
      childUserId: "child-1", requestId: "request-other", data: "UklGRg==",
      mimeType: "audio/wav", sequenceNumber: 8, durationMs: 1000,
    },
    now: "2099-01-01 00:01:00.000+00",
  });
  assert.deepEqual(wrongRequest, { ok: false, status: 403, error: "remote_listen_session_required" });

  sqlite.prepare("UPDATE remote_listen_sessions SET ended_at=? WHERE id=?")
    .run("2099-01-01 00:01:30.000+00", "request-1");
  sqlite.prepare(`INSERT INTO remote_listen_sessions
      (id, family_id, initiator_user_id, child_user_id, started_at, ended_at,
       consented_at, capture_expires_at)
    VALUES (?,?,?,?,?,NULL,?,?)`)
    .run(
      "audit-other", "family-1", "parent-2", "child-1",
      "2099-01-01 00:01:31.000+00",
      "2099-01-01 00:01:32.000+00",
      "2099-01-01 00:02:32.000+00",
    );
  sqlite.prepare("INSERT INTO pending_notifications VALUES (?,?,?,?,?)").run(
    "pending-cross",
    "family-1",
    JSON.stringify({
      type: "remote_listen",
      requestId: "request-1",
      targetUserId: "child-1",
      senderUserId: "parent-2",
    }),
    "2099-01-01 00:05:00.000+00",
    "2099-01-01 00:01:32.000+00",
  );
  const crossJoined = await broadcastSecurity.authorizeRealtimeBroadcast(db, {
    callerUserId: "child-1",
    familyId: "family-1",
    event: "audio_chunk",
    payload: {
      childUserId: "child-1", requestId: "request-1", data: "UklGRg==",
      mimeType: "audio/wav", sequenceNumber: 9, durationMs: 1000,
    },
    now: "2099-01-01 00:02:00.000+00",
  });
  assert.deepEqual(crossJoined, { ok: false, status: 403, error: "remote_listen_session_required" });
  sqlite.close();
});

test("audio_chunk는 WAV base64와 보수적 크기·청크 메타데이터 계약을 강제한다", async () => {
  const { sqlite, db } = createDb();
  sqlite.prepare("INSERT INTO family_members VALUES (?,?,?,?)")
    .run("family-1", "child-1", "child", 1);
  sqlite.prepare(`INSERT INTO remote_listen_sessions
      (id, family_id, initiator_user_id, child_user_id, started_at, ended_at,
       consented_at, capture_expires_at)
    VALUES (?,?,?,?,?,NULL,?,?)`)
    .run(
      "request-1", "family-1", "parent-1", "child-1",
      "2099-01-01 00:00:00.000+00",
      "2099-01-01 00:00:50.000+00",
      "2099-01-01 00:01:50.000+00",
    );
  sqlite.prepare("INSERT INTO pending_notifications VALUES (?,?,?,?,?)").run(
    "pending-1",
    "family-1",
    JSON.stringify({
      type: "remote_listen", requestId: "request-1",
      targetUserId: "child-1", senderUserId: "parent-1",
    }),
    "2099-01-01 00:05:00.000+00",
    "2099-01-01 00:00:01.000+00",
  );

  const invalidPayloads = [
    { childUserId: "child-1", requestId: "request-1", data: "", mimeType: "audio/wav", sequenceNumber: 1, durationMs: 1000 },
    { childUserId: "child-1", requestId: "request-1", data: "UklGRg==", mimeType: "audio/webm", sequenceNumber: 1, durationMs: 1000 },
    { childUserId: "child-1", requestId: "request-1", data: "not-base64", mimeType: "audio/wav", sequenceNumber: 1, durationMs: 1000 },
    { childUserId: "child-1", requestId: "request-1", data: `UklGR${"A".repeat(512 * 1024)}`, mimeType: "audio/wav", sequenceNumber: 1, durationMs: 1000 },
    { childUserId: "child-1", requestId: "request-1", data: "UklGRg==", mimeType: "audio/wav", sequenceNumber: -1, durationMs: 1000 },
    { childUserId: "child-1", requestId: "request-1", data: "UklGRg==", mimeType: "audio/wav", sequenceNumber: 1, durationMs: 60_001 },
  ];
  for (const payload of invalidPayloads) {
    const result = await broadcastSecurity.authorizeRealtimeBroadcast(db, {
      callerUserId: "child-1",
      familyId: "family-1",
      event: "audio_chunk",
      payload,
      now: "2099-01-01 00:01:00.000+00",
    });
    assert.equal(result.ok, false);
    assert.equal(result.status, 400);
  }
  sqlite.close();
});

test("FamilyRoom은 audio_chunk를 target user 소켓에만 전달한다", async () => {
  const sent = { parent: [], child: [], otherParent: [] };
  const activeAttachment = { userId: "test", tokenExp: 4_102_444_800 };
  const sockets = {
    parent: { send: (data) => sent.parent.push(data), deserializeAttachment: () => activeAttachment },
    child: { send: (data) => sent.child.push(data), deserializeAttachment: () => activeAttachment },
    otherParent: { send: (data) => sent.otherParent.push(data), deserializeAttachment: () => activeAttachment },
  };
  const state = {
    getWebSockets(tag) {
      if (tag === "user:parent-1") return [sockets.parent];
      return [sockets.parent, sockets.child, sockets.otherParent];
    },
  };
  const room = new FamilyRoom(state, {});
  const response = await room.fetch(new Request("https://do.internal/notify", {
    method: "POST",
    body: JSON.stringify({
      kind: "broadcast",
      event: "audio_chunk",
      targetUserId: "parent-1",
      payload: { requestId: "request-1", data: "UklGRg==" },
    }),
  }));

  assert.equal(response.status, 204);
  assert.equal(sent.parent.length, 1);
  assert.equal(sent.child.length, 0);
  assert.equal(sent.otherParent.length, 0);
  assert.equal(JSON.parse(sent.parent[0]).targetUserId, undefined);
});

test("FamilyRoom은 ping 외 클라이언트 payload를 relay하지 않는다", () => {
  const relayed = [];
  const sender = {
    close: (code, reason) => relayed.push({ code, reason }),
    deserializeAttachment: () => ({ userId: "child-1", tokenExp: 4_102_444_800 }),
  };
  const other = { send: (data) => relayed.push(data) };
  const state = { getWebSockets: () => [sender, other] };
  const room = new FamilyRoom(state, {});

  room.webSocketMessage(sender, JSON.stringify({
    kind: "broadcast",
    event: "audio_chunk",
    payload: { data: "attacker" },
  }));

  assert.deepEqual(relayed, [{ code: 1008, reason: "client_messages_not_allowed" }]);
});

test("realtime 입장과 REST broadcast가 검증된 user tag를 강제한다", () => {
  const indexSource = readFileSync(new URL("../index.ts", import.meta.url), "utf8");
  const shimSource = readFileSync(new URL("../routes/rest-shim.ts", import.meta.url), "utf8");
  const roomSource = readFileSync(new URL("../realtime/FamilyRoom.ts", import.meta.url), "utf8");

  assert.match(indexSource, /resolveVerifiedFamilyMembership/);
  assert.match(indexSource, /x-hyeni-user-id/);
  assert.match(roomSource, /acceptWebSocket\(server, \[userTag\]\)/);
  assert.match(
    readFileSync(new URL("../lib/realtimeBroadcastSecurity.ts", import.meta.url), "utf8"),
    /r\.id = \?3/,
  );
  assert.doesNotMatch(shimSource, /anonCompat/);
  assert.match(shimSource, /return c\.json\(\{ error: "authentication_required" \}, 401\)/);
  assert.match(shimSource, /const response = await stub\.fetch/);
  assert.match(shimSource, /if \(!response\.ok\)/);
  assert.match(shimSource, /broadcast_forward_failed/);
});
