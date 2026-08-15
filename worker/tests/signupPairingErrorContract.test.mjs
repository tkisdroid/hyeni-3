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
const { privateKey, publicKey } = await generateKeyPair("ES256", { extractable: true });
const jwtPrivateKey = JSON.stringify(await exportJWK(privateKey));
const jwtPublicKey = JSON.stringify(await exportJWK(publicKey));
const otpSecret = "signup-pairing-error-contract-secret";

class Statement {
  constructor(sqlite, sql, bindings = []) {
    this.sqlite = sqlite;
    this.sql = sql;
    this.bindings = bindings;
  }
  bind(...bindings) { return new Statement(this.sqlite, this.sql, bindings); }
  async first() { return this.sqlite.prepare(this.sql).get(...this.bindings) ?? null; }
  async all() { return { success: true, results: this.sqlite.prepare(this.sql).all(...this.bindings) }; }
  async run() {
    const result = this.sqlite.prepare(this.sql).run(...this.bindings);
    return { success: true, meta: { changes: Number(result.changes) } };
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

function setup() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(readFileSync(resolve(repoDir, "cloudflare/schema_d1.sql"), "utf8"));
  const db = new Db(sqlite);
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

async function post(app, env, path, body, authorizationHeader) {
  return app.request(`http://test.local${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(authorizationHeader ? { authorization: authorizationHeader } : {}),
    },
    body: JSON.stringify(body),
  }, env);
}

test("child·공동 보호자 pairing 실패는 stable snake_case payload를 반환한다", async () => {
  const { app, env, sqlite } = setup();
  sqlite.prepare("INSERT INTO users(id,is_anonymous) VALUES ('primary-parent',0)").run();
  for (const userId of ["child-empty", "child-invalid", "child-expired", "parent-empty", "parent-invalid", "parent-expired"]) {
    sqlite.prepare("INSERT INTO users(id,is_anonymous) VALUES (?,?)").run(userId, userId.startsWith("child-") ? 1 : 0);
  }
  sqlite.prepare(
    "INSERT INTO families(id,parent_id,pair_code,pair_code_expires_at,created_at) VALUES ('expired-family','primary-parent','KID-EXPIRED','2020-01-01 00:00:00','2020-01-01')",
  ).run();

  const cases = [
    ["/api/family/join", {}, "invalid_pair_code", "child-empty"],
    ["/api/family/join", { pairCode: "KID-NOTFOUND" }, "invalid_pair_code", "child-invalid"],
    ["/api/family/join", { pairCode: "KID-EXPIRED" }, "pair_code_expired", "child-expired"],
    ["/api/family/join-as-parent", {}, "invalid_pair_code", "parent-empty"],
    ["/api/family/join-as-parent", { pairCode: "KID-NOTFOUND" }, "invalid_pair_code", "parent-invalid"],
    ["/api/family/join-as-parent", { pairCode: "KID-EXPIRED" }, "pair_code_expired", "parent-expired"],
  ];
  for (const [path, body, expected, userId] of cases) {
    const response = await post(app, env, path, body, await authorization(userId));
    assert.equal(response.status, 400, `${path}:${userId}`);
    assert.deepEqual(await response.json(), { error: expected }, `${path}:${userId}`);
  }
});

test("signup 입력·중복·OTP 실패는 실제 응답 payload에 stable code만 담는다", async () => {
  const { app, env, sqlite } = setup();
  sqlite.prepare(
    "INSERT INTO users(id,phone,is_anonymous,created_at) VALUES ('phone-owner','821012345678',0,'2026-08-01')",
  ).run();
  sqlite.prepare(
    "INSERT INTO user_profiles(user_id,display_name,login_id,created_at,updated_at) VALUES ('phone-owner','보호자','takenid','2026-08-01','2026-08-01')",
  ).run();
  const signupCases = [
    [{ phone: "bad", password: "123456" }, "invalid_phone", 400],
    [{ phone: "01099998888", password: "123456", loginId: "A" }, "invalid_login_id", 400],
    [{ phone: "01099998888", password: "123456", loginId: "takenid" }, "login_id_taken", 409],
    [{ phone: "01012345678", password: "123456" }, "phone_exists", 409],
  ];
  for (const [body, expected, status] of signupCases) {
    const response = await post(app, env, "/auth/signup/request-otp", body);
    assert.equal(response.status, status);
    assert.deepEqual(await response.json(), { error: expected });
  }

  const phone = "+821099998888";
  const codeHash = await hashOtp(phone, "123456", otpSecret);
  const verifyBody = { phone: "01099998888", token: "654321", password: "123456", loginId: "newid", name: "보호자" };
  sqlite.prepare(
    "INSERT INTO phone_otp(phone,code_hash,expires_at,attempts,created_at) VALUES (?,?,?,0,?)",
  ).run(phone, codeHash, "2020-01-01 00:00:00", "2020-01-01 00:00:00");
  let response = await post(app, env, "/auth/signup/verify", verifyBody);
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: "otp_expired" });

  sqlite.prepare(
    "INSERT INTO phone_otp(phone,code_hash,expires_at,attempts,created_at) VALUES (?,?,?,0,?)",
  ).run(phone, codeHash, "2099-01-01 00:00:00", "2026-08-01 00:00:00");
  response = await post(app, env, "/auth/signup/verify", verifyBody);
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: "otp_mismatch" });
});
