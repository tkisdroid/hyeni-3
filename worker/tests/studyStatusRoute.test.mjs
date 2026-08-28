import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { SignJWT, exportJWK, generateKeyPair } from "jose";
import "./helpers/tsModuleResolve.mjs";

const worker = (await import("../index.ts")).default;
const { isInBasisPointRollout } = await import("../lib/studyFeatureState.ts");

const DEVICE_ID = "study-device-1";
const FAMILY_ID = "study-family-a";
const USER_ID = "study-user-a";
const COPARENT_USER_ID = "study-coparent-a";
const CHILD_USER_ID = "study-child-user-a";
const CHILD_MEMBER_ID = "study-child-member-a";
const ROLLOUT_SECRET = "study-rollout-test-secret-with-sufficient-length";

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
    if (this.db.failDeviceSessionRead && this.sql.includes("FROM account_device_sessions")) {
      throw new Error("simulated_device_session_read_failure");
    }
    if (this.db.failSettingsRead && this.sql.includes("FROM app_global_settings")) {
      throw new Error("simulated_study_settings_read_failure");
    }
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
    this.failDeviceSessionRead = false;
    this.failSettingsRead = false;
    this.batchBarrier = null;
    this.batchTail = Promise.resolve();
  }

  prepare(sql) {
    return new Statement(this, sql);
  }

  async batch(statements) {
    if (this.batchBarrier) await this.batchBarrier();
    const run = this.batchTail.then(() => this.runBatch(statements));
    this.batchTail = run.catch(() => undefined);
    return run;
  }

  async runBatch(statements) {
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
  }

  close() {
    this.sqlite.close();
  }
}

const { privateKey, publicKey } = await generateKeyPair("ES256", { extractable: true });
const jwtPrivateKey = JSON.stringify(await exportJWK(privateKey));
const jwtPublicKey = JSON.stringify(await exportJWK(publicKey));

function createFixture({
  country = "KR",
  market = "KR",
  confirmed = true,
  membershipActive = true,
  includeFamily = true,
  deviceSession = "active",
  role = "parent",
} = {}) {
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
      user_id TEXT,
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
    CREATE TABLE study_setting_audit(
      id TEXT PRIMARY KEY,
      family_id TEXT NOT NULL,
      member_id TEXT,
      actor_user_id TEXT NOT NULL,
      setting TEXT NOT NULL,
      previous_value TEXT,
      next_value TEXT,
      request_id TEXT NOT NULL UNIQUE,
      request_row_version INTEGER NOT NULL,
      occurred_at TEXT NOT NULL
    );
  `);
  db.sqlite.prepare("INSERT INTO users(id) VALUES (?),(?),(?)").run(USER_ID, COPARENT_USER_ID, CHILD_USER_ID);
  if (includeFamily) {
    db.sqlite.prepare(
      `INSERT INTO families(id,parent_id,created_at,service_country,service_country_source,study_market)
       VALUES (?,?,?,?,?,?)`,
    ).run(
      FAMILY_ID,
      "different-owner",
      "2026-08-28T00:00:00.000Z",
      country,
      confirmed ? "guardian_confirmed" : "edge_suggested",
      market,
    );
    db.sqlite.prepare(
      `INSERT INTO family_members(id,family_id,user_id,role,is_active,created_at,last_selected_at,birthdate)
       VALUES (?,?,?,?,?,?,NULL,?)`,
    ).run("study-member-a", FAMILY_ID, USER_ID, role, membershipActive ? 1 : 0, "2026-08-28T00:00:00.000Z", null);
    if (role === "parent") {
      db.sqlite.prepare(
        `INSERT INTO family_members(id,family_id,user_id,role,is_active,created_at,last_selected_at,birthdate)
         VALUES (?,?,?,?,?,?,NULL,?)`,
      ).run("study-coparent-member-a", FAMILY_ID, COPARENT_USER_ID, "parent", 1, "2026-08-28T00:00:00.000Z", null);
    }
    db.sqlite.prepare(
      `INSERT INTO family_members(id,family_id,user_id,role,is_active,created_at,last_selected_at,birthdate)
       VALUES (?,?,?,?,?,?,NULL,?)`,
    ).run(CHILD_MEMBER_ID, FAMILY_ID, CHILD_USER_ID, "child", 1, "2026-08-28T00:00:00.000Z", "2016-08-10");
  }
  if (deviceSession !== "missing") {
    db.sqlite.prepare(
      `INSERT INTO account_device_sessions(user_id,device_id,claimed_at,last_seen_at,expires_at,revoked_at)
       VALUES (?,?,?,?,?,?)`,
    ).run(
      USER_ID,
      DEVICE_ID,
      "2026-08-28T00:00:00.000Z",
      "2026-08-28T00:00:00.000Z",
      "2099-08-28T00:00:00.000Z",
      deviceSession === "revoked" ? "2026-08-28T00:00:00.000Z" : null,
    );
    if (role === "parent") {
      db.sqlite.prepare(
        `INSERT INTO account_device_sessions(user_id,device_id,claimed_at,last_seen_at,expires_at,revoked_at)
         VALUES (?,?,?,?,?,NULL)`,
      ).run(COPARENT_USER_ID, "study-coparent-device", "2026-08-28T00:00:00.000Z", "2026-08-28T00:00:00.000Z", "2099-08-28T00:00:00.000Z");
    }
  }
  return db;
}

function saveSettings(db, values = {}) {
  const defaults = {
    study_management_enabled: "true",
    study_learner_enabled: "true",
    study_rollout_basis_points: "10000",
    study_rollout_canary_refs: "[]",
  };
  for (const [key, value] of Object.entries({ ...defaults, ...values })) {
    db.sqlite.prepare("INSERT INTO app_global_settings(key,value) VALUES (?,?)").run(key, value);
  }
}

function studyBinding(status = "ready") {
  return {
    readinessCalls: 0,
    async readiness() {
      this.readinessCalls += 1;
      return { apiVersion: "2026-08-27", status };
    },
  };
}

function assertNoStore(response) {
  assert.equal(response.headers.get("Cache-Control"), "no-store");
}

async function rolloutFamilyRef(familyId) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(ROLLOUT_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`study-rollout\n${familyId}`),
  );
  return Buffer.from(digest).toString("base64url");
}

async function authorization({ familyId = FAMILY_ID, role = "parent", deviceId = DEVICE_ID, userId = USER_ID } = {}) {
  const token = await new SignJWT({ role, family_id: familyId, is_anonymous: false, device_id: deviceId })
    .setProtectedHeader({ alg: "ES256" })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(privateKey);
  return `Bearer ${token}`;
}

async function requestGrade(db, memberId = CHILD_MEMBER_ID, {
  body = { grade: 5, rowVersion: 1, requestId: "grade-request-1" },
  token = {},
} = {}) {
  const response = await worker.fetch(new Request(`https://local.test/api/study/children/${memberId}/grade`, {
    method: "PUT",
    headers: {
      Authorization: await authorization(token),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  }), {
    DB: db,
    STUDY_SERVICE: studyBinding(),
    STUDY_RPC_HMAC_SECRET: ROLLOUT_SECRET,
    JWT_PRIVATE_KEY: jwtPrivateKey,
    JWT_PUBLIC_KEY: jwtPublicKey,
    CF_VERSION_METADATA: {},
  }, {});
  return { response, body: await response.json() };
}

async function requestStudyStatus(db, {
  binding = studyBinding(),
  authorizationHeader,
  token = {},
} = {}) {
  const response = await worker.fetch(new Request("https://local.test/api/study/status", {
    headers: { Authorization: authorizationHeader ?? await authorization(token) },
  }), {
    DB: db,
    STUDY_SERVICE: binding,
    STUDY_RPC_HMAC_SECRET: ROLLOUT_SECRET,
    JWT_PRIVATE_KEY: jwtPrivateKey,
    JWT_PUBLIC_KEY: jwtPublicKey,
    CF_VERSION_METADATA: {},
  }, {});
  return { response, body: await response.json(), binding };
}

for (const row of [
  { market: "KR", flag: true, rollout: "10000", expected: "enabled" },
  { market: null, country: null, flag: true, expected: "not_confirmed" },
  { market: null, country: "JP", flag: true, expected: "outside_market" },
  { market: "KR", flag: false, expected: "feature_disabled" },
]) {
  test(`Study status ${row.expected}`, async () => {
    const db = createFixture({ country: row.country === undefined ? "KR" : row.country, market: row.market });
    try {
      saveSettings(db, {
        study_management_enabled: String(row.flag),
        study_rollout_basis_points: row.rollout ?? "10000",
      });
      const result = await requestStudyStatus(db);
      assert.equal(result.response.status, 200);
      assert.equal(result.body.state, row.expected);
      assert.equal(result.binding.readinessCalls, row.expected === "enabled" ? 1 : 0);
    } finally {
      db.close();
    }
  });
}

test("유효하지 않은 access token은 Study 상태를 열지 않는다", async () => {
  const db = createFixture();
  try {
    saveSettings(db);
    const result = await requestStudyStatus(db, { authorizationHeader: "Bearer invalid-token" });
    assert.equal(result.response.status, 401);
    assert.deepEqual(result.body, { error: "invalid_token" });
    assertNoStore(result.response);
    assert.equal(result.binding.readinessCalls, 0);
  } finally {
    db.close();
  }
});

for (const deviceSession of ["revoked", "missing"]) {
  test(`${deviceSession} 기기 세션은 Study 상태를 열지 않는다`, async () => {
    const db = createFixture({ deviceSession });
    try {
      saveSettings(db);
      const result = await requestStudyStatus(db);
      assert.equal(result.response.status, 401);
      assert.equal(result.body.error, "device_session_inactive");
      assertNoStore(result.response);
      assert.equal(result.binding.readinessCalls, 0);
    } finally {
      db.close();
    }
  });
}

for (const row of [
  { name: "비활성 가족 구성원", options: { membershipActive: false } },
  { name: "가족 없음", options: { includeFamily: false } },
]) {
  test(`${row.name}은 확정 전 상태로 닫는다`, async () => {
    const db = createFixture(row.options);
    try {
      saveSettings(db);
      const result = await requestStudyStatus(db);
      assert.equal(result.response.status, 200);
      assert.deepEqual(result.body, { state: "not_confirmed" });
      assert.equal(result.binding.readinessCalls, 0);
    } finally {
      db.close();
    }
  });
}

test("잘못된 flag와 rollout 설정은 fail-closed로 닫는다", async () => {
  const db = createFixture();
  try {
    saveSettings(db, {
      study_management_enabled: "TRUE",
      study_rollout_basis_points: "10000.0",
      study_rollout_canary_refs: "not-json",
    });
    const result = await requestStudyStatus(db);
    assert.equal(result.response.status, 200);
    assert.deepEqual(result.body, { state: "feature_disabled" });
    assert.equal(result.binding.readinessCalls, 0);
  } finally {
    db.close();
  }
});

test("기기 세션 조회 불가도 Study route 범위에서 no-store로 닫는다", async () => {
  const db = createFixture();
  try {
    saveSettings(db);
    db.failDeviceSessionRead = true;
    const result = await requestStudyStatus(db);
    assert.equal(result.response.status, 503);
    assert.deepEqual(result.body, { error: "auth_unavailable" });
    assertNoStore(result.response);
    assert.equal(result.binding.readinessCalls, 0);
  } finally {
    db.close();
  }
});

test("누락된 learner flag와 잘못된 rollout 값은 fail-closed로 닫는다", async () => {
  const db = createFixture({ role: "child" });
  try {
    saveSettings(db, {
      study_learner_enabled: "",
      study_rollout_basis_points: "10000.0",
    });
    const result = await requestStudyStatus(db, { token: { role: "child" } });
    assert.equal(result.response.status, 200);
    assert.deepEqual(result.body, { state: "feature_disabled" });
    assert.equal(result.binding.readinessCalls, 0);
  } finally {
    db.close();
  }
});

test("활성 learner membership은 management flag가 아니라 learner flag를 사용한다", async () => {
  const db = createFixture({ role: "child" });
  try {
    saveSettings(db, {
      study_management_enabled: "false",
      study_learner_enabled: "true",
    });
    const result = await requestStudyStatus(db, { token: { role: "child" } });
    assert.equal(result.response.status, 200);
    assert.deepEqual(result.body, { state: "enabled" });
    assert.equal(result.binding.readinessCalls, 1);
  } finally {
    db.close();
  }
});

test("확정된 KR인데 market 값이 없으면 Study를 열지 않는다", async () => {
  const db = createFixture({ market: null, country: "KR" });
  try {
    saveSettings(db);
    const result = await requestStudyStatus(db);
    assert.equal(result.response.status, 200);
    assert.deepEqual(result.body, { state: "not_confirmed" });
    assert.equal(result.binding.readinessCalls, 0);
  } finally {
    db.close();
  }
});

test("전역 설정 읽기 오류는 fail-closed로 닫는다", async () => {
  const db = createFixture();
  try {
    saveSettings(db);
    db.failSettingsRead = true;
    const result = await requestStudyStatus(db);
    assert.equal(result.response.status, 200);
    assert.deepEqual(result.body, { state: "feature_disabled" });
    assert.equal(result.binding.readinessCalls, 0);
  } finally {
    db.close();
  }
});

for (const row of [
  { basisPoints: "0", expected: "feature_disabled" },
  { basisPoints: "1", expected: "feature_disabled" },
  { basisPoints: "9999", expected: "enabled" },
  { basisPoints: "10000", expected: "enabled" },
]) {
  test(`rollout basis points ${row.basisPoints}는 경계를 정확히 판정한다`, async () => {
    const db = createFixture();
    try {
      saveSettings(db, { study_rollout_basis_points: row.basisPoints });
      const result = await requestStudyStatus(db);
      assert.equal(result.response.status, 200);
      assert.equal(result.body.state, row.expected);
      assert.equal(result.binding.readinessCalls, row.expected === "enabled" ? 1 : 0);
    } finally {
      db.close();
    }
  });
}

test("정확히 일치한 canary familyRef만 rollout 전에 Study를 연다", async () => {
  const db = createFixture();
  try {
    saveSettings(db, {
      study_rollout_basis_points: "0",
      study_rollout_canary_refs: "[]",
    });
    const ineligible = await requestStudyStatus(db);
    assert.deepEqual(ineligible.body, { state: "feature_disabled" });
    assert.equal(ineligible.binding.readinessCalls, 0);
  } finally {
    db.close();
  }

  const eligibleDb = createFixture();
  try {
    saveSettings(eligibleDb, {
      study_rollout_basis_points: "0",
      study_rollout_canary_refs: JSON.stringify([await rolloutFamilyRef(FAMILY_ID)]),
    });
    const eligible = await requestStudyStatus(eligibleDb);
    assert.equal(eligible.response.status, 200);
    assert.deepEqual(eligible.body, { state: "enabled" });
    assert.equal(eligible.binding.readinessCalls, 1);
  } finally {
    eligibleDb.close();
  }
});

test("Study binding 장애는 모든 사전 게이트 뒤에만 unavailable을 반환한다", async () => {
  const db = createFixture();
  try {
    saveSettings(db);
    const result = await requestStudyStatus(db, { binding: studyBinding("not_ready") });
    assert.equal(result.response.status, 503);
    assert.deepEqual(result.body, { state: "unavailable" });
    assertNoStore(result.response);
    assert.equal(result.binding.readinessCalls, 1);
  } finally {
    db.close();
  }
});

for (const row of [
  { name: "binding 미설정", binding: null },
  { name: "binding throw", binding: { async readiness() { throw new Error("study_binding_secret_error"); } } },
  { name: "잘못된 apiVersion", binding: { async readiness() { return { apiVersion: "wrong", status: "ready" }; } } },
  { name: "잘못된 응답 shape", binding: { async readiness() { return { status: "ready" }; } } },
]) {
  test(`${row.name}은 raw 오류 없이 unavailable로 닫는다`, async () => {
    const db = createFixture();
    try {
      saveSettings(db);
      const result = await requestStudyStatus(db, { binding: row.binding });
      assert.equal(result.response.status, 503);
      assert.deepEqual(result.body, { state: "unavailable" });
      assertNoStore(result.response);
      assert.doesNotMatch(JSON.stringify(result.body), /study_binding_secret_error/);
    } finally {
      db.close();
    }
  });
}

for (const row of [
  { first16Bits: 0, basisPoints: 0, expected: false },
  { first16Bits: 0, basisPoints: 1, expected: true },
  { first16Bits: 6, basisPoints: 1, expected: true },
  { first16Bits: 7, basisPoints: 1, expected: false },
  { first16Bits: 65_528, basisPoints: 9_999, expected: true },
  { first16Bits: 65_529, basisPoints: 9_999, expected: true },
  { first16Bits: 65_530, basisPoints: 9_999, expected: false },
  { first16Bits: 65_535, basisPoints: 9_999, expected: false },
  { first16Bits: 65_535, basisPoints: 10_000, expected: true },
]) {
  test(`rollout 16-bit ${row.first16Bits}와 ${row.basisPoints}bp의 포함 경계는 고정된다`, () => {
    assert.equal(isInBasisPointRollout(row.first16Bits, row.basisPoints), row.expected);
  });
}

test("활성 보호자는 정확히 지정한 활성 아이의 학년 override를 바꾼다", async () => {
  const db = createFixture();
  try {
    const result = await requestGrade(db, CHILD_MEMBER_ID, {
      body: { grade: 5, rowVersion: 1, requestId: "grade-parent-write" },
    });
    assert.equal(result.response.status, 200);
    assert.deepEqual(result.body, {
      grade: { grade: 5, source: "parent_override", academicYear: 2026 },
      rowVersion: 2,
    });
    assert.equal(db.sqlite.prepare("SELECT learning_grade_override FROM family_members WHERE id=?").get(CHILD_MEMBER_ID).learning_grade_override, 5);
    assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS count FROM study_setting_audit WHERE member_id=?").get(CHILD_MEMBER_ID).count, 1);
  } finally {
    db.close();
  }
});

test("활성 공동 보호자는 바꾸고 아이와 비활성 또는 다른 아이 member id는 거부한다", async () => {
  const db = createFixture();
  try {
    const coparent = await requestGrade(db, CHILD_MEMBER_ID, {
      body: { grade: 6, rowVersion: 1, requestId: "grade-coparent-write" },
      token: { userId: COPARENT_USER_ID, deviceId: "study-coparent-device" },
    });
    assert.equal(coparent.response.status, 200);

    const childDb = createFixture({ role: "child" });
    try {
      const child = await requestGrade(childDb, CHILD_MEMBER_ID, {
        body: { grade: 5, rowVersion: 1, requestId: "grade-child-denied" },
        token: { role: "child" },
      });
      assert.equal(child.response.status, 403);
      assert.deepEqual(child.body, { error: "grade_forbidden" });
    } finally {
      childDb.close();
    }

    db.sqlite.prepare("UPDATE family_members SET is_active=0 WHERE id=?").run(CHILD_MEMBER_ID);
    const inactive = await requestGrade(db, CHILD_MEMBER_ID, {
      body: { grade: 4, rowVersion: 2, requestId: "grade-inactive-child" },
    });
    assert.equal(inactive.response.status, 403);
    assert.deepEqual(inactive.body, { error: "grade_forbidden" });

    const foreign = await requestGrade(db, "missing-child-member", {
      body: { grade: 4, rowVersion: 2, requestId: "grade-foreign-child" },
    });
    assert.equal(foreign.response.status, 403);
    assert.deepEqual(foreign.body, { error: "grade_forbidden" });
  } finally {
    db.close();
  }
});

test("오래된 학년 row version은 최신 계산 학년과 함께 grade_changed를 반환한다", async () => {
  const db = createFixture();
  try {
    db.sqlite.prepare(
      "UPDATE family_members SET learning_grade_override=3, learning_grade_row_version=2 WHERE id=?",
    ).run(CHILD_MEMBER_ID);
    const result = await requestGrade(db, CHILD_MEMBER_ID, {
      body: { grade: 5, rowVersion: 1, requestId: "grade-stale" },
    });
    assert.equal(result.response.status, 409);
    assert.deepEqual(result.body, {
      error: "grade_changed",
      grade: { grade: 3, source: "parent_override", academicYear: 2026 },
      rowVersion: 2,
    });
  } finally {
    db.close();
  }
});

test("학년 변경은 audit과 함께 원자 저장되고 같은 request id만 재생한다", async () => {
  const db = createFixture();
  try {
    const input = { grade: 5, rowVersion: 1, requestId: "grade-idempotent" };
    const first = await requestGrade(db, CHILD_MEMBER_ID, { body: input });
    const retry = await requestGrade(db, CHILD_MEMBER_ID, { body: input });
    const mismatch = await requestGrade(db, CHILD_MEMBER_ID, {
      body: { ...input, grade: 6 },
    });
    assert.equal(first.response.status, 200);
    assert.deepEqual(retry.body, first.body);
    assert.equal(mismatch.response.status, 409);
    assert.deepEqual(mismatch.body, { error: "grade_request_id_conflict" });
    assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS count FROM study_setting_audit WHERE request_id=?").get(input.requestId).count, 1);
    assert.equal(db.sqlite.prepare("SELECT learning_grade_row_version FROM family_members WHERE id=?").get(CHILD_MEMBER_ID).learning_grade_row_version, 2);
  } finally {
    db.close();
  }
});

test("stale 경쟁으로 조건부 update가 0건이면 audit-only 행을 남기지 않는다", async () => {
  const db = createFixture();
  try {
    const originalBatch = db.batch.bind(db);
    db.batch = async (statements) => {
      db.sqlite.prepare("UPDATE family_members SET learning_grade_row_version=2 WHERE id=?").run(CHILD_MEMBER_ID);
      return originalBatch(statements);
    };
    const result = await requestGrade(db, CHILD_MEMBER_ID, {
      body: { grade: 5, rowVersion: 1, requestId: "grade-stale-race" },
    });
    assert.equal(result.response.status, 409);
    assert.equal(result.body.error, "grade_changed");
    assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS count FROM study_setting_audit WHERE request_id='grade-stale-race'").get().count, 0);
  } finally {
    db.close();
  }
});

test("자동 계산으로 reset할 때 생년월일이 없으면 기존 override와 audit을 바꾸지 않는다", async () => {
  const db = createFixture();
  try {
    db.sqlite.prepare(
      "UPDATE family_members SET birthdate=NULL, learning_grade_override=5 WHERE id=?",
    ).run(CHILD_MEMBER_ID);
    const result = await requestGrade(db, CHILD_MEMBER_ID, {
      body: { grade: null, rowVersion: 1, requestId: "grade-reset-invalid-birthdate" },
    });
    assert.equal(result.response.status, 422);
    assert.deepEqual(result.body, { error: "learning_grade_unavailable" });
    const unchanged = db.sqlite.prepare(
      "SELECT learning_grade_override, learning_grade_row_version FROM family_members WHERE id=?",
    ).get(CHILD_MEMBER_ID);
    assert.equal(unchanged.learning_grade_override, 5);
    assert.equal(unchanged.learning_grade_row_version, 1);
    assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS count FROM study_setting_audit WHERE request_id=?").get("grade-reset-invalid-birthdate").count, 0);
  } finally {
    db.close();
  }
});

test("비활성 주 보호자는 parent_id가 남아도 학년을 바꾸지 못한다", async () => {
  const db = createFixture();
  try {
    db.sqlite.prepare("UPDATE families SET parent_id=? WHERE id=?").run(USER_ID, FAMILY_ID);
    db.sqlite.prepare("UPDATE family_members SET is_active=0 WHERE id='study-member-a'").run();
    const result = await requestGrade(db, CHILD_MEMBER_ID, {
      body: { grade: 5, rowVersion: 1, requestId: "grade-inactive-primary" },
    });
    assert.equal(result.response.status, 403);
    assert.deepEqual(result.body, { error: "grade_forbidden" });
    const unchanged = db.sqlite.prepare(
      "SELECT learning_grade_override, learning_grade_row_version FROM family_members WHERE id=?",
    ).get(CHILD_MEMBER_ID);
    assert.equal(unchanged.learning_grade_override, null);
    assert.equal(unchanged.learning_grade_row_version, 1);
    assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS count FROM study_setting_audit WHERE request_id=?").get("grade-inactive-primary").count, 0);
  } finally {
    db.close();
  }
});

test("같은 request id 경쟁의 후행 요청은 canonical 결과를 재생한다", async () => {
  const db = createFixture();
  try {
    let arrivals = 0;
    let releaseBatches;
    const bothAtBatch = new Promise((resolve) => { releaseBatches = resolve; });
    db.batchBarrier = async () => {
      arrivals += 1;
      if (arrivals === 2) releaseBatches();
      await bothAtBatch;
    };
    const input = { grade: 5, rowVersion: 1, requestId: "grade-concurrent-replay" };
    const [first, second] = await Promise.all([
      requestGrade(db, CHILD_MEMBER_ID, { body: input }),
      requestGrade(db, CHILD_MEMBER_ID, { body: input }),
    ]);
    const expected = {
      grade: { grade: 5, source: "parent_override", academicYear: 2026 },
      rowVersion: 2,
    };
    assert.equal(first.response.status, 200);
    assert.equal(second.response.status, 200);
    assert.deepEqual(first.body, expected);
    assert.deepEqual(second.body, expected);
    assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS count FROM study_setting_audit WHERE request_id=?").get(input.requestId).count, 1);
    assert.equal(db.sqlite.prepare("SELECT learning_grade_row_version FROM family_members WHERE id=?").get(CHILD_MEMBER_ID).learning_grade_row_version, 2);
  } finally {
    db.close();
  }
});
