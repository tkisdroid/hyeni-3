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
const typeScriptResolutionHook = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith(".") && !extname(specifier)) {
      const base = new URL(specifier, context.parentURL);
      for (const extension of [".ts", ".js"]) {
        const candidate = new URL(`${base.href}${extension}`);
        if (existsSync(fileURLToPath(candidate))) return { url: candidate.href, shortCircuit: true };
      }
    }
    return nextResolve(specifier, context);
  },
});
after(() => typeScriptResolutionHook.deregister());

const authRoutes = (await import(pathToFileURL(resolve(workerDir, "routes/auth.ts")).href)).default;
const familyRoutes = (await import(pathToFileURL(resolve(workerDir, "routes/family.ts")).href)).default;
const { hashOtp } = await import(pathToFileURL(resolve(workerDir, "lib/otp.ts")).href);
const { hashPassword } = await import(pathToFileURL(resolve(workerDir, "lib/bcrypt.ts")).href);
const { privateKey, publicKey } = await generateKeyPair("ES256", { extractable: true });
const jwtPrivateKey = JSON.stringify(await exportJWK(privateKey));
const jwtPublicKey = JSON.stringify(await exportJWK(publicKey));
const otpSecret = "password-reset-contract-secret";

class Statement {
  constructor(sqlite, sql, bindings = [], failRegistrationUpdate = false) {
    this.sqlite = sqlite;
    this.sql = sql;
    this.bindings = bindings;
    this.failRegistrationUpdate = failRegistrationUpdate;
  }
  bind(...bindings) { return new Statement(this.sqlite, this.sql, bindings, this.failRegistrationUpdate); }
  async first() { return this.sqlite.prepare(this.sql).get(...this.bindings) ?? null; }
  async all() { return { success: true, results: this.sqlite.prepare(this.sql).all(...this.bindings) }; }
  async run() {
    if (this.failRegistrationUpdate) throw new Error("registration_country_post_commit_write");
    const result = this.sqlite.prepare(this.sql).run(...this.bindings);
    return { success: true, meta: { changes: Number(result.changes) } };
  }
}

class Db {
  constructor(sqlite, { failRegistrationUpdate = false } = {}) {
    this.sqlite = sqlite;
    this.failRegistrationUpdate = failRegistrationUpdate;
  }
  prepare(sql) {
    return new Statement(this.sqlite, sql, [], this.failRegistrationUpdate && sql.includes("SET registration_country"));
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

function setup(options) {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(readFileSync(resolve(repoDir, "cloudflare/schema_d1.sql"), "utf8"));
  const db = new Db(sqlite, options);
  const app = new Hono();
  app.route("/auth", authRoutes);
  app.route("/api/family", familyRoutes);
  const env = {
    DB: db,
    JWT_PRIVATE_KEY: jwtPrivateKey,
    JWT_PUBLIC_KEY: jwtPublicKey,
    PUSH_INTERNAL_SECRET: otpSecret,
    FAMILY_ROOM: {
      idFromName: (name) => name,
      get: () => ({ fetch: async () => new Response(null, { status: 204 }) }),
    },
  };
  return { app, db, env, sqlite };
}

async function authorization(sub, role = "anonymous", isAnonymous = true) {
  const token = await new SignJWT({ role, family_id: null, is_anonymous: isAnonymous })
    .setProtectedHeader({ alg: "ES256" })
    .setSubject(sub)
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(privateKey);
  return `Bearer ${token}`;
}

async function post(app, env, path, body, authorizationHeader, edgeCountry) {
  const request = new Request(`http://test.local${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(authorizationHeader ? { authorization: authorizationHeader } : {}),
    },
    body: JSON.stringify(body),
  });
  if (edgeCountry) Object.defineProperty(request, "cf", { value: { country: edgeCountry } });
  return app.fetch(request, env);
}


// 2026-09-26 실기기 E2E: 비밀번호를 잊으면 복구 수단이 없었다. 휴대폰 인증으로 아이디를 확인하고 비밀번호를 바꾼다.
function seedPasswordAccount(sqlite, { phoneNoPlus = "821039838128", loginId = "resetowner", withPassword = true } = {}) {
  sqlite.prepare("INSERT INTO users(id,phone,is_anonymous,encrypted_password,created_at) VALUES ('reset-owner',?,0,?,'2026-08-01')")
    .run(phoneNoPlus, withPassword ? "$2a$10$abcdefghijklmnopqrstuuM0nyM3l2J1pF7m2Y1vB8h0xYy6zQw2" : null);
  sqlite.prepare("INSERT INTO user_profiles(user_id,display_name,login_id,phone,created_at,updated_at) VALUES ('reset-owner','보호자',?,?,'2026-08-01','2026-08-01')")
    .run(loginId, `+${phoneNoPlus}`);
  sqlite.prepare("INSERT INTO refresh_tokens(token,user_id,issued_at) VALUES ('old-refresh','reset-owner','2026-08-01')").run();
}

async function seedOtp(sqlite, phoneE164, code) {
  const codeHash = await hashOtp(phoneE164, code, otpSecret);
  sqlite.prepare("INSERT INTO phone_otp(phone,code_hash,expires_at,attempts,created_at) VALUES (?,?,?,0,?)")
    .run(phoneE164, codeHash, "2999-01-01 00:00:00", "2026-09-26 00:00:00");
}

test("비밀번호 재설정 요청은 등록되지 않은 번호·소셜 전용 계정을 SMS 없이 거부한다", async () => {
  const { app, env, sqlite } = setup();
  const notRegistered = await post(app, env, "/auth/password-reset/request-otp", { phone: "01011112222" });
  assert.equal(notRegistered.status, 404);
  assert.deepEqual(await notRegistered.json(), { error: "phone_not_registered" });

  seedPasswordAccount(sqlite, { withPassword: false });
  const socialOnly = await post(app, env, "/auth/password-reset/request-otp", { phone: "010-3983-8128" });
  assert.equal(socialOnly.status, 409);
  assert.deepEqual(await socialOnly.json(), { error: "password_account_required" });

  const invalid = await post(app, env, "/auth/password-reset/request-otp", { phone: "abc" });
  assert.equal(invalid.status, 400);
});

test("휴대폰 인증이 맞으면 비밀번호를 바꾸고 아이디를 돌려주며 기존 세션과 OTP 를 정리한다", async () => {
  const { app, env, sqlite } = setup();
  seedPasswordAccount(sqlite);
  await seedOtp(sqlite, "+821039838128", "123456");

  const wrong = await post(app, env, "/auth/password-reset/verify", { phone: "01039838128", token: "000000", password: "newpass1" });
  assert.equal(wrong.status, 401);
  assert.deepEqual(await wrong.json(), { error: "otp_mismatch" });

  const weak = await post(app, env, "/auth/password-reset/verify", { phone: "01039838128", token: "123456", password: "123" });
  assert.equal(weak.status, 400);

  const ok = await post(app, env, "/auth/password-reset/verify", { phone: "010-3983-8128", token: "123456", password: "newpass1" });
  assert.equal(ok.status, 200);
  assert.deepEqual(await ok.json(), { ok: true, loginId: "resetowner" });

  const user = sqlite.prepare("SELECT encrypted_password AS pw FROM users WHERE id='reset-owner'").get();
  const { comparePassword } = await import(pathToFileURL(resolve(workerDir, "lib/bcrypt.ts")).href);
  assert.equal(await comparePassword("newpass1", user.pw), true);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM refresh_tokens WHERE user_id='reset-owner'").get().n, 0);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM phone_otp").get().n, 0);

  // 같은 코드를 다시 쓰면 이미 소비돼 거부된다(재사용·동시 요청 방지).
  const replay = await post(app, env, "/auth/password-reset/verify", { phone: "01039838128", token: "123456", password: "another1" });
  assert.equal(replay.status, 401);
  assert.equal(await comparePassword("newpass1", sqlite.prepare("SELECT encrypted_password AS pw FROM users WHERE id='reset-owner'").get().pw), true);
});

test("재설정 뒤 새 비밀번호로 로그인할 수 있다", async () => {
  const { app, env, sqlite } = setup();
  seedPasswordAccount(sqlite);
  await seedOtp(sqlite, "+821039838128", "654321");
  const ok = await post(app, env, "/auth/password-reset/verify", { phone: "01039838128", token: "654321", password: "freshpw9" });
  assert.equal(ok.status, 200);
  const login = await post(app, env, "/auth/login-password", { loginId: "resetowner", password: "freshpw9", device_install_id: "reset-owner-device-1" });
  const body = await login.json();
  assert.equal(login.status, 200, JSON.stringify(body));
  assert.ok(body.session?.access_token, "새 비밀번호로 로그인되어야 한다");
  const oldLogin = await post(app, env, "/auth/login-password", { loginId: "resetowner", password: "wrong-old", device_install_id: "reset-owner-device-1" });
  assert.equal(oldLogin.status, 401);
});
