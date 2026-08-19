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
      callback_received_at TEXT, consumed_at TEXT, created_at TEXT NOT NULL, expires_at TEXT NOT NULL
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
    CREATE TABLE account_deletion_scopes (
      job_id TEXT NOT NULL, scope_type TEXT NOT NULL, scope_id TEXT NOT NULL,
      created_at TEXT NOT NULL, PRIMARY KEY(scope_type, scope_id)
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
  } finally {
    globalThis.fetch = originalFetch;
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
