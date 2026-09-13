import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { SignJWT, exportJWK, generateKeyPair } from "jose";
import "./helpers/tsModuleResolve.mjs";

const worker = (await import("../index.ts")).default;

const FAMILY_ID = "study-family-a";
const PARENT_ID = "study-parent-a";
const CHILD_ID = "study-child-user-a";
const SIBLING_ID = "study-child-user-b";
const CHILD_MEMBER_ID = "study-child-member-a";
const SIBLING_MEMBER_ID = "study-child-member-b";
const SECRET = "study-gateway-test-secret-with-sufficient-length";
const AUTHORIZATION_FIXTURE = JSON.parse(
  readFileSync(new URL("../contracts/fixtures/calendar-study-authorization-v2.json", import.meta.url), "utf8"),
);

class Statement {
  constructor(db, sql, bindings = []) {
    this.db = db;
    this.sql = sql;
    this.bindings = bindings;
  }

  bind(...bindings) {
    return new Statement(this.db, this.sql, bindings);
  }

  async first() {
    return this.db.sqlite.prepare(this.sql).get(...this.bindings) ?? null;
  }

  async all() {
    return { results: this.db.sqlite.prepare(this.sql).all(...this.bindings) };
  }

  async run() {
    const result = this.db.sqlite.prepare(this.sql).run(...this.bindings);
    return { meta: { changes: Number(result.changes ?? 0) } };
  }
}

class Db {
  constructor() {
    this.sqlite = new DatabaseSync(":memory:");
    this.batchTail = Promise.resolve();
  }

  prepare(sql) {
    return new Statement(this, sql);
  }

  async batch(statements) {
    const next = this.batchTail.then(async () => {
      this.sqlite.exec("BEGIN");
      try {
        const results = [];
        for (const statement of statements) results.push(await statement.run());
        this.sqlite.exec("COMMIT");
        return results;
      } catch (error) {
        this.sqlite.exec("ROLLBACK");
        throw error;
      }
    });
    this.batchTail = next.catch(() => undefined);
    return next;
  }

  close() {
    this.sqlite.close();
  }
}

const { privateKey, publicKey } = await generateKeyPair("ES256", { extractable: true });
const jwtPrivateKey = JSON.stringify(await exportJWK(privateKey));
const jwtPublicKey = JSON.stringify(await exportJWK(publicKey));

function createFixture({ market = "KR" } = {}) {
  const db = new Db();
  db.sqlite.exec(`
    CREATE TABLE users(id TEXT PRIMARY KEY);
    CREATE TABLE families(
      id TEXT PRIMARY KEY,
      parent_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      service_country TEXT,
      service_country_source TEXT,
      study_market TEXT
    );
    CREATE TABLE family_members(
      id TEXT PRIMARY KEY,
      family_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      role TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT,
      last_selected_at TEXT,
      birthdate TEXT,
      learning_grade_override INTEGER,
      learning_grade_row_version INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE account_device_sessions(
      user_id TEXT PRIMARY KEY,
      device_id TEXT NOT NULL,
      claimed_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      revoked_at TEXT
    );
    CREATE TABLE account_deletion_scopes(scope_type TEXT, scope_id TEXT);
    CREATE TABLE family_unpair_cleanup_jobs(family_id TEXT, child_user_id TEXT);
    CREATE TABLE account_mutation_leases(
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      family_id TEXT,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE app_global_settings(
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL DEFAULT '',
      updated_by TEXT,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  db.sqlite.prepare("INSERT INTO users(id) VALUES (?),(?),(?)").run(PARENT_ID, CHILD_ID, SIBLING_ID);
  db.sqlite.prepare(
    "INSERT INTO families(id,parent_id,created_at,service_country,service_country_source,study_market) VALUES (?,?,?,?,?,?)",
  ).run(FAMILY_ID, PARENT_ID, "2026-08-28T00:00:00.000Z", market, "guardian_confirmed", market);
  for (const row of [
    ["study-parent-member-a", PARENT_ID, "parent", null],
    [CHILD_MEMBER_ID, CHILD_ID, "child", "2016-08-10"],
    [SIBLING_MEMBER_ID, SIBLING_ID, "child", "2015-08-10"],
  ]) {
    db.sqlite.prepare(
      `INSERT INTO family_members(id,family_id,user_id,role,is_active,created_at,last_selected_at,birthdate)
       VALUES (?,?,?,?,1,?,NULL,?)`,
    ).run(row[0], FAMILY_ID, row[1], row[2], "2026-08-28T00:00:00.000Z", row[3]);
  }
  for (const [userId, deviceId] of [[PARENT_ID, "parent-device"], [CHILD_ID, "child-device"], [SIBLING_ID, "sibling-device"]]) {
    db.sqlite.prepare(
      `INSERT INTO account_device_sessions(user_id,device_id,claimed_at,last_seen_at,expires_at,revoked_at)
       VALUES (?,?,?,?,?,NULL)`,
    ).run(userId, deviceId, "2026-08-28T00:00:00.000Z", "2026-08-28T00:00:00.000Z", "2099-08-28T00:00:00.000Z");
  }
  for (const [key, value] of Object.entries({
    study_management_enabled: "true",
    study_learner_enabled: "true",
    study_rollout_basis_points: "10000",
    study_rollout_canary_refs: "[]",
  })) db.sqlite.prepare("INSERT INTO app_global_settings(key,value) VALUES (?,?)").run(key, value);
  return db;
}

function recordingBinding({ reject = false } = {}) {
  const calls = [];
  const record = (method) => async (input, auth) => {
    calls.push({ method, input, auth });
    if (reject) throw new Error("study_binding_private_failure");
    if (method === "getChildrenOverview") return { apiVersion: "2026-08-27", children: [] };
    if (method === "getChildReport") return { apiVersion: "2026-08-27", memberId: input.memberId, status: "available" };
    if (method === "getLearnerState") return { apiVersion: "2026-08-27", memberId: input.memberId, status: "available", grade: { grade: 4, source: "study" } };
    if (method === "listCalendarConcepts") return { apiVersion: "2026-08-27", grade: input.grade, concepts: [] };
    if (method === "abandonCalendarMission") return { apiVersion: "2026-08-27", missionId: input.missionId, status: "abandoned" };
    if (method === "submitCalendarAnswer") return { apiVersion: "2026-08-27", missionId: input.missionId, result: "accepted" };
    return { apiVersion: "2026-08-27", missionId: input.missionId ?? "mission-server-a", status: "started" };
  };
  return {
    calls,
    readinessCalls: 0,
    getChildrenOverview: record("getChildrenOverview"),
    getChildProblemHistory: record("getChildProblemHistory"),
    getChildVocabularyProgress: record("getChildVocabularyProgress"),
    getVocabularyDeck: record("getVocabularyDeck"),
    recordVocabularyReview: record("recordVocabularyReview"),
    getChildReport: record("getChildReport"),
    getLearnerState: record("getLearnerState"),
    listCalendarConcepts: record("listCalendarConcepts"),
    startCalendarMission: record("startCalendarMission"),
    getCalendarMission: record("getCalendarMission"),
    abandonCalendarMission: record("abandonCalendarMission"),
    submitCalendarAnswer: record("submitCalendarAnswer"),
    async readiness() {
      this.readinessCalls += 1;
      return { apiVersion: "2026-08-27", status: "ready" };
    },
  };
}

function statefulBinding() {
  const calls = [];
  const receipts = new Map();
  let activeMission = null;
  let startSideEffects = 0;
  let submitSideEffects = 0;
  return {
    calls,
    readinessCalls: 0,
    get startSideEffects() { return startSideEffects; },
    get submitSideEffects() { return submitSideEffects; },
    async readiness() {
      this.readinessCalls += 1;
      return { apiVersion: "2026-08-27", status: "ready" };
    },
    async getChildrenOverview(input, auth) {
      calls.push({ method: "getChildrenOverview", input, auth });
      return { apiVersion: "2026-08-27", children: [] };
    },
    async getChildReport(input, auth) {
      calls.push({ method: "getChildReport", input, auth });
      return { apiVersion: "2026-08-27", memberId: input.memberId, status: "available" };
    },
    async getLearnerState(input, auth) {
      calls.push({ method: "getLearnerState", input, auth });
      return { apiVersion: "2026-08-27", memberId: input.memberId, status: "available", grade: { grade: 4, source: "study" } };
    },
    async startCalendarMission(input, auth) {
      calls.push({ method: "startCalendarMission", input, auth });
      if (!activeMission) {
        await Promise.resolve();
        const candidate = { apiVersion: "2026-08-27", missionId: "mission-active-a", status: "started" };
        const winner = activeMission ??= candidate;
        if (winner === candidate) startSideEffects += 1;
      }
      return activeMission;
    },
    async getCalendarMission(input, auth) {
      calls.push({ method: "getCalendarMission", input, auth });
      return activeMission ?? { apiVersion: "2026-08-27", missionId: input.missionId, status: "ready" };
    },
    async submitCalendarAnswer(input, auth) {
      calls.push({ method: "submitCalendarAnswer", input, auth });
      const existing = receipts.get(auth.requestId);
      if (existing) return existing;
      await Promise.resolve();
      const winner = receipts.get(auth.requestId);
      if (winner) return winner;
      const receipt = { apiVersion: "2026-08-27", missionId: input.missionId, result: "accepted", receiptId: `receipt-${auth.requestId}` };
      receipts.set(auth.requestId, receipt);
      submitSideEffects += 1;
      return receipt;
    },
  };
}

function canonicalJson(value) {
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const record = value;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
}

function visibleFingerprint(call) {
  return createHash("sha256")
    .update(canonicalJson({ input: call.input, memberId: call.auth.memberId, grade: call.auth.grade }), "utf8")
    .digest("base64url");
}

function sessionSnapshot(db) {
  return db.sqlite.prepare(
    "SELECT user_id,device_id,claimed_at,last_seen_at,expires_at,revoked_at FROM account_device_sessions ORDER BY user_id",
  ).all();
}

async function authorization({ userId = PARENT_ID, role = "parent", deviceId = "parent-device" } = {}) {
  const token = await new SignJWT({ role, family_id: FAMILY_ID, is_anonymous: false, device_id: deviceId })
    .setProtectedHeader({ alg: "ES256" })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(privateKey);
  return `Bearer ${token}`;
}

async function request(db, binding, path, { method = "GET", body, actor, headers = {}, authorizationHeader } = {}) {
  const requestHeaders = new Headers({ Authorization: authorizationHeader ?? await authorization(actor), ...headers });
  if (body !== undefined) requestHeaders.set("Content-Type", "application/json");
  const response = await worker.fetch(new Request(`https://local.test/api/study${path}`, {
    method,
    headers: requestHeaders,
    body: body === undefined ? undefined : JSON.stringify(body),
  }), {
    DB: db,
    STUDY_SERVICE: binding,
    STUDY_RPC_HMAC_SECRET: SECRET,
    JWT_PRIVATE_KEY: jwtPrivateKey,
    JWT_PUBLIC_KEY: jwtPublicKey,
    CF_VERSION_METADATA: {},
  }, {});
  return { response, body: await response.json() };
}

test("부모 풀이 및 영단어 조회는 활성 제2 보호자를 허용하고 아이와 비활성 보호자를 거부한다", async () => {
  const db = createFixture();
  const binding = recordingBinding();
  try {
    const second = "study-second-parent";
    db.sqlite.prepare("INSERT INTO users(id) VALUES (?)").run(second);
    db.sqlite.prepare("INSERT INTO family_members(id,family_id,user_id,role,is_active,created_at) VALUES (?,?,?,'parent',1,?)")
      .run("second-parent-member", FAMILY_ID, second, "2026-08-28T00:00:00.000Z");
    db.sqlite.prepare("INSERT INTO account_device_sessions(user_id,device_id,claimed_at,last_seen_at,expires_at) VALUES (?,?,?,?,?)")
      .run(second, "second-device", "2026-08-28T00:00:00.000Z", "2026-08-28T00:00:00.000Z", "2099-08-28T00:00:00.000Z");
    const actor = { userId: second, role: "parent", deviceId: "second-device" };
    for (const [suffix, operation] of [["history?range=30d", "guardian.history"], ["vocabulary", "guardian.vocabulary"]]) {
      const result = await request(db, binding, `/children/${CHILD_MEMBER_ID}/${suffix}`, { actor });
      assert.equal(result.response.status, 200);
      assert.equal(binding.calls.at(-1).auth.operation, operation);
      assert.equal(binding.calls.at(-1).auth.familyId, FAMILY_ID);
      assert.equal(binding.calls.at(-1).input.memberId, CHILD_MEMBER_ID);
      assert.equal(binding.calls.at(-1).auth.fingerprint, visibleFingerprint(binding.calls.at(-1)));
      assert.equal(result.response.headers.get("cache-control"), "no-store");
      assert.equal((await request(db, binding, `/children/foreign-child/${suffix}`, { actor })).response.status, 403);
      assert.equal((await request(db, binding, `/children/${CHILD_MEMBER_ID}/${suffix}`,
        { actor: { userId: CHILD_ID, role: "child", deviceId: "child-device" } })).response.status, 403);
    }
    db.sqlite.prepare("UPDATE family_members SET is_active=0 WHERE user_id=?").run(second);
    assert.equal((await request(db, binding, `/children/${CHILD_MEMBER_ID}/history`, { actor })).response.status, 403);
  } finally { db.close(); }
});

test("영단어는 학년 없이 본인만 학습하고 대상이나 점수 및 시각 주입을 거부한다", async () => {
  const db = createFixture();
  const binding = recordingBinding();
  const actor = { userId: CHILD_ID, role: "child", deviceId: "child-device" };
  const body = { wordId: "apple", catalogVersion: "en-ko-v1", level: 1, rating: "again" };
  try {
    db.sqlite.prepare("UPDATE family_members SET birthdate=NULL WHERE id=?").run(CHILD_MEMBER_ID);
    const deck = await request(db, binding, "/learner/vocabulary?level=1&mode=new", { actor });
    assert.equal(deck.response.status, 200);
    assert.equal(binding.calls.at(-1).auth.grade, null);
    const saved = await request(db, binding, "/learner/vocabulary/reviews", {
      method: "POST", actor, body, headers: { "Idempotency-Key": "66666666-6666-4666-8666-666666666666" },
    });
    assert.equal(saved.response.status, 201);
    assert.equal(binding.calls.at(-1).input.memberId, CHILD_MEMBER_ID);
    assert.equal(binding.calls.at(-1).input.requestId, "66666666-6666-4666-8666-666666666666");
    for (const extra of [{ memberId: SIBLING_MEMBER_ID }, { familyId: "foreign" }, { profileId: "foreign" }, { score: 100 }, { reviewedAt: "2026-01-01" }]) {
      assert.equal((await request(db, binding, "/learner/vocabulary/reviews", { method: "POST", actor, body: { ...body, ...extra } })).response.status, 400);
    }
    for (const query of ["level=6", "level=1&level=2", "memberId=foreign", "mode=wrong"]) {
      assert.equal((await request(db, binding, `/learner/vocabulary?${query}`, { actor })).response.status, 400);
    }
    assert.equal((await request(db, binding, "/learner/vocabulary")).response.status, 403);
  } finally { db.close(); }
});

test("아이 시작 요청은 토큰의 정확한 자녀와 계산 학년만 RPC로 보낸다", async () => {
  const db = createFixture();
  const binding = recordingBinding();
  try {
    const result = await request(db, binding, "/learner/missions", {
      method: "POST",
      body: { mode: "daily" },
      actor: { userId: CHILD_ID, role: "child", deviceId: "child-device" },
    });
    assert.equal(result.response.status, 201);
    assert.equal(binding.calls.length, 1);
    assert.equal(binding.calls[0].input.memberId, CHILD_MEMBER_ID);
    assert.deepEqual(binding.calls[0].auth.grade, { grade: 4, source: "hyeni_birth_year", academicYear: 2026 });
    assert.equal(binding.calls[0].auth.role, "learner");
    assert.equal(binding.calls[0].auth.operation, "learner.start");
  } finally {
    db.close();
  }
});

test("학년이 없는 아이도 본인 학년을 선택해 즉시 RPC를 시작한다", async () => {
  const db = createFixture();
  const binding = recordingBinding();
  try {
    db.sqlite.prepare(
      "UPDATE family_members SET birthdate=NULL, learning_grade_override=NULL WHERE id=?",
    ).run(CHILD_MEMBER_ID);
    const state = await request(db, binding, "/learner/me", {
      actor: { userId: CHILD_ID, role: "child", deviceId: "child-device" },
    });
    assert.equal(state.response.status, 200);
    assert.equal(binding.calls[0].auth.grade, null);

    const started = await request(db, binding, "/learner/missions", {
      method: "POST",
      body: { mode: "daily", grade: 5 },
      actor: { userId: CHILD_ID, role: "child", deviceId: "child-device" },
    });
    assert.equal(started.response.status, 201);
    assert.deepEqual(binding.calls[1].input, {
      memberId: CHILD_MEMBER_ID,
      mode: "daily",
      grade: 5,
      requestId: binding.calls[1].input.requestId,
    });
    assert.equal(binding.calls[1].auth.grade, null);
    assert.equal(binding.calls[1].auth.operation, "learner.start");
  } finally {
    db.close();
  }
});

test("아이의 학년별 개념 조회와 주제 선택·포기는 정확한 signed RPC만 호출한다", async () => {
  const db = createFixture();
  const binding = recordingBinding();
  try {
    const catalog = await request(db, binding, "/learner/concepts?grade=4", {
      actor: { userId: CHILD_ID, role: "child", deviceId: "child-device" },
    });
    assert.equal(catalog.response.status, 200);
    assert.equal(binding.calls[0].method, "listCalendarConcepts");
    assert.deepEqual(binding.calls[0].input, {
      memberId: CHILD_MEMBER_ID,
      grade: 4,
      requestId: binding.calls[0].input.requestId,
    });
    assert.equal(binding.calls[0].auth.operation, "learner.catalog");

    const started = await request(db, binding, "/learner/missions", {
      method: "POST",
      body: { mode: "daily", conceptId: "g4-long-division" },
      actor: { userId: CHILD_ID, role: "child", deviceId: "child-device" },
    });
    assert.equal(started.response.status, 201);
    assert.equal(binding.calls[1].input.conceptId, "g4-long-division");

    const abandoned = await request(db, binding, "/learner/missions/mission-server-a/abandon", {
      method: "POST",
      actor: { userId: CHILD_ID, role: "child", deviceId: "child-device" },
    });
    assert.equal(abandoned.response.status, 200);
    assert.equal(binding.calls[2].method, "abandonCalendarMission");
    assert.equal(binding.calls[2].auth.operation, "learner.abandon");
  } finally {
    db.close();
  }
});

test("Calendar gateway는 공유 fixture의 정확한 RPC input과 {input,memberId,grade} preimage를 그대로 생산한다", async () => {
  const db = createFixture();
  const binding = recordingBinding();
  try {
    const result = await request(db, binding, "/learner/missions", {
      method: "POST",
      body: { mode: AUTHORIZATION_FIXTURE.rpcInput.mode },
      actor: { userId: CHILD_ID, role: "child", deviceId: "child-device" },
      headers: { "Idempotency-Key": AUTHORIZATION_FIXTURE.rpcInput.requestId },
    });
    assert.equal(result.response.status, 201);
    assert.equal(binding.calls.length, 1);
    const call = binding.calls[0];
    assert.equal(call.method, AUTHORIZATION_FIXTURE.rpcMethod);
    assert.equal(call.auth.operation, AUTHORIZATION_FIXTURE.operation);
    assert.deepEqual(call.input, AUTHORIZATION_FIXTURE.rpcInput);
    assert.deepEqual(
      { input: call.input, memberId: call.auth.memberId, grade: call.auth.grade },
      AUTHORIZATION_FIXTURE.fingerprintPreimage,
    );
    assert.equal(call.auth.fingerprint, AUTHORIZATION_FIXTURE.expectedFingerprint);
    assert.equal(call.auth.fingerprint, visibleFingerprint(call));
  } finally {
    db.close();
  }
});

for (const row of [
  { name: "binding 미설정", binding: null, readinessCalls: 0 },
  { name: "readiness throw", binding: Object.assign(recordingBinding(), { async readiness() { this.readinessCalls += 1; throw new Error("private readiness failure"); } }), readinessCalls: 1 },
  { name: "readiness malformed", binding: Object.assign(recordingBinding(), { async readiness() { this.readinessCalls += 1; return { apiVersion: "2026-08-27" }; } }), readinessCalls: 1 },
  { name: "readiness wrong version", binding: Object.assign(recordingBinding(), { async readiness() { this.readinessCalls += 1; return { apiVersion: "wrong", status: "ready" }; } }), readinessCalls: 1 },
]) {
  test(`${row.name}이면 business RPC 전에 sanitized 503으로 닫는다`, async () => {
    const db = createFixture();
    try {
      const result = await request(db, row.binding, "/learner/missions", {
        method: "POST",
        body: { mode: "daily" },
        actor: { userId: CHILD_ID, role: "child", deviceId: "child-device" },
      });
      assert.equal(result.response.status, 503);
      assert.deepEqual(result.body, { error: "study_unavailable" });
      assert.equal(row.binding?.readinessCalls ?? 0, row.readinessCalls);
      assert.equal(row.binding?.calls.length ?? 0, 0);
      assert.doesNotMatch(JSON.stringify(result.body), /private|readiness|token|session/i);
    } finally {
      db.close();
    }
  });
}

for (const row of [
  { path: "/children", options: {} },
  { path: `/children/${CHILD_MEMBER_ID}/overview`, options: {} },
  { path: `/children/${CHILD_MEMBER_ID}/report?range=7d`, options: {} },
  { path: "/learner/me", options: { actor: { userId: CHILD_ID, role: "child", deviceId: "child-device" } } },
  { path: "/learner/missions", options: { method: "POST", body: {}, actor: { userId: CHILD_ID, role: "child", deviceId: "child-device" } } },
  { path: "/learner/missions/mission-a", options: { actor: { userId: CHILD_ID, role: "child", deviceId: "child-device" } } },
  { path: "/learner/missions/mission-a/submissions", options: { method: "POST", body: { problemId: "problem-a", answer: "42" }, actor: { userId: CHILD_ID, role: "child", deviceId: "child-device" } } },
]) {
  test(`${row.path}는 readiness version 불일치에서 business RPC를 호출하지 않는다`, async () => {
    const db = createFixture();
    const binding = recordingBinding();
    binding.readiness = async function readiness() {
      this.readinessCalls += 1;
      return { apiVersion: "wrong", status: "ready" };
    };
    try {
      const result = await request(db, binding, row.path, row.options);
      assert.equal(result.response.status, 503);
      assert.deepEqual(result.body, { error: "study_unavailable" });
      assert.equal(binding.readinessCalls, 1);
      assert.equal(binding.calls.length, 0);
    } finally {
      db.close();
    }
  });
}

test("동시 start와 동일 submit key는 downstream state에서 하나의 mission과 receipt로 수렴한다", async () => {
  const db = createFixture();
  const binding = statefulBinding();
  try {
    const startOptions = {
      method: "POST",
      body: { mode: "daily" },
      actor: { userId: CHILD_ID, role: "child", deviceId: "child-device" },
    };
    const [firstStart, secondStart] = await Promise.all([
      request(db, binding, "/learner/missions", startOptions),
      request(db, binding, "/learner/missions", startOptions),
    ]);
    assert.equal(firstStart.response.status, 201);
    assert.equal(secondStart.response.status, 201);
    assert.equal(firstStart.body.missionId, "mission-active-a");
    assert.equal(secondStart.body.missionId, firstStart.body.missionId);
    assert.equal(binding.startSideEffects, 1);

    const submitOptions = {
      method: "POST",
      body: { problemId: "problem-a", answer: "42" },
      actor: { userId: CHILD_ID, role: "child", deviceId: "child-device" },
      headers: { "Idempotency-Key": "submission_retry_key_0001" },
    };
    const [firstSubmit, secondSubmit] = await Promise.all([
      request(db, binding, "/learner/missions/mission-active-a/submissions", submitOptions),
      request(db, binding, "/learner/missions/mission-active-a/submissions", submitOptions),
    ]);
    assert.equal(firstSubmit.response.status, 201);
    assert.equal(secondSubmit.response.status, 201);
    assert.equal(firstSubmit.body.receiptId, secondSubmit.body.receiptId);
    assert.equal(binding.submitSideEffects, 1);
  } finally {
    db.close();
  }
});

test("부모 overview와 report는 활성 자녀를 명시하고 range를 좁게 검증한다", async () => {
  const db = createFixture();
  const binding = recordingBinding();
  try {
    const missing = await request(db, binding, "/children/missing-child/overview");
    assert.equal(missing.response.status, 403);
    assert.deepEqual(missing.body, { error: "study_not_available" });
    assert.equal(binding.calls.length, 0);

    const invalidRange = await request(db, binding, `/children/${CHILD_MEMBER_ID}/report?range=all`);
    assert.equal(invalidRange.response.status, 400);
    assert.deepEqual(invalidRange.body, { error: "invalid_request" });
    assert.equal(binding.calls.length, 0);

    const report = await request(db, binding, `/children/${CHILD_MEMBER_ID}/report?range=7d`);
    assert.equal(report.response.status, 200);
    assert.equal(binding.calls[0].method, "getChildReport");
    assert.equal(binding.calls[0].input.memberId, CHILD_MEMBER_ID);
    assert.equal(binding.calls[0].input.range, "7d");
    assert.equal(binding.calls[0].auth.role, "guardian");
  } finally {
    db.close();
  }
});

test("부모 children·overview와 아이 me는 각 RPC operation으로만 전달한다", async () => {
  const db = createFixture();
  const binding = recordingBinding();
  try {
    const children = await request(db, binding, "/children");
    assert.equal(children.response.status, 200);
    assert.equal(binding.calls[0].method, "getChildrenOverview");
    assert.equal(binding.calls[0].auth.operation, "guardian.children");
    assert.equal(binding.calls[0].input.children.length, 2);

    const overview = await request(db, binding, `/children/${CHILD_MEMBER_ID}/overview`);
    assert.equal(overview.response.status, 200);
    assert.equal(binding.calls[1].method, "getChildReport");
    assert.equal(binding.calls[1].auth.operation, "guardian.overview");

    const me = await request(db, binding, "/learner/me", {
      actor: { userId: CHILD_ID, role: "child", deviceId: "child-device" },
    });
    assert.equal(me.response.status, 200);
    assert.equal(binding.calls[2].method, "getLearnerState");
    assert.equal(binding.calls[2].auth.operation, "learner.state");
  } finally {
    db.close();
  }
});

test("아이 요청은 query의 sibling memberId를 무시하고 자기 member로만 RPC를 호출한다", async () => {
  const db = createFixture();
  const binding = recordingBinding();
  try {
    const result = await request(db, binding, `/learner/missions/mission-a?memberId=${SIBLING_MEMBER_ID}`, {
      actor: { userId: CHILD_ID, role: "child", deviceId: "child-device" },
    });
    assert.equal(result.response.status, 200);
    assert.equal(binding.calls.length, 1);
    assert.equal(binding.calls[0].input.memberId, CHILD_MEMBER_ID);
    assert.equal(binding.calls[0].auth.memberId, CHILD_MEMBER_ID);
  } finally {
    db.close();
  }
});

test("비활성 자녀와 비KR 가족은 binding 전에 study_not_available로 닫는다", async () => {
  const inactiveDb = createFixture();
  const inactiveBinding = recordingBinding();
  try {
    inactiveDb.sqlite.prepare("UPDATE family_members SET is_active=0 WHERE id=?").run(CHILD_MEMBER_ID);
    const inactive = await request(inactiveDb, inactiveBinding, "/learner/me", {
      actor: { userId: CHILD_ID, role: "child", deviceId: "child-device" },
    });
    assert.equal(inactive.response.status, 403);
    assert.deepEqual(inactive.body, { error: "study_not_available" });
    assert.equal(inactiveBinding.calls.length, 0);
  } finally {
    inactiveDb.close();
  }

  const foreignDb = createFixture({ market: "JP" });
  const foreignBinding = recordingBinding();
  try {
    const foreign = await request(foreignDb, foreignBinding, "/children");
    assert.equal(foreign.response.status, 403);
    assert.deepEqual(foreign.body, { error: "study_not_available" });
    assert.equal(foreignBinding.calls.length, 0);
  } finally {
    foreignDb.close();
  }
});

test("꺼진 Study flag도 binding 전에 study_not_available로 닫는다", async () => {
  const db = createFixture();
  const binding = recordingBinding();
  try {
    db.sqlite.prepare("UPDATE app_global_settings SET value='false' WHERE key='study_learner_enabled'").run();
    const result = await request(db, binding, "/learner/me", {
      actor: { userId: CHILD_ID, role: "child", deviceId: "child-device" },
    });
    assert.equal(result.response.status, 403);
    assert.deepEqual(result.body, { error: "study_not_available" });
    assert.equal(binding.calls.length, 0);
  } finally {
    db.close();
  }
});

test("동일 Idempotency-Key 제출은 같은 requestId를 보존하고 좁은 body만 받는다", async () => {
  const db = createFixture();
  const binding = recordingBinding();
  try {
    const path = "/learner/missions/mission-a/submissions";
    const options = {
      method: "POST",
      body: { problemId: "problem-a", answer: "42" },
      actor: { userId: CHILD_ID, role: "child", deviceId: "child-device" },
      headers: { "Idempotency-Key": "submission_retry_key_0001" },
    };
    const [first, retry] = await Promise.all([request(db, binding, path, options), request(db, binding, path, options)]);
    assert.equal(first.response.status, 201);
    assert.equal(retry.response.status, 201);
    assert.equal(binding.calls.length, 2);
    assert.equal(binding.calls[0].auth.requestId, "submission_retry_key_0001");
    assert.equal(binding.calls[1].auth.requestId, binding.calls[0].auth.requestId);
    assert.equal(binding.calls[0].input.problemId, "problem-a");

    const unknown = await request(db, binding, path, {
      ...options,
      body: { problemId: "problem-a", answer: "42", extra: true },
    });
    assert.equal(unknown.response.status, 400);
    assert.deepEqual(unknown.body, { error: "invalid_request" });
    assert.equal(binding.calls.length, 2);

    const oversized = await request(db, binding, path, {
      ...options,
      body: { problemId: "problem-a", answer: "한".repeat(667) },
    });
    assert.equal(oversized.response.status, 400);
    assert.deepEqual(oversized.body, { error: "invalid_request" });
    assert.equal(binding.calls.length, 2);

    const malformedKey = await request(db, binding, path, {
      ...options,
      headers: { "Idempotency-Key": "short" },
    });
    assert.equal(malformedKey.response.status, 400);
    assert.deepEqual(malformedKey.body, { error: "invalid_request" });
    assert.equal(binding.calls.length, 2);
  } finally {
    db.close();
  }
});

test("Study schema 경계는 bytes·ID·Idempotency-Key와 서버 생성 request ID를 정확히 고정한다", async () => {
  const db = createFixture();
  const binding = recordingBinding();
  try {
    const actor = { userId: CHILD_ID, role: "child", deviceId: "child-device" };
    const mission128 = "m".repeat(128);
    const allowedMission = await request(db, binding, `/learner/missions/${mission128}`, { actor });
    assert.equal(allowedMission.response.status, 200);
    assert.equal(binding.calls.at(-1).input.missionId, mission128);

    const rejectedMission = await request(db, binding, `/learner/missions/${"m".repeat(129)}`, { actor });
    assert.equal(rejectedMission.response.status, 400);

    const exactAnswer = await request(db, binding, `/learner/missions/${mission128}/submissions`, {
      method: "POST",
      actor,
      body: { problemId: "p".repeat(128), answer: "a".repeat(2000) },
      headers: { "Idempotency-Key": "k".repeat(16) },
    });
    assert.equal(exactAnswer.response.status, 201);
    assert.equal(binding.calls.at(-1).auth.requestId, "k".repeat(16));

    const answer2001 = await request(db, binding, `/learner/missions/${mission128}/submissions`, {
      method: "POST",
      actor,
      body: { problemId: "problem-a", answer: "a".repeat(2001) },
      headers: { "Idempotency-Key": "k".repeat(16) },
    });
    assert.equal(answer2001.response.status, 400);

    const maxKey = "k".repeat(128);
    const maxKeyAccepted = await request(db, binding, "/learner/missions", {
      method: "POST",
      actor,
      body: {},
      headers: { "Idempotency-Key": maxKey },
    });
    assert.equal(maxKeyAccepted.response.status, 201);
    assert.equal(binding.calls.at(-1).auth.requestId, maxKey);

    for (const key of ["k".repeat(15), "k".repeat(129), `${"k".repeat(15)}.`]) {
      const rejected = await request(db, binding, "/learner/missions", {
        method: "POST",
        actor,
        body: {},
        headers: { "Idempotency-Key": key },
      });
      assert.equal(rejected.response.status, 400);
    }

    const noHeader = await request(db, binding, "/learner/missions", { method: "POST", actor, body: {} });
    assert.equal(noHeader.response.status, 201);
    assert.match(binding.calls.at(-1).auth.requestId, /^[0-9a-f]{8}-[0-9a-f]{4}-[4-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu);

    const startUnknown = await request(db, binding, "/learner/missions", { method: "POST", actor, body: { mode: "daily", extra: true } });
    assert.equal(startUnknown.response.status, 400);
  } finally {
    db.close();
  }
});

test("Study binding 거부는 세션 오류를 노출하거나 Calendar 상태를 바꾸지 않는다", async () => {
  const db = createFixture();
  const binding = recordingBinding({ reject: true });
  try {
    const accessToken = await authorization({ userId: CHILD_ID, role: "child", deviceId: "child-device" });
    const before = sessionSnapshot(db);
    const result = await request(db, binding, "/learner/missions", {
      method: "POST",
      body: { mode: "daily" },
      authorizationHeader: accessToken,
    });
    assert.equal(result.response.status, 503);
    assert.deepEqual(result.body, { error: "study_unavailable" });
    assert.doesNotMatch(JSON.stringify(result.body), /study_binding_private_failure|token|session/i);
    assert.deepEqual(sessionSnapshot(db), before);

    const calendarRead = await request(db, recordingBinding(), "/status", { authorizationHeader: accessToken });
    assert.equal(calendarRead.response.status, 200);
    assert.deepEqual(calendarRead.body, {
      state: "enabled",
      market: "KR",
      role: "child",
      managementEnabled: true,
      learnerEnabled: true,
    });
  } finally {
    db.close();
  }
});

test("Study binding timeout도 Calendar 세션을 건드리지 않고 sanitized 503으로 닫는다", async () => {
  const db = createFixture();
  const binding = recordingBinding();
  binding.startCalendarMission = async () => new Promise(() => undefined);
  try {
    const accessToken = await authorization({ userId: CHILD_ID, role: "child", deviceId: "child-device" });
    const before = sessionSnapshot(db);
    const result = await request(db, binding, "/learner/missions", {
      method: "POST",
      body: { mode: "daily" },
      authorizationHeader: accessToken,
    });
    assert.equal(result.response.status, 503);
    assert.deepEqual(result.body, { error: "study_unavailable" });
    assert.deepEqual(sessionSnapshot(db), before);

    const calendarRead = await request(db, recordingBinding(), "/status", { authorizationHeader: accessToken });
    assert.equal(calendarRead.response.status, 200);
    assert.deepEqual(calendarRead.body, {
      state: "enabled",
      market: "KR",
      role: "child",
      managementEnabled: true,
      learnerEnabled: true,
    });
  } finally {
    db.close();
  }
});

test("readiness pending은 5초 안에 business RPC 없이 sanitized 503으로 닫는다", { timeout: 6_500 }, async () => {
  const db = createFixture();
  const binding = recordingBinding();
  binding.readiness = async function readiness() {
    this.readinessCalls += 1;
    return new Promise(() => undefined);
  };
  try {
    const startedAt = Date.now();
    const result = await request(db, binding, "/learner/missions", {
      method: "POST",
      body: { mode: "daily" },
      actor: { userId: CHILD_ID, role: "child", deviceId: "child-device" },
    });
    const elapsedMs = Date.now() - startedAt;
    assert.equal(result.response.status, 503);
    assert.deepEqual(result.body, { error: "study_unavailable" });
    assert.equal(binding.readinessCalls, 1);
    assert.equal(binding.calls.length, 0);
    assert.ok(elapsedMs < 5_800, `readiness timeout ${elapsedMs}ms exceeded the 5-second request budget`);
    assert.doesNotMatch(JSON.stringify(result.body), /secret|private|raw|token|session/i);
  } finally {
    db.close();
  }
});

test("readiness 뒤 business timeout도 단일 5초 deadline 안에서 닫는다", { timeout: 8_000 }, async () => {
  const db = createFixture();
  const binding = recordingBinding();
  binding.readiness = async function readiness() {
    this.readinessCalls += 1;
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    return { apiVersion: "2026-08-27", status: "ready" };
  };
  binding.startCalendarMission = async (input, auth) => {
    binding.calls.push({ method: "startCalendarMission", input, auth });
    return new Promise(() => undefined);
  };
  try {
    const startedAt = Date.now();
    const result = await request(db, binding, "/learner/missions", {
      method: "POST",
      body: { mode: "daily" },
      actor: { userId: CHILD_ID, role: "child", deviceId: "child-device" },
    });
    const elapsedMs = Date.now() - startedAt;
    assert.equal(result.response.status, 503);
    assert.deepEqual(result.body, { error: "study_unavailable" });
    assert.equal(binding.readinessCalls, 1);
    assert.equal(binding.calls.length, 1);
    assert.ok(elapsedMs < 5_800, `combined binding timeout ${elapsedMs}ms exceeded the 5-second request budget`);
    assert.doesNotMatch(JSON.stringify(result.body), /secret|private|raw|token|session/i);
  } finally {
    db.close();
  }
});
