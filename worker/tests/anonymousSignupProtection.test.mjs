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
        if (existsSync(fileURLToPath(candidate))) {
          return { url: candidate.href, shortCircuit: true };
        }
      }
    }
    return nextResolve(specifier, context);
  },
});
after(() => typeScriptResolutionHook.deregister());

const authRoutes = (await import(pathToFileURL(resolve(workerDir, "routes/auth.ts")).href)).default;
const familyRoutes = (await import(pathToFileURL(resolve(workerDir, "routes/family.ts")).href)).default;
const { cleanupAnonymousSignupProtection } = await import(
  pathToFileURL(resolve(workerDir, "lib/anonymousSignupProtection.ts")).href
);

class Statement {
  constructor(db, sql, bindings = []) {
    this.db = db;
    this.sql = sql;
    this.bindings = bindings;
  }
  bind(...bindings) { return new Statement(this.db, this.sql, bindings); }
  async first() { return this.db.prepare(this.sql).get(...this.bindings) ?? null; }
  async all() { return { results: this.db.prepare(this.sql).all(...this.bindings) }; }
  async run() {
    const result = this.db.prepare(this.sql).run(...this.bindings);
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

class CleanupCandidatePauseStatement extends Statement {
  constructor(db, sql, bindings, gate) {
    super(db, sql, bindings);
    this.gate = gate;
  }
  bind(...bindings) {
    return new CleanupCandidatePauseStatement(this.db, this.sql, bindings, this.gate);
  }
  async all() {
    const result = await super.all();
    this.gate.markCandidatesSelected();
    await this.gate.waitForResume();
    return result;
  }
}

class PausingCleanupDb extends Db {
  constructor(sqlite) {
    super(sqlite);
    this.candidatesSelected = new Promise((resolveSelected) => {
      this.resolveSelected = resolveSelected;
    });
    this.resumePromise = new Promise((resolveResume) => {
      this.resolveResume = resolveResume;
    });
  }
  prepare(sql) {
    if (sql.includes("SELECT u.id") && sql.includes("ORDER BY substr") && sql.includes("LIMIT ?")) {
      return new CleanupCandidatePauseStatement(this.sqlite, sql, [], this);
    }
    return super.prepare(sql);
  }
  markCandidatesSelected() { this.resolveSelected(); }
  waitForResume() { return this.resumePromise; }
  resumeCleanup() { this.resolveResume(); }
}

function createDb() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(readFileSync(resolve(repoDir, "cloudflare/schema_d1.sql"), "utf8"));
  return { sqlite, db: new Db(sqlite) };
}

const { privateKey, publicKey } = await generateKeyPair("ES256", { extractable: true });
const jwtPrivateKey = JSON.stringify(await exportJWK(privateKey));
const jwtPublicKey = JSON.stringify(await exportJWK(publicKey));
const protectionSecret = "anonymous-signup-test-secret-32-bytes-minimum";

function env(db, extra = {}) {
  return {
    DB: db,
    JWT_PRIVATE_KEY: jwtPrivateKey,
    JWT_PUBLIC_KEY: jwtPublicKey,
    ANONYMOUS_SIGNUP_RATE_LIMIT_SECRET: protectionSecret,
    FAMILY_ROOM: {
      idFromName: (name) => name,
      get: () => ({ fetch: async () => new Response(null, { status: 204 }) }),
    },
    ...extra,
  };
}

async function accessToken(sub, role = "parent", familyId = null, isAnonymous = false) {
  return new SignJWT({ role, family_id: familyId, is_anonymous: isAnonymous })
    .setProtectedHeader({ alg: "ES256" })
    .setSubject(sub)
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(privateKey);
}

async function anonymousRequest(db, {
  ip = "203.0.113.10",
  deviceInstallId,
  secret = protectionSecret,
  jwtPrivateKeyValue = jwtPrivateKey,
} = {}) {
  const app = new Hono();
  app.route("/auth", authRoutes);
  return app.request(
    "http://test.local/auth/anonymous",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(ip ? { "CF-Connecting-IP": ip } : {}),
      },
      body: JSON.stringify(deviceInstallId ? { device_install_id: deviceInstallId } : {}),
    },
    env(db, {
      ANONYMOUS_SIGNUP_RATE_LIMIT_SECRET: secret,
      JWT_PRIVATE_KEY: jwtPrivateKeyValue,
    }),
  );
}

async function setupFamily(db, userId, tokenClaims = {}) {
  const app = new Hono();
  app.route("/api/family", familyRoutes);
  const token = await accessToken(
    userId,
    tokenClaims.role ?? "parent",
    null,
    tokenClaims.isAnonymous ?? false,
  );
  return app.request(
    "http://test.local/api/family/setup",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ parentName: "부모", plannedChildCount: 1, children: [] }),
    },
    env(db),
  );
}

test("DB에서 익명인 사용자는 parent JWT claim을 위조해도 가족 setup을 만들 수 없다", async () => {
  const { sqlite, db } = createDb();
  sqlite.prepare("INSERT INTO users(id,is_anonymous,created_at) VALUES ('anon-parent',1,'2026-07-14')").run();
  const response = await setupFamily(db, "anon-parent", { role: "parent", isAnonymous: false });
  assert.equal(response.status, 403, await response.clone().text());
  assert.deepEqual(await response.json(), { error: "anonymous_parent_setup_forbidden" });
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM families").get().count, 0);
});

test("정상 phone/OAuth 부모 사용자는 DB 정본 확인 뒤 기존 setup 흐름을 유지한다", async () => {
  for (const mode of ["phone", "oauth"]) {
    const { sqlite, db } = createDb();
    const userId = `${mode}-parent`;
    sqlite.prepare(
      "INSERT INTO users(id,phone,email,encrypted_password,is_anonymous,created_at) VALUES (?,?,?,?,0,'2026-07-14')",
    ).run(
      userId,
      mode === "phone" ? "821012345678" : null,
      mode === "oauth" ? "parent@example.test" : null,
      mode === "phone" ? "password-hash" : null,
    );
    if (mode === "oauth") {
      sqlite.prepare(
        "INSERT INTO auth_identities(id,user_id,provider,provider_id,created_at) VALUES (?,?,?,?, '2026-07-14')",
      ).run("identity-parent", userId, "google", "google-parent");
    }
    const response = await setupFamily(db, userId);
    assert.equal(response.status, 200, `${mode}: ${await response.clone().text()}`);
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM families WHERE parent_id=?").get(userId).count, 1);
  }
});

test("익명 가입은 IP 30회/시간과 device 5회/시간을 이중 적용하고 부분 claim을 rollback한다", async () => {
  const { sqlite, db } = createDb();
  for (let index = 0; index < 5; index += 1) {
    const response = await anonymousRequest(db, {
      ip: "203.0.113.20",
      deviceInstallId: "dev-stable-a",
    });
    assert.equal(response.status, 200, await response.clone().text());
  }
  const limited = await anonymousRequest(db, {
    ip: "203.0.113.20",
    deviceInstallId: "dev-stable-a",
  });
  assert.equal(limited.status, 429, await limited.clone().text());
  assert.match(limited.headers.get("Retry-After") ?? "", /^\d+$/);
  const rows = sqlite.prepare(
    "SELECT scope_type,request_count,scope_hash FROM anonymous_signup_rate_limits ORDER BY scope_type",
  ).all();
  assert.deepEqual(rows.map(({ scope_type, request_count }) => [scope_type, request_count]), [
    ["device", 5],
    ["ip", 5],
  ]);
  assert.ok(rows.every(({ scope_hash }) => /^[0-9a-f]{64}$/.test(scope_hash)));
  assert.ok(rows.every(({ scope_hash }) => !scope_hash.includes("203.0.113.20")));

  // device 제한 실패 때 새 IP claim도 되돌아가야 한다.
  const otherIp = await anonymousRequest(db, {
    ip: "203.0.113.21",
    deviceInstallId: "dev-stable-a",
  });
  assert.equal(otherIp.status, 429);
  assert.equal(
    sqlite.prepare("SELECT COUNT(*) AS count FROM anonymous_signup_rate_limits WHERE scope_type='ip'").get().count,
    1,
  );
});

test("구형 razr처럼 device id가 없어도 IP 제한 아래에서는 익명 로그인이 유지된다", async () => {
  const { db } = createDb();
  for (let index = 0; index < 3; index += 1) {
    const response = await anonymousRequest(db, { ip: "2001:db8::10" });
    assert.equal(response.status, 200, await response.clone().text());
  }
});

test("IPv6 privacy 주소는 canonical /64 버킷을 공유하고 다른 /64는 분리한다", async () => {
  const { sqlite, db } = createDb();
  const first = await anonymousRequest(db, {
    ip: "2001:0DB8:abcd:1234:0000:0000:0000:0001",
  });
  assert.equal(first.status, 200, await first.clone().text());
  for (let index = 2; index <= 30; index += 1) {
    const response = await anonymousRequest(db, {
      ip: `2001:db8:abcd:1234::${index.toString(16)}`,
    });
    assert.equal(response.status, 200, `${index}: ${await response.clone().text()}`);
  }
  const samePrefix = await anonymousRequest(db, {
    ip: "2001:db8:abcd:1234:ffff::1",
  });
  assert.equal(samePrefix.status, 429, await samePrefix.clone().text());

  const otherPrefix = await anonymousRequest(db, {
    ip: "2001:db8:abcd:1235::1",
  });
  assert.equal(otherPrefix.status, 200, await otherPrefix.clone().text());
  const counts = sqlite.prepare(
    "SELECT request_count FROM anonymous_signup_rate_limits WHERE scope_type='ip' ORDER BY request_count",
  ).all();
  assert.deepEqual(counts.map(({ request_count }) => request_count), [1, 30]);
});

test("IPv4-mapped IPv6는 내장 IPv4와 같은 /32 버킷을 공유한다", async () => {
  const { sqlite, db } = createDb();
  assert.equal((await anonymousRequest(db, { ip: "203.0.113.77" })).status, 200);
  assert.equal((await anonymousRequest(db, { ip: "::ffff:203.0.113.77" })).status, 200);
  const rows = sqlite.prepare(
    "SELECT request_count FROM anonymous_signup_rate_limits WHERE scope_type='ip'",
  ).all();
  assert.deepEqual(rows.map(({ request_count }) => request_count), [2]);
});

test("전용 보호 secret이 없어도 기존 JWT key를 도메인 분리해 온보딩을 유지한다", async () => {
  const { db } = createDb();
  const response = await anonymousRequest(db, { secret: "" });
  assert.equal(response.status, 200, await response.clone().text());
});

test("전용 보호 secret과 JWT key가 모두 없으면 익명 user를 만들지 않고 503으로 닫는다", async () => {
  const { sqlite, db } = createDb();
  const response = await anonymousRequest(db, { secret: "", jwtPrivateKeyValue: "" });
  assert.equal(response.status, 503, await response.clone().text());
  assert.deepEqual(await response.json(), { error: "anonymous_signup_protection_unavailable" });
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM users").get().count, 0);
});

test("익명 세션 발급 실패는 생성 user와 IP/device claim을 함께 되돌린다", async () => {
  const { sqlite, db } = createDb();
  const response = await anonymousRequest(db, {
    ip: "203.0.113.30",
    deviceInstallId: "dev-session-failure",
    jwtPrivateKeyValue: "invalid-signing-key",
  });
  assert.equal(response.status, 503, await response.clone().text());
  assert.deepEqual(await response.json(), { error: "anonymous_signup_failed" });
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM users").get().count, 0);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM refresh_tokens").get().count, 0);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM anonymous_signup_rate_limits").get().count, 0);
});

test("IP 헤더가 없는 legacy 요청은 공용 unknown bucket 3회까지만 허용한다", async () => {
  const { db } = createDb();
  for (let index = 0; index < 3; index += 1) {
    const response = await anonymousRequest(db, { ip: null });
    assert.equal(response.status, 200, await response.clone().text());
  }
  const limited = await anonymousRequest(db, { ip: null });
  assert.equal(limited.status, 429, await limited.clone().text());
});

test("48시간 지난 미연결 익명 user와 연관 행만 정리하고 연결·최근·실명 계정은 보존한다", async () => {
  const { sqlite, db } = createDb();
  sqlite.prepare(
    `INSERT INTO users(id,is_anonymous,created_at) VALUES
      ('anon-orphan-old',1,'2026-07-10 00:00:00+00'),
      ('anon-linked-old',1,'2026-07-10 00:00:00+00'),
      ('anon-recent',1,'2026-07-14 11:00:00+00'),
      ('real-old',0,'2026-07-10 00:00:00+00')`,
  ).run();
  sqlite.prepare(
    "INSERT INTO families(id,parent_id,pair_code,created_at) VALUES ('family-a','real-old','PAIR-A','2026-07-10')",
  ).run();
  sqlite.prepare(
    `INSERT INTO family_members(id,family_id,user_id,role,name,is_active,created_at)
     VALUES ('linked-member','family-a','anon-linked-old','child','연결',1,'2026-07-10')`,
  ).run();
  for (const userId of ["anon-orphan-old", "anon-linked-old", "anon-recent", "real-old"]) {
    sqlite.prepare(
      "INSERT INTO refresh_tokens(token,user_id,issued_at,expires_at,revoked) VALUES (?,?, '2026-07-10','2026-08-10',0)",
    ).run(`refresh-${userId}`, userId);
  }
  sqlite.prepare(
    `INSERT INTO pair_attempts(id,user_id,attempted_at) VALUES
      (1,'anon-orphan-old','2026-07-10'),
      (2,'anon-linked-old','2026-07-10')`,
  ).run();
  sqlite.prepare(
    `INSERT INTO anonymous_signup_rate_limits(scope_type,scope_hash,window_key,request_count,updated_at)
     VALUES ('ip',?,'2026-07-10T00',1,'2026-07-10 00:00:00+00')`,
  ).run("a".repeat(64));

  const result = await cleanupAnonymousSignupProtection(db, new Date("2026-07-14T12:00:00.000Z"));
  assert.deepEqual(result, { anonymousUsersRemoved: 1, rateLimitRowsRemoved: 1 });
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM users WHERE id='anon-orphan-old'").get().count, 0);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM refresh_tokens WHERE user_id='anon-orphan-old'").get().count, 0);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM pair_attempts WHERE user_id='anon-orphan-old'").get().count, 0);
  for (const userId of ["anon-linked-old", "anon-recent", "real-old"]) {
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM users WHERE id=?").get(userId).count, 1);
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM refresh_tokens WHERE user_id=?").get(userId).count, 1);
  }
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM pair_attempts WHERE user_id='anon-linked-old'").get().count, 1);
});

test("orphan 후보 선정 뒤 join이 먼저 완료되면 cleanup은 user와 연관 행을 삭제하지 않는다", async () => {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(readFileSync(resolve(repoDir, "cloudflare/schema_d1.sql"), "utf8"));
  const db = new PausingCleanupDb(sqlite);
  sqlite.prepare(
    `INSERT INTO users(id,is_anonymous,created_at) VALUES
      ('parent-a',0,'2026-07-10'),
      ('anon-racing',1,'2026-07-10')`,
  ).run();
  sqlite.prepare(
    "INSERT INTO refresh_tokens(token,user_id,issued_at,expires_at,revoked) VALUES ('refresh-racing','anon-racing','2026-07-10','2026-08-10',0)",
  ).run();
  sqlite.prepare(
    "INSERT INTO pair_attempts(id,user_id,attempted_at) VALUES (1,'anon-racing','2026-07-10')",
  ).run();

  const cleanupPromise = cleanupAnonymousSignupProtection(
    db,
    new Date("2026-07-14T12:00:00.000Z"),
  );
  await db.candidatesSelected;
  sqlite.exec("BEGIN IMMEDIATE");
  try {
    sqlite.prepare(
      "INSERT INTO families(id,parent_id,pair_code,created_at) VALUES ('family-a','parent-a','PAIR-A','2026-07-14')",
    ).run();
    sqlite.prepare(
      `INSERT INTO family_members(id,family_id,user_id,role,name,is_active,created_at)
       VALUES ('child-racing','family-a','anon-racing','child','연결',1,'2026-07-14')`,
    ).run();
    sqlite.prepare("UPDATE users SET is_anonymous=0 WHERE id='anon-racing'").run();
    sqlite.exec("COMMIT");
  } catch (error) {
    sqlite.exec("ROLLBACK");
    throw error;
  }
  db.resumeCleanup();

  const result = await cleanupPromise;
  assert.equal(result.anonymousUsersRemoved, 0);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM users WHERE id='anon-racing'").get().count, 1);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM family_members WHERE user_id='anon-racing'").get().count, 1);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM refresh_tokens WHERE user_id='anon-racing'").get().count, 1);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM pair_attempts WHERE user_id='anon-racing'").get().count, 1);
});
