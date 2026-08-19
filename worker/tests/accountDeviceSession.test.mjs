import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import "./helpers/tsModuleResolve.mjs";

const {
  ActiveDeviceSessionExistsError,
  checkAccountDeviceSession,
  claimAccountDeviceSession,
  releaseAccountDeviceSession,
} = await import("../lib/accountDeviceSession.ts");
const { rotateRefreshToken } = await import("../lib/refresh.ts");

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

class D1Adapter {
  constructor(sqlite) {
    this.sqlite = sqlite;
  }

  prepare(sql) {
    return new Statement(this.sqlite, sql);
  }

  async batch(statements) {
    this.sqlite.exec("BEGIN IMMEDIATE");
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
}

function fixture() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(readFileSync(new URL("../db/account-device-sessions.sql", import.meta.url), "utf8"));
  sqlite.exec(`
    CREATE TABLE users (id TEXT PRIMARY KEY);
    CREATE TABLE account_deletion_scopes (scope_type TEXT, scope_id TEXT);
    CREATE TABLE refresh_tokens (
      token TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      family_id TEXT,
      device_id TEXT,
      issued_at TEXT,
      expires_at TEXT,
      revoked INTEGER NOT NULL DEFAULT 0,
      rotated_to TEXT,
      rotated_at TEXT
    );
    INSERT INTO users(id) VALUES ('user-a');
  `);
  return { sqlite, db: new D1Adapter(sqlite) };
}

const at = (iso) => new Date(iso);

test("같은 계정은 같은 설치만 갱신되고 다른 활성 설치는 거부된다", async () => {
  const { sqlite, db } = fixture();
  const now = at("2026-08-20T00:00:00.000Z");
  await claimAccountDeviceSession(db, "user-a", {
    deviceId: "device-a",
    deviceLabel: "부모 A17",
    devicePlatform: "android",
  }, now);
  await claimAccountDeviceSession(db, "user-a", {
    deviceId: "device-a",
    deviceLabel: "부모 A17 새 이름",
    devicePlatform: "android",
  }, at("2026-08-20T00:05:00.000Z"));

  await assert.rejects(
    claimAccountDeviceSession(db, "user-a", {
      deviceId: "device-b",
      deviceLabel: "다른 기기",
      devicePlatform: "web",
    }, at("2026-08-20T00:06:00.000Z")),
    ActiveDeviceSessionExistsError,
  );
  assert.equal(await checkAccountDeviceSession(db, "user-a", "device-a", now), "active");
  assert.equal(await checkAccountDeviceSession(db, "user-a", "device-b", now), "inactive");
  assert.equal(await checkAccountDeviceSession(db, "user-a", null, now), "inactive");
  const row = sqlite.prepare(
    "SELECT device_id,device_label,device_platform FROM account_device_sessions WHERE user_id='user-a'",
  ).get();
  assert.deepEqual({ ...row }, {
    device_id: "device-a",
    device_label: "부모 A17 새 이름",
    device_platform: "android",
  });
});

test("정상 로그아웃 후에는 다른 설치가 계정 잠금을 인계할 수 있다", async () => {
  const { db } = fixture();
  const now = at("2026-08-20T00:00:00.000Z");
  await claimAccountDeviceSession(db, "user-a", { deviceId: "device-a" }, now);
  assert.equal(await releaseAccountDeviceSession(db, "user-a", "device-b", now), false);
  assert.equal(await releaseAccountDeviceSession(db, "user-a", "device-a", now), true);
  await claimAccountDeviceSession(db, "user-a", { deviceId: "device-b" }, now);
  assert.equal(await checkAccountDeviceSession(db, "user-a", "device-b", now), "active");
  assert.equal(await checkAccountDeviceSession(db, "user-a", "device-a", now), "inactive");
});

test("다른 활성 설치와 충돌한 refresh는 기존 토큰을 회전시키지 않는다", async () => {
  const { sqlite, db } = fixture();
  const now = new Date();
  sqlite.prepare(
    `INSERT INTO refresh_tokens
       (token,user_id,family_id,device_id,issued_at,expires_at,revoked)
     VALUES (?,?,?,?,?,?,0)`,
  ).run(
    "refresh-a",
    "user-a",
    null,
    "device-a",
    now.toISOString(),
    new Date(now.getTime() + 60_000).toISOString(),
  );
  await claimAccountDeviceSession(db, "user-a", { deviceId: "device-b" }, now);

  await assert.rejects(
    rotateRefreshToken(db, "refresh-a", "device-a"),
    ActiveDeviceSessionExistsError,
  );
  const untouched = sqlite.prepare(
    "SELECT revoked,rotated_to FROM refresh_tokens WHERE token='refresh-a'",
  ).get();
  assert.deepEqual({ ...untouched }, { revoked: 0, rotated_to: null });

  await releaseAccountDeviceSession(db, "user-a", "device-b", now);
  const rotated = await rotateRefreshToken(db, "refresh-a", "device-a");
  assert.equal(rotated?.deviceId, "device-a");
  assert.notEqual(rotated?.newToken, "refresh-a");
  assert.equal(await checkAccountDeviceSession(db, "user-a", "device-a"), "active");
});

test("로그인·페어링·미들웨어·로그아웃이 활성 설치 정본을 공통 사용한다", () => {
  const auth = readFileSync(new URL("../routes/auth.ts", import.meta.url), "utf8");
  const family = readFileSync(new URL("../routes/family.ts", import.meta.url), "utf8");
  const middleware = readFileSync(new URL("../middleware/auth.ts", import.meta.url), "utf8");
  const activeAccess = readFileSync(new URL("../lib/authenticatedAccess.ts", import.meta.url), "utf8");
  const restShim = readFileSync(new URL("../routes/rest-shim-auth.ts", import.meta.url), "utf8");
  const push = readFileSync(new URL("../routes/push-notify.ts", import.meta.url), "utf8");
  const storage = readFileSync(new URL("../routes/storage.ts", import.meta.url), "utf8");
  assert.match(auth, /issueAccountSession\(c\.env, user/);
  assert.match(auth, /auth\.post\("\/logout", requireAuth/);
  assert.match(auth, /UPDATE account_device_sessions[\s\S]{0,220}revoked_at/);
  assert.match(family, /buildFreshSession[\s\S]{0,1500}issueAccountSession/);
  assert.match(activeAccess, /checkAccountDeviceSession/);
  assert.match(middleware, /verifyActiveAccessToken/);
  assert.match(middleware, /device_session_inactive/);
  for (const source of [restShim, push, storage]) {
    assert.match(source, /verifyActiveAccessToken/);
  }
});
