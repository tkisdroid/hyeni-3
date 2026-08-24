import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { FamilyRoom } from "../realtime/FamilyRoom.ts";
import { revokeFamilyRealtimeUsers } from "../lib/realtime.ts";

let realtimeAudience = {};
try {
  realtimeAudience = await import("../lib/realtimeAudience.ts");
} catch (error) {
  if (error?.code !== "ERR_MODULE_NOT_FOUND") throw error;
}

let realtimeMembership = {};
try {
  realtimeMembership = await import("../lib/realtimeMembership.ts");
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

  async run() {
    const result = this.db.prepare(this.sql).run(...this.bindings);
    return { meta: { changes: Number(result.changes ?? 0) } };
  }
}

function createAudienceDb() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`
    CREATE TABLE families(
      id TEXT PRIMARY KEY,
      parent_id TEXT
    );
    CREATE TABLE family_members(
      id TEXT PRIMARY KEY,
      family_id TEXT NOT NULL,
      user_id TEXT,
      role TEXT NOT NULL,
      name TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1
    );
  `);
  sqlite.prepare("INSERT INTO families VALUES (?, ?)").run("family-1", "owner-1");
  const insert = sqlite.prepare("INSERT INTO family_members VALUES (?, ?, ?, ?, ?, ?)");
  insert.run("parent-member", "family-1", "parent-1", "parent", "부모", 1);
  insert.run("child-member-1", "family-1", "child-1", "child", "혜니", 1);
  insert.run("child-member-2", "family-1", "child-2", "child", "혜니", 1);
  insert.run("child-member-old", "family-1", "child-old", "child", "혜니", 0);
  return {
    sqlite,
    db: { prepare: (sql) => new D1StatementAdapter(sqlite, sql) },
  };
}

function socket(label, sent, options = {}) {
  return {
    send(data) {
      sent.push({ label, data });
    },
    close(code, reason) {
      sent.push({ label, close: { code, reason } });
    },
    deserializeAttachment() {
      return options.attachment ?? null;
    },
  };
}

test("FamilyRoom은 명시 audience 없는 notify를 방 전체로 보내지 않는다", async () => {
  const sent = [];
  const state = {
    getWebSockets() {
      return [socket("parent", sent), socket("child", sent)];
    },
  };
  const room = new FamilyRoom(state, {});
  const response = await room.fetch(new Request("https://do.internal/notify", {
    method: "POST",
    body: JSON.stringify({
      kind: "pg",
      table: "parent_alerts",
      eventType: "INSERT",
      new: { title: "비공개 원문" },
    }),
  }));

  assert.equal(response.status, 403);
  assert.deepEqual(sent, []);
});

test("FamilyRoom은 targetUserIds의 user tag 소켓에만 한 번씩 fan-out한다", async () => {
  const sent = [];
  const sockets = {
    parent: socket("parent", sent, { attachment: { userId: "parent-1", tokenExp: 4_102_444_800 } }),
    child1: socket("child-1", sent, { attachment: { userId: "child-1", tokenExp: 4_102_444_800 } }),
    child2: socket("child-2", sent, { attachment: { userId: "child-2", tokenExp: 4_102_444_800 } }),
  };
  const state = {
    getWebSockets(tag) {
      if (tag === "user:parent-1") return [sockets.parent];
      if (tag === "user:child-1") return [sockets.child1];
      if (tag === "user:child-2") return [sockets.child2];
      return Object.values(sockets);
    },
  };
  const room = new FamilyRoom(state, {});
  const response = await room.fetch(new Request("https://do.internal/notify", {
    method: "POST",
    body: JSON.stringify({
      kind: "pg",
      table: "memo_replies",
      eventType: "INSERT",
      targetUserIds: ["parent-1", "child-1", "parent-1"],
      new: { id: "memo-1", child_id: "child-member-1" },
    }),
  }));

  assert.equal(response.status, 204);
  assert.deepEqual(sent.map((entry) => entry.label).sort(), ["child-1", "parent"]);
  const delivered = JSON.parse(sent[0].data);
  assert.equal(delivered.targetUserIds, undefined);
});

test("FamilyRoom revoke-user는 해당 user tag의 기존 소켓을 즉시 1008로 닫는다", async () => {
  const sent = [];
  const revokedA = socket("revoked-a", sent);
  const revokedB = socket("revoked-b", sent);
  const other = socket("other", sent);
  const state = {
    getWebSockets(tag) {
      if (tag === "user:child-old") return [revokedA, revokedB];
      return [revokedA, revokedB, other];
    },
  };
  const room = new FamilyRoom(state, {});
  const response = await room.fetch(new Request("https://do.internal/revoke-user", {
    method: "POST",
    body: JSON.stringify({ userId: "child-old" }),
  }));

  assert.equal(response.status, 204);
  assert.deepEqual(sent, [
    { label: "revoked-a", close: { code: 1008, reason: "membership_revoked" } },
    { label: "revoked-b", close: { code: 1008, reason: "membership_revoked" } },
  ]);
});

test("FamilyRoom은 access JWT가 만료된 소켓을 fan-out 전에 닫고 데이터를 보내지 않는다", async () => {
  const sent = [];
  const expired = socket("expired", sent, {
    attachment: { userId: "parent-1", tokenExp: 1 },
  });
  const state = {
    getWebSockets(tag) {
      return tag === "user:parent-1" ? [expired] : [];
    },
  };
  const room = new FamilyRoom(state, {});
  const response = await room.fetch(new Request("https://do.internal/notify", {
    method: "POST",
    body: JSON.stringify({
      kind: "pg",
      table: "parent_alerts",
      eventType: "INSERT",
      targetUserIds: ["parent-1"],
      new: { alert_type: "sos" },
    }),
  }));

  assert.equal(response.status, 204);
  assert.deepEqual(sent, [
    { label: "expired", close: { code: 1008, reason: "token_expired" } },
  ]);
});

test("audience resolver는 parent_alerts를 활성 부모에게만 최소 payload로 보낸다", async () => {
  assert.equal(typeof realtimeAudience.buildRealtimePgEnvelope, "function");
  const { sqlite, db } = createAudienceDb();
  const envelope = await realtimeAudience.buildRealtimePgEnvelope(db, {
    familyId: "family-1",
    table: "parent_alerts",
    eventType: "INSERT",
    newRow: {
      id: "alert-1",
      family_id: "family-1",
      alert_type: "sos",
      child_user_id: "child-1",
      title: "원문 제목",
      message: "원문 메시지",
      metadata: { secret: true },
    },
    oldRow: null,
  });

  assert.deepEqual(envelope.targetUserIds.sort(), ["owner-1", "parent-1"]);
  assert.deepEqual(envelope.new, {
    id: "alert-1",
    family_id: "family-1",
    alert_type: "sos",
    child_user_id: "child-1",
  });
  sqlite.close();
});

test("audience resolver는 child_locations를 부모와 해당 활성 child에게만 좌표 없이 보낸다", async () => {
  assert.equal(typeof realtimeAudience.buildRealtimePgEnvelope, "function");
  const { sqlite, db } = createAudienceDb();
  const envelope = await realtimeAudience.buildRealtimePgEnvelope(db, {
    familyId: "family-1",
    table: "child_locations",
    eventType: "UPDATE",
    newRow: {
      family_id: "family-1",
      user_id: "child-1",
      lat: 37.5,
      lng: 127.1,
      accuracy_m: 8,
      updated_at: "2026-07-14 12:00:00.000+00",
    },
    oldRow: null,
  });

  assert.deepEqual(envelope.targetUserIds.sort(), ["child-1", "owner-1", "parent-1"]);
  assert.deepEqual(envelope.new, {
    family_id: "family-1",
    user_id: "child-1",
    updated_at: "2026-07-14 12:00:00.000+00",
  });
  sqlite.close();
});

test("audience resolver는 일정 생성·수정을 활성 가족 전원에게 최소 payload로 보낸다", async () => {
  assert.equal(typeof realtimeAudience.buildRealtimePgEnvelope, "function");
  const { sqlite, db } = createAudienceDb();

  for (const eventType of ["INSERT", "UPDATE"]) {
    const envelope = await realtimeAudience.buildRealtimePgEnvelope(db, {
      familyId: "family-1",
      table: "events",
      eventType,
      newRow: {
        id: "event-1",
        family_id: "family-1",
        title: "피아노",
        memo: "노출하면 안 되는 일정 원문",
      },
      oldRow: eventType === "UPDATE"
        ? { id: "event-1", family_id: "family-1", title: "피아노" }
        : null,
    });

    assert.deepEqual(envelope.targetUserIds.sort(), ["child-1", "child-2", "owner-1", "parent-1"]);
    assert.deepEqual(envelope.new, { id: "event-1", family_id: "family-1" });
    assert.deepEqual(
      envelope.old,
      eventType === "UPDATE" ? { id: "event-1", family_id: "family-1" } : null,
    );
  }
  sqlite.close();
});

test("audience resolver는 memo thread를 부모와 해당 thread child에게만 보낸다", async () => {
  assert.equal(typeof realtimeAudience.buildRealtimePgEnvelope, "function");
  const { sqlite, db } = createAudienceDb();
  const envelope = await realtimeAudience.buildRealtimePgEnvelope(db, {
    familyId: "family-1",
    table: "memo_replies",
    eventType: "INSERT",
    newRow: {
      id: "memo-1",
      family_id: "family-1",
      date_key: "2026-6-14",
      child_id: "child-member-1",
      user_id: "parent-1",
      content: "가족 대화 원문",
    },
    oldRow: null,
  });

  assert.deepEqual(envelope.targetUserIds.sort(), ["child-1", "owner-1", "parent-1"]);
  assert.deepEqual(envelope.new, {
    id: "memo-1",
    family_id: "family-1",
    date_key: "2026-6-14",
    child_id: "child-member-1",
    user_id: "parent-1",
  });
  sqlite.close();
});

test("audience resolver는 비활성 child를 명시 target으로도 되살리지 않는다", async () => {
  assert.equal(typeof realtimeAudience.buildRealtimePgEnvelope, "function");
  const { sqlite, db } = createAudienceDb();
  const envelope = await realtimeAudience.buildRealtimePgEnvelope(db, {
    familyId: "family-1",
    table: "events",
    eventType: "UPDATE",
    newRow: { id: "event-1", family_id: "family-1", title: "비공개 일정" },
    oldRow: null,
    targetUserIds: ["child-old", "child-1"],
  });

  assert.deepEqual(envelope.targetUserIds, ["child-1"]);
  assert.deepEqual(envelope.new, { id: "event-1", family_id: "family-1" });
  sqlite.close();
});

test("revokeFamilyRealtimeUsers는 중복 user를 제거하고 DO revoke-user 완료를 기다린다", async () => {
  const requests = [];
  const env = {
    FAMILY_ROOM: {
      idFromName: (familyId) => familyId,
      get: (familyId) => ({
        async fetch(url, init) {
          requests.push({ familyId, url, body: JSON.parse(init.body) });
          return new Response(null, { status: 204 });
        },
      }),
    },
  };

  await revokeFamilyRealtimeUsers(env, "family-1", ["child-old", "child-old", "child-2"]);
  assert.deepEqual(requests, [
    {
      familyId: "family-1",
      url: "https://do.internal/revoke-user",
      body: { userId: "child-old" },
    },
    {
      familyId: "family-1",
      url: "https://do.internal/revoke-user",
      body: { userId: "child-2" },
    },
  ]);
});

test("supersede helper는 비활성화 대상 user를 먼저 캡처하고 해당 소켓을 퇴출한다", async () => {
  assert.equal(typeof realtimeMembership.supersedeActiveChildren, "function");
  const { sqlite, db } = createAudienceDb();
  const revoked = [];
  const env = {
    DB: db,
    FAMILY_ROOM: {
      idFromName: (familyId) => familyId,
      get: () => ({
        async fetch(_url, init) {
          revoked.push(JSON.parse(init.body).userId);
          return new Response(null, { status: 204 });
        },
      }),
    },
  };

  const superseded = await realtimeMembership.supersedeActiveChildren(env, {
    familyId: "family-1",
    keepUserId: "child-2",
    name: "혜니",
  });
  assert.deepEqual(superseded, ["child-1"]);
  assert.deepEqual(revoked, ["child-1"]);
  const active = sqlite.prepare("SELECT is_active FROM family_members WHERE user_id=?").get("child-1");
  assert.equal(active.is_active, 0);
  sqlite.close();
});

test("unpair 멱등 재시도도 남아 있는 자녀 소켓 퇴출을 다시 시도한다", () => {
  const source = readFileSync(new URL("../routes/family.ts", import.meta.url), "utf8");
  const noOpBranch = source.match(
    /if \(!childRows\.results\?\.length\)([\s\S]*?)\/\/ family_members 행을 먼저 지우면/,
  )?.[1] ?? "";
  assert.match(noOpBranch, /processFamilyUnpairCleanup/);
  assert.match(noOpBranch, /revokeChildRealtimeSocket/);
  assert.match(noOpBranch, /cleanup_pending: cleanup\.status === "pending"/);
});
