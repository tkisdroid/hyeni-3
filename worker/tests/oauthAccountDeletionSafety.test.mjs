import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { dirname, extname, resolve } from "node:path";
import test, { after } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath, pathToFileURL } from "node:url";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { Hono } from "hono";

const workerDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoDir = resolve(workerDir, "..");
const hook = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith(".") && !extname(specifier)) {
      const base = new URL(specifier, context.parentURL);
      for (const extension of [".ts", ".js"]) {
        const candidate = new URL(`${base.href}${extension}`);
        if (existsSync(fileURLToPath(candidate))) {
          return { url: candidate.href, shortCircuit: true };
        }
      }
    }
    return nextResolve(specifier, context);
  },
});
after(() => hook.deregister());

const oauthRoutes = (await import(pathToFileURL(resolve(workerDir, "routes/oauth.ts")).href)).default;
const naverRoutes = (await import(pathToFileURL(resolve(workerDir, "routes/naver-auth.ts")).href)).default;
const oauthBridgeRoutes = (
  await import(pathToFileURL(resolve(workerDir, "routes/oauth-bridge.ts")).href)
).default;
const { hashOtp } = await import(pathToFileURL(resolve(workerDir, "lib/otp.ts")).href);

class Statement {
  constructor(owner, sql, bindings = []) {
    this.owner = owner;
    this.sql = sql;
    this.bindings = bindings;
  }

  bind(...bindings) {
    return new Statement(this.owner, this.sql, bindings);
  }

  async first() {
    return this.owner.sqlite.prepare(this.sql).get(...this.bindings) ?? null;
  }

  async all() {
    return { results: this.owner.sqlite.prepare(this.sql).all(...this.bindings) };
  }

  async run() {
    await this.owner.beforeRun(this);
    const result = this.owner.sqlite.prepare(this.sql).run(...this.bindings);
    return { success: true, meta: { changes: Number(result.changes ?? 0) } };
  }
}

class Db {
  constructor(sqlite) {
    this.sqlite = sqlite;
  }

  prepare(sql) {
    return new Statement(this, sql);
  }

  async beforeRun() {}

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

class PausingWriteDb extends Db {
  constructor(sqlite, sqlFragment) {
    super(sqlite);
    this.sqlFragment = sqlFragment;
    this.writeStarted = new Promise((resolveStarted) => {
      this.resolveStarted = resolveStarted;
    });
    this.resumePromise = new Promise((resolveResume) => {
      this.resolveResume = resolveResume;
    });
    this.paused = false;
  }

  async beforeRun(statement) {
    if (this.paused || !statement.sql.includes(this.sqlFragment)) return;
    this.paused = true;
    this.resolveStarted();
    await this.resumePromise;
  }

  resume() {
    this.resolveResume();
  }
}

function createSqlite() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(readFileSync(resolve(repoDir, "cloudflare/schema_d1.sql"), "utf8"));
  return sqlite;
}

function addUser(sqlite, { id, email = null, phone = null }) {
  sqlite.prepare(
    "INSERT INTO users(id,email,phone,is_anonymous,raw_user_meta_data) VALUES (?,?,?,0,'{}')",
  ).run(id, email, phone);
}

function beginDeletion(sqlite, userId) {
  const jobId = `delete-${userId}`;
  sqlite.prepare(
    `INSERT INTO account_deletion_jobs
      (id,owner_user_id,mode,status,attempts,created_at,updated_at)
     VALUES (?,?,'self','claimed',0,'2026-07-14','2026-07-14')`,
  ).run(jobId, userId);
  sqlite.prepare(
    `INSERT INTO account_deletion_scopes(job_id,scope_type,scope_id,created_at)
     VALUES (?,'user',?,'2026-07-14')`,
  ).run(jobId, userId);
}

const { privateKey, publicKey } = await generateKeyPair("ES256", { extractable: true });
const jwtPrivateKey = JSON.stringify(await exportJWK(privateKey));
const jwtPublicKey = JSON.stringify(await exportJWK(publicKey));
const envBase = {
  GOOGLE_OAUTH_CLIENT_ID: "google-client",
  GOOGLE_OAUTH_CLIENT_SECRET: "google-secret",
  KAKAO_REST_API_KEY: "kakao-key",
  NAVER_CLIENT_ID: "naver-client",
  NAVER_CLIENT_SECRET: "naver-secret",
  JWT_PRIVATE_KEY: jwtPrivateKey,
  JWT_PUBLIC_KEY: jwtPublicKey,
  PUSH_INTERNAL_SECRET: "test-otp-secret",
};

function createApp() {
  const app = new Hono();
  app.route("/api/auth", oauthRoutes);
  app.route("/api/auth", naverRoutes);
  app.route("/api/auth", oauthBridgeRoutes);
  return app;
}

function request(app, db, path, init = {}) {
  return app.request(
    `https://api.example.test${path}`,
    {
      ...init,
      headers: { "Content-Type": "application/json", ...(init.headers ?? {}) },
    },
    { ...envBase, DB: db },
  );
}

async function prepareOAuth(app, db, provider) {
  const startResponse = await request(app, db, `/api/auth/oauth/${provider}/start`, {
    method: "POST",
    body: JSON.stringify({ client: "web", webOrigin: "https://hyeni-calendar.pages.dev" }),
  });
  assert.equal(startResponse.status, 200, await startResponse.clone().text());
  const prepared = await startResponse.json();
  const callbackPath = provider === "naver"
    ? `/api/auth/naver?code=provider-code&state=${encodeURIComponent(prepared.state)}`
    : `/api/auth/oauth/${provider}/callback?code=provider-code&state=${encodeURIComponent(prepared.state)}`;
  const callback = await request(app, db, callbackPath);
  assert.equal(callback.status, 200, await callback.clone().text());
  return prepared;
}

async function runExistingAccountOAuthDeletionRace(provider) {
  const sqlite = createSqlite();
  addUser(sqlite, { id: "existing-parent", email: "parent@example.com" });
  const db = new PausingWriteDb(sqlite, "INSERT INTO auth_identities");
  const app = createApp();
  const prepared = await prepareOAuth(app, db, provider);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (provider === "naver") {
      if (url.includes("nid.naver.com/oauth2.0/token")) {
        return Response.json({ access_token: "naver-token" });
      }
      if (url.includes("openapi.naver.com/v1/nid/me")) {
        return Response.json({
          resultcode: "00",
          response: { id: "naver-new", email: "parent@example.com", name: "부모" },
        });
      }
    } else {
      if (url.includes("oauth2.googleapis.com/token")) {
        return Response.json({ access_token: "google-token" });
      }
      if (url.includes("openidconnect.googleapis.com/v1/userinfo")) {
        return Response.json({
          sub: "google-new",
          email: "parent@example.com",
          email_verified: true,
          name: "부모",
        });
      }
    }
    throw new Error(`unexpected fetch: ${url}`);
  };

  try {
    const path = provider === "naver" ? "/api/auth/naver" : `/api/auth/oauth/${provider}`;
    const login = request(app, db, path, {
      method: "POST",
      body: JSON.stringify({
        code: "provider-code",
        state: prepared.state,
        transactionSecret: prepared.transactionSecret,
        device_install_id: "device-oauth-race",
        device_label: "테스트 기기",
        device_platform: "web",
      }),
    });
    await db.writeStarted;
    beginDeletion(sqlite, "existing-parent");
    db.resume();
    const response = await login;
    return { response, sqlite };
  } finally {
    globalThis.fetch = originalFetch;
  }
}

test("Google 기존 계정 연결 직전 삭제가 시작되면 identity와 session을 만들지 않는다", async () => {
  const { response, sqlite } = await runExistingAccountOAuthDeletionRace("google");

  assert.equal(response.status, 409, await response.clone().text());
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM auth_identities").get().count, 0);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM refresh_tokens").get().count, 0);
});

test("Naver 기존 계정 연결 직전 삭제가 시작되면 identity와 session을 만들지 않는다", async () => {
  const { response, sqlite } = await runExistingAccountOAuthDeletionRace("naver");

  assert.equal(response.status, 409, await response.clone().text());
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM auth_identities").get().count, 0);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM refresh_tokens").get().count, 0);
});

test("OAuth bridge OTP caller와 다른 전화 계정 삭제 중에는 target session을 발급하지 않는다", async () => {
  const sqlite = createSqlite();
  addUser(sqlite, { id: "oauth-caller", email: "oauth@example.com" });
  addUser(sqlite, { id: "phone-target", phone: "821012345678" });
  const phone = "+821012345678";
  sqlite.prepare(
    `INSERT INTO user_profiles(user_id,phone,provider,linked_providers)
     VALUES ('phone-target',?,'phone','{}')`,
  ).run(phone);
  const otp = "123456";
  const otpHash = await hashOtp(phone, otp, envBase.PUSH_INTERNAL_SECRET);
  sqlite.prepare(
    `INSERT INTO phone_otp(phone,code_hash,expires_at,attempts,created_at)
     VALUES (?,?,?,0,?)`,
  ).run(
    phone,
    otpHash,
    new Date(Date.now() + 300_000).toISOString(),
    new Date().toISOString(),
  );
  const db = new PausingWriteDb(sqlite, "INSERT INTO refresh_tokens");
  const app = createApp();
  const callerToken = await new SignJWT({
    role: "parent",
    family_id: null,
    is_anonymous: false,
  })
    .setProtectedHeader({ alg: "ES256" })
    .setSubject("oauth-caller")
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(privateKey);

  const verification = request(app, db, "/api/auth/oauth-bridge/verify-otp", {
    method: "POST",
    headers: { Authorization: `Bearer ${callerToken}` },
    body: JSON.stringify({
      phone,
      token: otp,
      device_install_id: "device-bridge-race",
      device_label: "테스트 기기",
      device_platform: "web",
    }),
  });
  await db.writeStarted;
  beginDeletion(sqlite, "phone-target");
  db.resume();
  const response = await verification;

  assert.equal(response.status, 409, await response.clone().text());
  assert.equal(
    sqlite.prepare("SELECT COUNT(*) AS count FROM refresh_tokens WHERE user_id='phone-target'").get().count,
    0,
  );
});
