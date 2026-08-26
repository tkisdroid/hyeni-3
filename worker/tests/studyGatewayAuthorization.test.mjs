import "./helpers/tsModuleResolve.mjs";

import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { Hono } from "hono";

const { createStudyRoutes } = await import("../routes/study.ts");
const { actorRefForStudy } = await import("../lib/studyActorRef.ts");

class Statement {
  constructor(sqlite, sql, bindings = []) {
    this.sqlite = sqlite;
    this.sql = sql;
    this.bindings = bindings;
  }

  bind(...bindings) {
    return new Statement(this.sqlite, this.sql, bindings);
  }

  async first() {
    return this.sqlite.prepare(this.sql).get(...this.bindings) ?? null;
  }

  async all() {
    return { results: this.sqlite.prepare(this.sql).all(...this.bindings) };
  }
}

function createDb() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`
    CREATE TABLE families(
      id TEXT PRIMARY KEY,
      parent_id TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE family_members(
      id TEXT PRIMARY KEY,
      family_id TEXT NOT NULL,
      user_id TEXT,
      role TEXT NOT NULL,
      name TEXT NOT NULL,
      photo_url TEXT,
      is_active INTEGER NOT NULL,
      created_at TEXT,
      last_selected_at TEXT
    );
    CREATE TABLE app_global_settings(
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL DEFAULT '',
      updated_by TEXT,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    INSERT INTO families VALUES ('family-a','parent-primary','2026-08-01T00:00:00Z');
    INSERT INTO families VALUES ('family-b','parent-other','2026-08-01T00:00:00Z');
    INSERT INTO family_members VALUES
      ('parent-guardian','family-a','parent-guardian-user','parent','공동 보호자',NULL,1,'2026-08-01T00:00:00Z',NULL),
      ('child-a','family-a','child-user-a','child','혜니','family-a/avatar.webp',1,'2026-08-01T00:00:00Z',NULL),
      ('child-placeholder','family-a',NULL,'child','동생',NULL,1,'2026-08-01T00:00:00Z',NULL),
      ('child-inactive','family-a','old-child','child','예전 아이',NULL,0,'2026-08-01T00:00:00Z',NULL),
      ('child-b','family-b','child-user-b','child','다른 아이',NULL,1,'2026-08-01T00:00:00Z',NULL);
  `);
  return {
    sqlite,
    db: { prepare: (sql) => new Statement(sqlite, sql) },
  };
}

function overview(memberId) {
  return {
    memberId,
    linked: memberId === "child-a",
    grade: memberId === "child-a" ? 4 : null,
    todayProblemCount: memberId === "child-a" ? 8 : 0,
    completedToday: memberId === "child-a",
    lastStudiedAt: memberId === "child-a" ? "2026-08-27T01:00:00.000Z" : null,
  };
}

function createStudyBinding() {
  const calls = [];
  return {
    calls,
    async getChildrenOverview(familyId, memberIds, requestId) {
      calls.push({ method: "getChildrenOverview", familyId, memberIds, requestId });
      return { apiVersion: "2026-08-24", children: memberIds.map(overview) };
    },
    async getChildReport(familyId, memberId, range, requestId) {
      calls.push({ method: "getChildReport", familyId, memberId, range, requestId });
      return {
        apiVersion: "2026-08-24",
        ...overview(memberId),
        range,
        accuracy: 75,
        conceptMastery: [],
        reviewDueCount: 1,
        recentSessions: [],
      };
    },
    async createAttachChallenge(familyId, memberId, actorRef, requestId) {
      calls.push({ method: "createAttachChallenge", familyId, memberId, actorRef, requestId });
      return {
        apiVersion: "2026-08-24",
        purpose: "attach_child_device",
        qrUrl: `https://study.hyenicalendar.com/math/connect#${"a".repeat(43)}`,
        expiresAt: "2026-08-27T02:00:00.000Z",
      };
    },
    async consumeGuestClaim(familyId, memberId, claimToken, actorRef, requestId) {
      calls.push({ method: "consumeGuestClaim", familyId, memberId, claimToken, actorRef, requestId });
      return {
        apiVersion: "2026-08-24",
        requestId,
        status: "merged",
        learnerState: "ready",
        preservedAttemptCount: 3,
      };
    },
    async listLearnerDevices(familyId, memberId, requestId) {
      calls.push({ method: "listLearnerDevices", familyId, memberId, requestId });
      return [{
        deviceSessionId: "11111111-1111-4111-8111-111111111111",
        sessionKind: "paired",
        createdAt: "2026-08-20T00:00:00.000Z",
        lastUsedAt: "2026-08-27T00:00:00.000Z",
      }];
    },
    async revokeLearnerDevice(familyId, memberId, deviceSessionId, actorRef, requestId) {
      calls.push({ method: "revokeLearnerDevice", familyId, memberId, deviceSessionId, actorRef, requestId });
      return { apiVersion: "2026-08-24", requestId, status: "completed" };
    },
  };
}

function testAuth() {
  const users = {
    primary: { sub: "parent-primary", role: "parent", family_id: "family-a", is_anonymous: false },
    guardian: { sub: "parent-guardian-user", role: "parent", family_id: "family-a", is_anonymous: false },
    child: { sub: "child-user-a", role: "child", family_id: "family-a", is_anonymous: false },
    other: { sub: "parent-other", role: "parent", family_id: "family-b", is_anonymous: false },
  };
  return async (c, next) => {
    const token = c.req.header("Authorization")?.replace(/^Bearer\s+/, "") ?? "";
    const user = users[token];
    if (!user) return c.json({ error: "unauthorized" }, 401);
    c.set("user", user);
    c.set("accessTokenExp", 9999999999);
    await next();
  };
}

function createHarness() {
  const { sqlite, db } = createDb();
  const study = createStudyBinding();
  const app = new Hono();
  app.route("/api/study", createStudyRoutes(testAuth()));
  const env = {
    DB: db,
    STUDY_SERVICE: study,
    STUDY_ACTOR_REF_SECRET: "calendar-study-actor-ref-secret-at-least-32-bytes",
  };
  return {
    sqlite,
    study,
    env,
    request(method, path, token, options = {}) {
      return app.request(`https://calendar.test${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          ...(method === "GET" ? {} : { Origin: "https://hyenicalendar.com" }),
          ...options.headers,
        },
        body: options.body,
      }, env);
    },
  };
}

test("Study 상태는 인증된 보호자에게 dark flag를 기본 disabled로 반환한다", async () => {
  const h = createHarness();
  const disabled = await h.request("GET", "/api/study/status", "primary");
  assert.equal(disabled.status, 200);
  assert.deepEqual(await disabled.json(), { state: "disabled" });
  assert.equal(disabled.headers.get("cache-control"), "private, no-store");

  h.sqlite.prepare(
    "INSERT INTO app_global_settings(key,value) VALUES ('study_management_enabled','true')",
  ).run();
  assert.deepEqual(
    await (await h.request("GET", "/api/study/status", "guardian")).json(),
    { state: "ready" },
  );
  assert.equal((await h.request("GET", "/api/study/status", "child")).status, 403);
});

test("children은 현재 가족의 활성 자녀와 서버 권한만 반환하고 placeholder도 보존한다", async () => {
  const h = createHarness();
  const response = await h.request("GET", "/api/study/children", "guardian");
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    children: [
      {
        memberId: "child-a",
        displayName: "혜니",
        photoAvailable: true,
        linked: true,
        grade: 4,
        canManageLinks: false,
      },
      {
        memberId: "child-placeholder",
        displayName: "동생",
        photoAvailable: false,
        linked: false,
        grade: null,
        canManageLinks: false,
      },
    ],
  });
  assert.deepEqual(h.study.calls[0].memberIds, ["child-a", "child-placeholder"]);
});

test("활성 공동 보호자는 읽고 대표 보호자만 연결 상태를 변경한다", async () => {
  const h = createHarness();
  assert.equal((await h.request("GET", "/api/study/children/child-a/report?range=7d", "guardian")).status, 200);
  assert.equal((await h.request("GET", "/api/study/children/child-a/devices", "guardian")).status, 200);

  const requestId = "22222222-2222-4222-8222-222222222222";
  assert.equal((await h.request("POST", "/api/study/children/child-a/attach-challenges", "guardian", {
    headers: { "Idempotency-Key": requestId },
  })).status, 403);
  assert.equal((await h.request("POST", "/api/study/children/child-a/claim", "guardian", {
    headers: { "Idempotency-Key": requestId, "Content-Type": "application/json" },
    body: JSON.stringify({ claimToken: "a".repeat(43) }),
  })).status, 403);
  assert.equal((await h.request(
    "DELETE",
    "/api/study/children/child-a/devices/11111111-1111-4111-8111-111111111111",
    "guardian",
    { headers: { "Idempotency-Key": requestId } },
  )).status, 403);

  const attached = await h.request("POST", "/api/study/children/child-a/attach-challenges", "primary", {
    headers: { "Idempotency-Key": requestId },
  });
  assert.equal(attached.status, 200);
  const call = h.study.calls.find((entry) => entry.method === "createAttachChallenge");
  assert.equal(call.requestId, requestId);
  assert.notEqual(call.actorRef, "parent-primary");
  assert.doesNotMatch(call.actorRef, /parent|primary/);
});

test("다른 가족·비활성·아이 역할은 exact member 경계를 넘지 못한다", async () => {
  const h = createHarness();
  assert.equal((await h.request("GET", "/api/study/children/child-b/report?range=7d", "primary")).status, 404);
  assert.equal((await h.request("GET", "/api/study/children/child-inactive/report?range=7d", "primary")).status, 404);
  assert.equal((await h.request("GET", "/api/study/children/child-a/report?range=7d", "other")).status, 404);
  assert.equal((await h.request("GET", "/api/study/children/child-a/report?range=7d", "child")).status, 403);
});

test("mutation은 정확한 Origin·UUID idempotency와 bounded claim body를 요구한다", async () => {
  const h = createHarness();
  const path = "/api/study/children/child-a/attach-challenges";
  assert.equal((await h.request("POST", path, "primary", { headers: { Origin: "" } })).status, 403);
  assert.equal((await h.request("POST", path, "primary", {
    headers: { Origin: "https://evil.example", "Idempotency-Key": "22222222-2222-4222-8222-222222222222" },
  })).status, 403);
  assert.equal((await h.request("POST", path, "primary", {
    headers: { "Idempotency-Key": "not-a-uuid" },
  })).status, 400);

  const claim = await h.request("POST", "/api/study/children/child-a/claim", "primary", {
    headers: { "Idempotency-Key": "33333333-3333-4333-8333-333333333333", "Content-Type": "application/json" },
    body: JSON.stringify({ claimToken: "a".repeat(64) }),
  });
  assert.equal(claim.status, 200);
  assert.equal(h.study.calls.find((entry) => entry.method === "consumeGuestClaim").claimToken, "a".repeat(64));

  const oversized = await h.request("POST", "/api/study/children/child-a/claim", "primary", {
    headers: {
      "Idempotency-Key": "44444444-4444-4444-8444-444444444444",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ claimToken: "a".repeat(17 * 1024) }),
  });
  assert.equal(oversized.status, 413);
});

test("Study 장애는 Calendar 세션을 지우지 않고 고정 503으로 격리한다", async () => {
  const h = createHarness();
  h.study.getChildReport = async () => { throw new Error("secret upstream detail"); };
  const response = await h.request("GET", "/api/study/children/child-a/report?range=7d", "primary");
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), {
    error: "study_unavailable",
    code: "study_unavailable",
  });
  assert.equal(response.headers.has("set-cookie"), false);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
});

test("Study actor ref는 전용 32바이트 secret과 도메인 분리를 강제한다", async () => {
  await assert.rejects(() => actorRefForStudy("parent-primary", "too-short"), /study_actor_ref_secret_too_short/);
  const first = await actorRefForStudy("parent-primary", "calendar-study-actor-ref-secret-at-least-32-bytes");
  const again = await actorRefForStudy("parent-primary", "calendar-study-actor-ref-secret-at-least-32-bytes");
  const other = await actorRefForStudy("parent-other", "calendar-study-actor-ref-secret-at-least-32-bytes");
  assert.equal(first, again);
  assert.notEqual(first, other);
  assert.match(first, /^[A-Za-z0-9_-]{43}$/);
});
