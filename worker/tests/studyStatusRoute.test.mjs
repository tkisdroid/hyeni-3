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
  }

  prepare(sql) {
    return new Statement(this, sql);
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
      last_selected_at TEXT
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
    CREATE TABLE app_global_settings(
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL DEFAULT '',
      updated_by TEXT,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  db.sqlite.prepare("INSERT INTO users(id) VALUES (?)").run(USER_ID);
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
      `INSERT INTO family_members(id,family_id,user_id,role,is_active,created_at,last_selected_at)
       VALUES (?,?,?,?,?,?,NULL)`,
    ).run("study-member-a", FAMILY_ID, USER_ID, role, membershipActive ? 1 : 0, "2026-08-28T00:00:00.000Z");
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

async function authorization({ familyId = FAMILY_ID, role = "parent", deviceId = DEVICE_ID } = {}) {
  const token = await new SignJWT({ role, family_id: familyId, is_anonymous: false, device_id: deviceId })
    .setProtectedHeader({ alg: "ES256" })
    .setSubject(USER_ID)
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(privateKey);
  return `Bearer ${token}`;
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
