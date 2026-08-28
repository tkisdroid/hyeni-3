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
const otpSecret = "signup-pairing-error-contract-secret";

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

test("아이디 확인은 기존 대소문자·공백을 정규화해 중복으로 보고 캐시하지 않는다", async () => {
  const { app, env, sqlite } = setup();
  sqlite.prepare("INSERT INTO users(id,is_anonymous) VALUES ('legacy-login-owner',0)").run();
  sqlite.prepare(
    "INSERT INTO user_profiles(user_id,display_name,login_id,created_at,updated_at) VALUES ('legacy-login-owner','기존 보호자',' MindLady ','2026-08-01','2026-08-01')",
  ).run();

  const response = await post(app, env, "/auth/check-login-id", { loginId: "mindlady" });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), { available: false });
});

test("child·공동 보호자 pairing 실패는 legacy error와 stable code를 함께 반환한다", async () => {
  const { app, env, sqlite } = setup();
  sqlite.prepare("INSERT INTO users(id,is_anonymous) VALUES ('primary-parent',0)").run();
  for (const userId of ["child-empty", "child-invalid", "child-expired", "parent-empty", "parent-invalid", "parent-expired"]) {
    sqlite.prepare("INSERT INTO users(id,is_anonymous) VALUES (?,?)").run(userId, userId.startsWith("child-") ? 1 : 0);
  }
  sqlite.prepare(
    "INSERT INTO families(id,parent_id,pair_code,pair_code_expires_at,created_at) VALUES ('expired-family','primary-parent','KID-EXPIRED','2020-01-01 00:00:00','2020-01-01')",
  ).run();

  const cases = [
    ["/api/family/join", {}, "연동 코드를 입력해주세요", "invalid_pair_code", "child-empty"],
    ["/api/family/join", { pairCode: "KID-NOTFOUND" }, "Invalid pair code", "invalid_pair_code", "child-invalid"],
    ["/api/family/join", { pairCode: "KID-EXPIRED" }, "만료된 연동 코드예요. 부모님께 새 코드를 받아 주세요", "pair_code_expired", "child-expired"],
    ["/api/family/join-as-parent", {}, "연동 코드를 입력해주세요", "invalid_pair_code", "parent-empty"],
    ["/api/family/join-as-parent", { pairCode: "KID-NOTFOUND" }, "Invalid pair code", "invalid_pair_code", "parent-invalid"],
    ["/api/family/join-as-parent", { pairCode: "KID-EXPIRED" }, "만료된 연동 코드예요. 가족 관리자에게 새 코드를 받아 주세요", "pair_code_expired", "parent-expired"],
  ];
  for (const [path, body, legacyError, stableCode, userId] of cases) {
    const response = await post(app, env, path, body, await authorization(userId));
    assert.equal(response.status, 400, `${path}:${userId}`);
    const payload = await response.json();
    assert.deepEqual(payload, { error: legacyError, code: stableCode }, `${path}:${userId}`);
    assert.equal(payload.error || payload.message, legacyError, "구버전 parser는 기존 사용자 문구를 표시한다");
    assert.doesNotMatch(payload.error, /^(?:invalid_pair_code|pair_code_expired)$/);
  }
});

test("공동 보호자 자리가 찬 실패는 교체 방법을 안내할 stable code를 반환한다", async () => {
  const { app, env, sqlite } = setup();
  for (const userId of ["primary-parent", "current-coparent", "next-coparent"]) {
    sqlite.prepare("INSERT INTO users(id,is_anonymous) VALUES (?,0)").run(userId);
  }
  sqlite.prepare(
    "INSERT INTO families(id,parent_id,pair_code,created_at) VALUES ('occupied-family','primary-parent','KID-OCCUPIED','2026-08-23')",
  ).run();
  sqlite.prepare(
    `INSERT INTO family_members(id,family_id,user_id,role,name,is_active,created_at) VALUES
       ('primary-member','occupied-family','primary-parent','parent','주 보호자',1,'2026-08-23'),
       ('coparent-member','occupied-family','current-coparent','parent','기존 보호자',1,'2026-08-23')`,
  ).run();

  const response = await post(
    app,
    env,
    "/api/family/join-as-parent",
    { pairCode: "KID-OCCUPIED", device_install_id: "next-coparent-device" },
    await authorization("next-coparent", "parent", false),
  );

  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), {
    error: "이미 보조 보호자가 등록되어 있어요",
    code: "coparent_slot_occupied",
  });
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
  const verifyBody = {
    phone: "01099998888",
    token: "654321",
    password: "123456",
    loginId: "newid",
    name: "보호자",
    device_install_id: "signup-test-device",
    device_platform: "web",
  };
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

test("가입 전제조건 실패는 올바른 OTP를 소비하지 않아 같은 요청을 바로 고칠 수 있다", async () => {
  const { app, env, sqlite } = setup();
  const phone = "+821077771111";
  const token = "123456";
  const codeHash = await hashOtp(phone, token, otpSecret);
  sqlite.prepare(
    "INSERT INTO phone_otp(phone,code_hash,expires_at,attempts,created_at) VALUES (?,?,?,0,?)",
  ).run(phone, codeHash, "2099-01-01 00:00:00", "2026-08-21 00:00:00");

  const body = {
    phone: "01077771111",
    token,
    password: "signup-password",
    loginId: "otpkeeper",
    name: "보호자",
  };
  const missingDevice = await post(app, env, "/auth/signup/verify", body);
  assert.equal(missingDevice.status, 400);
  assert.deepEqual(await missingDevice.json(), { error: "device_identity_required" });
  assert.equal(
    sqlite.prepare("SELECT COUNT(*) AS n FROM phone_otp WHERE phone=? AND code_hash=?").get(phone, codeHash).n,
    1,
  );

  sqlite.prepare(
    "INSERT INTO users(id,phone,is_anonymous,created_at) VALUES ('taken-login-owner','821077770000',0,'2026-08-01')",
  ).run();
  sqlite.prepare(
    "INSERT INTO user_profiles(user_id,display_name,login_id,phone,created_at,updated_at) VALUES ('taken-login-owner','기존 보호자','otpkeeper','+821077770000','2026-08-01','2026-08-01')",
  ).run();
  const takenLogin = await post(app, env, "/auth/signup/verify", {
    ...body,
    device_install_id: "signup-test-device",
  });
  assert.equal(takenLogin.status, 409);
  assert.deepEqual(await takenLogin.json(), { error: "login_id_taken" });
  assert.equal(
    sqlite.prepare("SELECT COUNT(*) AS n FROM phone_otp WHERE phone=? AND code_hash=?").get(phone, codeHash).n,
    1,
  );
});

test("family setup은 명시 serviceCountry가 ISO 코드가 아니면 edge 제안으로 강등하지 않는다", async () => {
  const { app, env, sqlite } = setup();
  sqlite.prepare("INSERT INTO users(id,is_anonymous) VALUES ('market-parent-invalid',0)").run();
  const response = await post(
    app,
    env,
    "/api/family/setup",
    { parentName: "보호자", plannedChildCount: 1, serviceCountry: "KOR" },
    await authorization("market-parent-invalid", "parent", false),
  );
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "invalid_service_country" });
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM families WHERE parent_id='market-parent-invalid'").get().n, 0);
});

test("family setup은 초기 service market을 가족·멤버 batch와 함께 확정한다", async () => {
  const { app, db, env, sqlite } = setup();
  sqlite.prepare("INSERT INTO users(id,is_anonymous) VALUES ('market-parent-atomic',0)").run();
  const originalPrepare = db.prepare.bind(db);
  db.prepare = (sql) => {
    const statement = originalPrepare(sql);
    if (sql.includes("SET service_country=")) {
      return {
        ...statement,
        bind(...bindings) {
          const bound = statement.bind(...bindings);
          return { ...bound, async run() { throw new Error("initial_market_post_commit_write"); } };
        },
      };
    }
    return statement;
  };
  const response = await post(
    app,
    env,
    "/api/family/setup",
    { parentName: "보호자", plannedChildCount: 1, serviceCountry: "KR", serviceCountryMatchedEdge: true },
    await authorization("market-parent-atomic", "parent", false),
  );
  assert.equal(response.status, 200);
  const family = sqlite.prepare(
    "SELECT service_country, service_country_source, study_market FROM families WHERE parent_id='market-parent-atomic'",
  ).get();
  assert.equal(family.service_country, "KR");
  assert.equal(family.service_country_source, "guardian_confirmed");
  assert.equal(family.study_market, "KR");
});

test("가입 설문은 고정 선택지만 계정 생성 batch의 메타데이터에 저장한다", async () => {
  const { app, env, sqlite } = setup();
  const phone = "+821033334444";
  const token = "123456";
  const codeHash = await hashOtp(phone, token, otpSecret);
  sqlite.prepare(
    "INSERT INTO phone_otp(phone,code_hash,expires_at,attempts,created_at) VALUES (?,?,?,0,?)",
  ).run(phone, codeHash, "2099-01-01 00:00:00", "2026-08-22 00:00:00");

  const body = {
    phone: "01033334444",
    token,
    password: "signup-password",
    loginId: "surveyparent",
    name: "설문 보호자",
    device_install_id: "survey-signup-device",
    device_platform: "web",
  };
  const invalid = await post(app, env, "/auth/signup/verify", {
    ...body,
    onboardingInterests: ["location", "free-text"],
  });
  assert.equal(invalid.status, 400);
  assert.deepEqual(await invalid.json(), { error: "invalid_onboarding_interests" });
  assert.equal(
    sqlite.prepare("SELECT COUNT(*) AS n FROM phone_otp WHERE phone=? AND code_hash=?").get(phone, codeHash).n,
    1,
    "잘못된 설문 payload가 올바른 OTP를 소비하면 안 됩니다",
  );

  const valid = await post(app, env, "/auth/signup/verify", {
    ...body,
    onboardingInterests: ["location", "schedule", "location"],
  });
  assert.equal(valid.status, 200);
  const user = sqlite.prepare("SELECT raw_user_meta_data FROM users WHERE phone='821033334444'").get();
  const metadata = JSON.parse(user.raw_user_meta_data);
  assert.deepEqual(metadata.onboarding_interests, ["location", "schedule"]);
  assert.equal(typeof metadata.onboarding_completed_at, "string");
});

test("전화 신규 가입의 registration country는 OTP 계정 batch에 있어 post-commit 오류로 500이 되지 않는다", async () => {
  const { app, env, sqlite } = setup({ failRegistrationUpdate: true });
  const phone = "+821044443333";
  const token = "123456";
  const codeHash = await hashOtp(phone, token, otpSecret);
  sqlite.prepare(
    "INSERT INTO phone_otp(phone,code_hash,expires_at,attempts,created_at) VALUES (?,?,?,0,?)",
  ).run(phone, codeHash, "2099-01-01 00:00:00", "2026-08-28 00:00:00");
  const response = await post(app, env, "/auth/signup/verify", {
    phone: "01044443333",
    token,
    password: "signup-password",
    loginId: "countryphone",
    name: "보호자",
    device_install_id: "phone-country-device",
    device_platform: "web",
  }, undefined, "KR");
  assert.equal(response.status, 200);
  assert.equal(sqlite.prepare("SELECT registration_country FROM users WHERE phone='821044443333'").get().registration_country, "KR");
});

test("OTP 검증 직후 재발급이 경합하면 계정 행을 만들지 않고 새 OTP를 보존한다", async () => {
  const { app, db, env, sqlite } = setup();
  const phone = "+821055551111";
  const token = "123456";
  const validatedHash = await hashOtp(phone, token, otpSecret);
  const replacementHash = await hashOtp(phone, "654321", otpSecret);
  sqlite.prepare(
    "INSERT INTO phone_otp(phone,code_hash,expires_at,attempts,created_at) VALUES (?,?,?,0,?)",
  ).run(phone, validatedHash, "2099-01-01 00:00:00", "2026-08-21 00:00:00");

  const originalBatch = db.batch.bind(db);
  db.batch = async (statements) => {
    sqlite.prepare("UPDATE phone_otp SET code_hash=?,created_at=? WHERE phone=?")
      .run(replacementHash, "2026-08-21 00:02:00", phone);
    return originalBatch(statements);
  };

  const response = await post(app, env, "/auth/signup/verify", {
    phone: "01055551111",
    token,
    password: "signup-password",
    loginId: "otpraceparent",
    name: "보호자",
    device_install_id: "otp-race-device",
    device_platform: "web",
  });
  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), { error: "signup_failed" });
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM users WHERE phone='821055551111'").get().n, 0);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM user_profiles WHERE login_id='otpraceparent'").get().n, 0);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM auth_identities WHERE provider_id IN (SELECT id FROM users WHERE phone='821055551111')").get().n, 0);
  assert.equal(
    sqlite.prepare("SELECT COUNT(*) AS n FROM phone_otp WHERE phone=? AND code_hash=?").get(phone, replacementHash).n,
    1,
  );
});

test("잘못된 비밀번호 뒤에도 입력 계정의 세션은 생기지 않고 올바른 비밀번호 로그인은 즉시 성공한다", async () => {
  const { app, env, sqlite } = setup();
  const passwordHash = await hashPassword("correct-password");
  sqlite.prepare(
    `INSERT INTO users(id,phone,encrypted_password,is_anonymous,raw_user_meta_data,created_at)
     VALUES ('password-parent','821066661111',?,0,'{}','2026-08-21')`,
  ).run(passwordHash);
  sqlite.prepare(
    `INSERT INTO user_profiles(user_id,display_name,login_id,phone,created_at,updated_at)
     VALUES ('password-parent','비밀번호 보호자','passwordparent','+821066661111','2026-08-21','2026-08-21')`,
  ).run();
  const loginBody = {
    loginId: "passwordparent",
    device_install_id: "password-test-device",
    device_platform: "web",
  };

  const wrong = await post(app, env, "/auth/login-password", {
    ...loginBody,
    password: "wrong-password",
  });
  assert.equal(wrong.status, 401);
  assert.deepEqual(await wrong.json(), { error: "invalid_credentials" });
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM refresh_tokens WHERE user_id='password-parent'").get().n, 0);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM account_device_sessions WHERE user_id='password-parent'").get().n, 0);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM login_attempts WHERE login_id='passwordparent'").get().n, 1);

  const correct = await post(app, env, "/auth/login-password", {
    ...loginBody,
    password: "correct-password",
  });
  assert.equal(correct.status, 200);
  const payload = await correct.json();
  assert.equal(payload.user.id, "password-parent");
  assert.equal(typeof payload.session.access_token, "string");
  assert.equal(typeof payload.session.refresh_token, "string");
  assert.equal("password" in payload, false);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM login_attempts WHERE login_id='passwordparent'").get().n, 0);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM account_device_sessions WHERE user_id='password-parent' AND revoked_at IS NULL").get().n, 1);
});

test("PC 재로그인은 iPhone 세션만 닫고 같은 가족·아이 정본을 새 설치에 유지한다", async () => {
  const { app, env, sqlite } = setup();
  const passwordHash = await hashPassword("takeover-password");
  sqlite.prepare(
    `INSERT INTO users(id,phone,encrypted_password,is_anonymous,raw_user_meta_data,created_at)
     VALUES
       ('takeover-parent','821077771111',?,0,'{}','2026-08-23'),
       ('takeover-child',NULL,NULL,0,'{}','2026-08-23')`,
  ).run(passwordHash);
  sqlite.prepare(
    `INSERT INTO user_profiles(user_id,display_name,login_id,phone,created_at,updated_at)
     VALUES ('takeover-parent','보호자','takeoverparent','+821077771111','2026-08-23','2026-08-23')`,
  ).run();
  sqlite.prepare(
    `INSERT INTO families(id,parent_id,parent_name,pair_code,created_at)
     VALUES ('takeover-family','takeover-parent','보호자','KID-TAKEOVER','2026-08-23')`,
  ).run();
  sqlite.prepare(
    `INSERT INTO family_members(id,family_id,user_id,role,name,is_active,created_at) VALUES
       ('takeover-parent-member','takeover-family','takeover-parent','parent','보호자',1,'2026-08-23'),
       ('takeover-child-member','takeover-family','takeover-child','child','혜니',1,'2026-08-23')`,
  ).run();

  const iphoneLogin = await post(app, env, "/auth/login-password", {
    loginId: "takeoverparent",
    password: "takeover-password",
    device_install_id: "iphone-install",
    device_label: "보호자 iPhone",
    device_platform: "ios",
  });
  assert.equal(iphoneLogin.status, 200, await iphoneLogin.clone().text());
  const iphone = await iphoneLogin.json();

  const pcLogin = await post(app, env, "/auth/login-password", {
    loginId: "takeoverparent",
    password: "takeover-password",
    device_install_id: "pc-browser-install",
    device_label: "보호자 PC",
    device_platform: "web",
  });
  assert.equal(pcLogin.status, 200, await pcLogin.clone().text());
  const pc = await pcLogin.json();

  const oldRefresh = await post(app, env, "/auth/refresh", {
    refresh_token: iphone.session.refresh_token,
    device_install_id: "iphone-install",
    device_platform: "ios",
  });
  assert.equal(oldRefresh.status, 401);
  assert.deepEqual(await oldRefresh.json(), { error: "device_session_inactive" });

  const oldFamily = await app.request("http://test.local/api/family/mine", {
    headers: { authorization: `Bearer ${iphone.session.access_token}` },
  }, env);
  assert.equal(oldFamily.status, 401);
  assert.deepEqual(await oldFamily.json(), { error: "device_session_inactive" });

  const pcFamily = await app.request("http://test.local/api/family/mine", {
    headers: { authorization: `Bearer ${pc.session.access_token}` },
  }, env);
  assert.equal(pcFamily.status, 200, await pcFamily.clone().text());
  const family = await pcFamily.json();
  assert.equal(family.familyId, "takeover-family");
  assert.ok(family.members.some((member) => member.user_id === "takeover-child" && member.name === "혜니"));
  assert.deepEqual({ ...sqlite.prepare(
    "SELECT device_id,device_platform,revoked_at FROM account_device_sessions WHERE user_id='takeover-parent'",
  ).get() }, {
    device_id: "pc-browser-install",
    device_platform: "web",
    revoked_at: null,
  });
  assert.equal(sqlite.prepare(
    "SELECT COUNT(*) AS n FROM refresh_tokens WHERE user_id='takeover-parent' AND revoked=0",
  ).get().n, 1);
});
