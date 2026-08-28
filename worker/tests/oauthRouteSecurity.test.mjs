import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { dirname, extname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test, { after } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { exportJWK, generateKeyPair } from "jose";
import { Hono } from "hono";

const workerDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const hook = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith(".") && !extname(specifier)) {
      const base = new URL(specifier, context.parentURL);
      for (const extension of [".ts", ".js"]) {
        const candidate = new URL(`${base.href}${extension}`);
        if (existsSync(candidate)) return { url: candidate.href, shortCircuit: true };
      }
    }
    return nextResolve(specifier, context);
  },
});
after(() => hook.deregister());

const oauthRoutes = (await import(pathToFileURL(resolve(workerDir, "routes/oauth.ts")).href)).default;
const naverRoutes = (await import(pathToFileURL(resolve(workerDir, "routes/naver-auth.ts")).href)).default;

class Statement {
  constructor(sqlite, sql, bindings = []) {
    this.sqlite = sqlite;
    this.sql = sql;
    this.bindings = bindings;
  }
  bind(...bindings) { return new Statement(this.sqlite, this.sql, bindings); }
  async first() { return this.sqlite.prepare(this.sql).get(...this.bindings) ?? null; }
  async all() { return { results: this.sqlite.prepare(this.sql).all(...this.bindings) }; }
  async run() {
    const result = this.sqlite.prepare(this.sql).run(...this.bindings);
    return { success: true, meta: { changes: Number(result.changes ?? 0) } };
  }
}

class Db {
  constructor(sqlite) { this.sqlite = sqlite; }
  prepare(sql) { return new Statement(this.sqlite, sql); }
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

function createDb() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`
    CREATE TABLE oauth_state_transactions (
      state_hash TEXT PRIMARY KEY, transaction_secret_hash TEXT NOT NULL,
      provider TEXT NOT NULL, client_kind TEXT NOT NULL, redirect_target TEXT NOT NULL,
      flow_mode TEXT NOT NULL, user_id TEXT, authorization_code_hash TEXT,
      callback_received_at TEXT, consumed_at TEXT,
      recovery_id_hash TEXT, recovery_binding_hash TEXT, recovery_user_id TEXT,
      recovery_account_status TEXT, recovery_access_jti TEXT, recovery_refresh_token_hash TEXT,
      recovery_ready_at TEXT, recovery_expires_at TEXT,
      recovery_acknowledged_at TEXT,
      created_at TEXT NOT NULL, expires_at TEXT NOT NULL
    );
    CREATE TABLE users (
      id TEXT PRIMARY KEY, phone TEXT, email TEXT, encrypted_password TEXT,
      is_anonymous INTEGER NOT NULL DEFAULT 0, raw_user_meta_data TEXT, created_at TEXT
    );
    CREATE TABLE auth_identities (
      id TEXT, user_id TEXT NOT NULL, provider TEXT NOT NULL, provider_id TEXT NOT NULL,
      identity_data TEXT, created_at TEXT, PRIMARY KEY(provider, provider_id)
    );
    CREATE TABLE families (id TEXT PRIMARY KEY, parent_id TEXT NOT NULL, created_at TEXT);
    CREATE TABLE family_members (
      id TEXT PRIMARY KEY, family_id TEXT NOT NULL, user_id TEXT, role TEXT NOT NULL,
      name TEXT, is_active INTEGER NOT NULL DEFAULT 1, created_at TEXT, last_selected_at TEXT
    );
    CREATE TABLE refresh_tokens (
      token TEXT PRIMARY KEY, user_id TEXT NOT NULL, family_id TEXT, device_id TEXT,
      issued_at TEXT, expires_at TEXT, revoked INTEGER NOT NULL DEFAULT 0,
      rotated_to TEXT, rotated_at TEXT
    );
    CREATE TABLE account_device_sessions (
      user_id TEXT PRIMARY KEY, device_id TEXT NOT NULL, device_label TEXT,
      device_platform TEXT, claimed_at TEXT NOT NULL, last_seen_at TEXT NOT NULL,
      expires_at TEXT NOT NULL, revoked_at TEXT
    );
    CREATE TABLE fcm_tokens (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL,
      disabled_at TEXT, disabled_reason TEXT
    );
    CREATE TABLE push_subscriptions (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL,
      disabled_at TEXT, disabled_reason TEXT
    );
    CREATE TABLE account_deletion_scopes (
      job_id TEXT NOT NULL, scope_type TEXT NOT NULL, scope_id TEXT NOT NULL,
      created_at TEXT NOT NULL, PRIMARY KEY(scope_type, scope_id)
    );
    CREATE TABLE account_mutation_leases (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, family_id TEXT,
      expires_at TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE family_unpair_cleanup_jobs (
      id TEXT PRIMARY KEY, family_id TEXT NOT NULL, child_user_id TEXT NOT NULL
    );
  `);
  sqlite.prepare("INSERT INTO users VALUES (?,?,?,?,?,?,?)")
    .run("parent-1", null, "parent@example.com", null, 0, "{}", "2026-07-14 00:00:00+00");
  sqlite.prepare("INSERT INTO auth_identities VALUES (?,?,?,?,?,?)")
    .run("identity-1", "parent-1", "google", "google-parent", "{}", "2026-07-14 00:00:00+00");
  sqlite.prepare("INSERT INTO families VALUES (?,?,?)")
    .run("family-1", "parent-1", "2026-07-14 00:00:00+00");
  sqlite.prepare("INSERT INTO family_members VALUES (?,?,?,?,?,?,?,?)")
    .run("member-1", "family-1", "parent-1", "parent", "부모", 1, "2026-07-14 00:00:00+00", null);
  return new Db(sqlite);
}

const { privateKey, publicKey } = await generateKeyPair("ES256", { extractable: true });
const envBase = {
  GOOGLE_OAUTH_CLIENT_ID: "google-client",
  GOOGLE_OAUTH_CLIENT_SECRET: "google-secret",
  KAKAO_REST_API_KEY: "kakao-key",
  NAVER_CLIENT_ID: "naver-client",
  NAVER_CLIENT_SECRET: "naver-secret",
  JWT_PRIVATE_KEY: JSON.stringify(await exportJWK(privateKey)),
  JWT_PUBLIC_KEY: JSON.stringify(await exportJWK(publicKey)),
};

function appRequest(db, path, init = {}) {
  const app = new Hono();
  app.route("/api/auth", oauthRoutes);
  app.route("/api/auth", naverRoutes);
  return app.request(`https://api.example.test${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init.headers ?? {}) },
  }, { ...envBase, DB: db });
}

async function start(db, provider = "google", body = { client: "web", webOrigin: "https://hyeni-calendar.pages.dev" }) {
  const response = await appRequest(db, `/api/auth/oauth/${provider}/start`, {
    method: "POST",
    body: JSON.stringify(body),
  });
  return { response, body: await response.json() };
}

test("legacy GET과 외부 target은 fail-closed이고 서버가 승인 URL·state·별도 secret을 발급한다", async () => {
  const db = createDb();
  const legacy = await appRequest(db, "/api/auth/oauth/google/start?state=attacker");
  assert.equal(legacy.status, 410);

  const evil = await start(db, "google", { client: "web", webOrigin: "https://evil.example" });
  assert.equal(evil.response.status, 400);

  const valid = await start(db);
  assert.equal(valid.response.status, 200);
  assert.equal(new URL(valid.body.authorizationUrl).origin, "https://accounts.google.com");
  assert.equal(valid.body.state.length >= 40, true);
  assert.equal(valid.body.transactionSecret.length >= 40, true);
  assert.notEqual(valid.body.state, valid.body.transactionSecret);

  const naver = await start(db, "naver", { client: "native" });
  assert.equal(naver.response.status, 200);
  assert.equal(new URL(naver.body.authorizationUrl).origin, "https://nid.naver.com");
});

test("unknown·legacy state callback은 code를 어떤 target에도 전달하지 않는다", async () => {
  const db = createDb();
  const legacyState = Buffer.from(JSON.stringify({ target: "https://evil.example", nonce: "x" })).toString("base64");
  const response = await appRequest(
    db,
    `/api/auth/oauth/google/callback?code=stolen-code&state=${encodeURIComponent(legacyState)}`,
  );
  assert.equal(response.status, 400);
  const html = await response.text();
  assert.equal(html.includes("stolen-code"), false);
  assert.equal(html.includes("evil.example"), false);
  assert.equal(response.headers.get("referrer-policy"), "no-referrer");
});

test("콜백은 code를 고정 target에 결합하고 secret 없는 교환은 provider 호출 전에 거부한다", async () => {
  const db = createDb();
  const prepared = await start(db);
  const callback = await appRequest(
    db,
    `/api/auth/oauth/google/callback?code=code-one&state=${encodeURIComponent(prepared.body.state)}`,
  );
  assert.equal(callback.status, 200);
  const html = await callback.text();
  assert.equal(html.includes("https://hyeni-calendar.pages.dev?"), true);
  assert.equal(html.includes("evil.example"), false);

  let fetchCalls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    throw new Error("provider fetch must not run");
  };
  try {
    const missing = await appRequest(db, "/api/auth/oauth/google", {
      method: "POST",
      body: JSON.stringify({ code: "code-one", state: prepared.body.state }),
    });
    assert.equal(missing.status, 400);
    assert.equal(fetchCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("동일 transaction 병렬 교환은 정확히 하나만 provider fetch·세션 발급한다", async () => {
  const db = createDb();
  const prepared = await start(db);
  const callback = await appRequest(
    db,
    `/api/auth/oauth/google/callback?code=parallel-code&state=${encodeURIComponent(prepared.body.state)}`,
  );
  assert.equal(callback.status, 200);

  let tokenFetches = 0;
  let profileFetches = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (request) => {
    const url = String(request);
    if (url.includes("oauth2.googleapis.com/token")) {
      tokenFetches += 1;
      await new Promise((resolve) => setTimeout(resolve, 10));
      return Response.json({ access_token: "provider-token" });
    }
    if (url.includes("openidconnect.googleapis.com/v1/userinfo")) {
      profileFetches += 1;
      return Response.json({
        sub: "google-parent", email: "parent@example.com", email_verified: true, name: "부모",
      });
    }
    throw new Error(`unexpected fetch: ${url}`);
  };
  try {
    const request = () => appRequest(db, "/api/auth/oauth/google", {
      method: "POST",
      body: JSON.stringify({
        code: "parallel-code",
        state: prepared.body.state,
        transactionSecret: prepared.body.transactionSecret,
        device_install_id: "device-oauth-security",
        device_label: "테스트 기기",
        device_platform: "web",
      }),
    });
    const [first, second] = await Promise.all([request(), request()]);
    assert.deepEqual([first.status, second.status].sort((a, b) => a - b), [200, 400]);
    assert.equal(tokenFetches, 1);
    assert.equal(profileFetches, 1);
    const success = first.status === 200 ? first : second;
    const json = await success.json();
    assert.equal(typeof json.session?.access_token, "string");
    assert.equal(json.account_status, "existing");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("네이티브 OAuth 응답 유실은 동일 recovery ID+device에서 ACK 전까지 재발급되고 ACK 뒤 닫힌다", async () => {
  const db = createDb();
  const prepared = await start(db, "google", { client: "native" });
  const callback = await appRequest(
    db,
    `/api/auth/oauth/google/callback?code=recovery-route-code&state=${encodeURIComponent(prepared.body.state)}`,
  );
  assert.equal(callback.status, 200);

  const recoveryId = "Q".repeat(43);
  const deviceId = "device-oauth-recovery";
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (request) => {
    const url = String(request);
    if (url.includes("oauth2.googleapis.com/token")) {
      return Response.json({ access_token: "recovery-provider-token" });
    }
    if (url.includes("openidconnect.googleapis.com/v1/userinfo")) {
      return Response.json({
        sub: "google-parent", email: "parent@example.com", email_verified: true, name: "부모",
      });
    }
    throw new Error(`unexpected fetch: ${url}`);
  };

  try {
    const exchanged = await appRequest(db, "/api/auth/oauth/google", {
      method: "POST",
      body: JSON.stringify({
        code: "recovery-route-code",
        state: prepared.body.state,
        transactionSecret: prepared.body.transactionSecret,
        recoveryId,
        device_install_id: deviceId,
        device_platform: "android",
      }),
    });
    assert.equal(exchanged.status, 200);
    const initial = await exchanged.json(); // 응답을 채택하지 못하고 process가 종료된 상황.

    const recover = (presentedDeviceId = deviceId) => appRequest(
      db,
      "/api/auth/oauth/google/recovery",
      {
        method: "POST",
        body: JSON.stringify({
          recoveryId,
          device_install_id: presentedDeviceId,
          device_platform: "android",
        }),
      },
    );
    const firstRecovery = await recover();
    assert.equal(firstRecovery.status, 200);
    const first = await firstRecovery.json();
    assert.equal(first.account_status, "existing");
    assert.equal(first.user?.id, "parent-1");
    assert.equal(first.session.refresh_token, initial.session.refresh_token,
      "복구는 최초 발급된 canonical refresh를 반환해야 합니다");

    const secondRecovery = await recover();
    assert.equal(secondRecovery.status, 200, "ACK 전 재응답 유실은 bounded 재발급 가능해야 합니다");
    const second = await secondRecovery.json();
    assert.equal(second.user?.id, "parent-1");
    assert.equal(second.session.refresh_token, first.session.refresh_token,
      "같은 recovery grant는 canonical refresh를 재사용해 서로 revoke하면 안 됩니다");
    const accessJti = (token) => JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8")).jti;
    assert.equal(accessJti(second.session.access_token), accessJti(first.session.access_token));
    assert.equal((await recover("other-device")).status, 404);

    db.sqlite.prepare(`INSERT INTO refresh_tokens
      (token,user_id,family_id,device_id,issued_at,expires_at,revoked)
      VALUES ('ambiguous-live-refresh','parent-1','family-1',?,datetime('now'),datetime('now','+1 day'),0)`)
      .run(deviceId);
    assert.equal((await recover()).status, 404,
      "같은 user/device에 live refresh 후보가 여러 개면 임의 선택하지 않아야 합니다");
    db.sqlite.prepare("DELETE FROM refresh_tokens WHERE token='ambiguous-live-refresh'").run();

    const ack = await appRequest(db, "/api/auth/oauth/google/recovery/ack", {
      method: "POST",
      headers: { Authorization: `Bearer ${second.session.access_token}` },
      body: JSON.stringify({ recoveryId }),
    });
    assert.equal(ack.status, 204);
    assert.equal((await recover()).status, 404, "completion ACK 뒤 recovery replay를 닫아야 합니다");

    const stored = db.sqlite.prepare(`SELECT recovery_id_hash,recovery_binding_hash
      FROM oauth_state_transactions WHERE provider='google'`).get();
    assert.notEqual(stored.recovery_id_hash, recoveryId);
    assert.equal(JSON.stringify(stored).includes(deviceId), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("ACK 전 recovery grant는 이후 명시적 다른 설치 로그인 세션을 되빼앗지 못한다", async () => {
  const db = createDb();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (request) => {
    const url = String(request);
    if (url.includes("oauth2.googleapis.com/token")) {
      return Response.json({ access_token: "provider-token-for-takeover" });
    }
    if (url.includes("openidconnect.googleapis.com/v1/userinfo")) {
      return Response.json({
        sub: "google-parent", email: "parent@example.com", email_verified: true, name: "부모",
      });
    }
    throw new Error(`unexpected fetch: ${url}`);
  };
  try {
    const first = await start(db, "google", { client: "native" });
    await appRequest(
      db,
      `/api/auth/oauth/google/callback?code=stale-grant-code&state=${encodeURIComponent(first.body.state)}`,
    );
    const recoveryId = "S".repeat(43);
    const oldDeviceId = "oauth-old-install";
    const issued = await appRequest(db, "/api/auth/oauth/google", {
      method: "POST",
      body: JSON.stringify({
        code: "stale-grant-code",
        state: first.body.state,
        transactionSecret: first.body.transactionSecret,
        recoveryId,
        device_install_id: oldDeviceId,
        device_platform: "android",
      }),
    });
    assert.equal(issued.status, 200);

    const second = await start(db, "google", { client: "native" });
    await appRequest(
      db,
      `/api/auth/oauth/google/callback?code=explicit-takeover-code&state=${encodeURIComponent(second.body.state)}`,
    );
    const newDeviceId = "oauth-new-install";
    const takeover = await appRequest(db, "/api/auth/oauth/google", {
      method: "POST",
      body: JSON.stringify({
        code: "explicit-takeover-code",
        state: second.body.state,
        transactionSecret: second.body.transactionSecret,
        device_install_id: newDeviceId,
        device_platform: "android",
      }),
    });
    assert.equal(takeover.status, 200);

    const stale = await appRequest(db, "/api/auth/oauth/google/recovery", {
      method: "POST",
      body: JSON.stringify({
        recoveryId,
        device_install_id: oldDeviceId,
        device_platform: "android",
      }),
    });
    assert.equal(stale.status, 404);
    const active = db.sqlite.prepare(
      "SELECT device_id FROM account_device_sessions WHERE user_id='parent-1'",
    ).get();
    assert.equal(active.device_id, newDeviceId);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("recovery access는 같은 설치의 후속 명시 로그인 뒤 모든 인증 route에서 즉시 무효다", async () => {
  const db = createDb();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (request) => {
    const url = String(request);
    if (url.includes("oauth2.googleapis.com/token")) {
      return Response.json({ access_token: "same-device-provider-token" });
    }
    if (url.includes("openidconnect.googleapis.com/v1/userinfo")) {
      return Response.json({
        sub: "google-parent", email: "parent@example.com", email_verified: true, name: "부모",
      });
    }
    throw new Error(`unexpected fetch: ${url}`);
  };
  try {
    const deviceId = "same-device-recovery-race";
    const first = await start(db, "google", { client: "native" });
    await appRequest(
      db,
      `/api/auth/oauth/google/callback?code=same-device-old-code&state=${encodeURIComponent(first.body.state)}`,
    );
    const recoveryId = "U".repeat(43);
    const issued = await appRequest(db, "/api/auth/oauth/google", {
      method: "POST",
      body: JSON.stringify({
        code: "same-device-old-code",
        state: first.body.state,
        transactionSecret: first.body.transactionSecret,
        recoveryId,
        device_install_id: deviceId,
        device_platform: "android",
      }),
    });
    assert.equal(issued.status, 200);
    const oldSession = (await issued.json()).session;
    const oldClaims = JSON.parse(
      Buffer.from(oldSession.access_token.split(".")[1], "base64url").toString("utf8"),
    );
    assert.match(oldClaims.oauth_recovery_refresh_hash, /^[A-Za-z0-9_-]{43}$/,
      "recovery access는 canonical refresh generation fence를 포함해야 합니다");

    const second = await start(db, "google", { client: "native" });
    await appRequest(
      db,
      `/api/auth/oauth/google/callback?code=same-device-new-code&state=${encodeURIComponent(second.body.state)}`,
    );
    const takeover = await appRequest(db, "/api/auth/oauth/google", {
      method: "POST",
      body: JSON.stringify({
        code: "same-device-new-code",
        state: second.body.state,
        transactionSecret: second.body.transactionSecret,
        device_install_id: deviceId,
        device_platform: "android",
      }),
    });
    assert.equal(takeover.status, 200);
    const currentSession = (await takeover.json()).session;

    const staleAccess = await appRequest(db, "/api/auth/oauth/links", {
      headers: { Authorization: `Bearer ${oldSession.access_token}` },
    });
    assert.equal(staleAccess.status, 401,
      "같은 device_id만 맞는 과거 recovery access가 1시간 살아 있으면 안 됩니다");
    assert.deepEqual(await staleAccess.json(), { error: "device_session_inactive" });
    const currentAccess = await appRequest(db, "/api/auth/oauth/links", {
      headers: { Authorization: `Bearer ${currentSession.access_token}` },
    });
    assert.equal(currentAccess.status, 200);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("OAuth 신규 가입만 allowlist 설문을 저장하고 account_status를 반환한다", async () => {
  const db = createDb();
  const prepared = await start(db);
  const callback = await appRequest(
    db,
    `/api/auth/oauth/google/callback?code=survey-code&state=${encodeURIComponent(prepared.body.state)}`,
  );
  assert.equal(callback.status, 200);

  let fetchCalls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (request) => {
    fetchCalls += 1;
    const url = String(request);
    if (url.includes("oauth2.googleapis.com/token")) {
      return Response.json({ access_token: "survey-provider-token" });
    }
    if (url.includes("openidconnect.googleapis.com/v1/userinfo")) {
      return Response.json({
        sub: "google-survey-new",
        email: "survey-new@example.com",
        email_verified: true,
        name: "새 보호자",
      });
    }
    throw new Error(`unexpected fetch: ${url}`);
  };
  const exchange = (onboardingInterests) => appRequest(db, "/api/auth/oauth/google", {
    method: "POST",
    body: JSON.stringify({
      code: "survey-code",
      state: prepared.body.state,
      transactionSecret: prepared.body.transactionSecret,
      device_install_id: "device-oauth-survey",
      device_platform: "web",
      onboardingInterests,
    }),
  });

  try {
    const invalid = await exchange(["location", "free-text"]);
    assert.equal(invalid.status, 400);
    assert.deepEqual(await invalid.json(), { error: "invalid_onboarding_interests" });
    assert.equal(fetchCalls, 0, "잘못된 설문이 OAuth 단회 code를 소비하면 안 됩니다");

    const valid = await exchange(["location", "schedule", "location"]);
    assert.equal(valid.status, 200);
    const payload = await valid.json();
    assert.equal(payload.account_status, "created");
    const row = db.sqlite.prepare("SELECT raw_user_meta_data FROM users WHERE id=?").get(payload.user_id);
    const metadata = JSON.parse(row.raw_user_meta_data);
    assert.deepEqual(metadata.onboarding_interests, ["location", "schedule"]);
    assert.equal(typeof metadata.onboarding_completed_at, "string");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("카카오·구글·네이버 OAuth가 신규/기존/연결 계정 상태 계약을 함께 사용한다", () => {
  const oauthSource = readFileSync(resolve(workerDir, "routes/oauth.ts"), "utf8");
  const naverSource = readFileSync(resolve(workerDir, "routes/naver-auth.ts"), "utf8");
  for (const source of [oauthSource, naverSource]) {
    assert.match(source, /accountStatus: "existing" \| "linked" \| "created"/);
    assert.match(source, /account_status: accountStatus/);
    assert.match(source, /attachOnboardingPreferences/);
  }
});

test("라우트에는 client state target 복호화와 raw code 로그가 없다", () => {
  const oauthSource = readFileSync(resolve(workerDir, "routes/oauth.ts"), "utf8");
  const naverSource = readFileSync(resolve(workerDir, "routes/naver-auth.ts"), "utf8");
  for (const source of [oauthSource, naverSource]) {
    assert.doesNotMatch(source, /decoded\?\.target|atob\s*\(|decodeURIComponent\(state\)/);
    assert.match(source, /consumeOAuthTransaction/);
    assert.match(source, /markOAuthCallback/);
  }
});
