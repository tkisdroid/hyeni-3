import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { dirname, extname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test, { after } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { Hono } from "hono";
import { applyWebAiCreditRetentionFixture } from "./webAiCreditRetentionFixture.mjs";

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

const migration = readFileSync(resolve(workerDir, "db/referral-rewards-v2.sql"), "utf8");
const canonicalSchema = readFileSync(resolve(repoDir, "cloudflare/schema_d1.sql"), "utf8");
const referralRewardsSource = readFileSync(
  resolve(workerDir, "lib/referralRewardsV2.ts"),
  "utf8",
);
const {
  createReferralCode,
  processPendingReferralRewards,
} = await import(pathToFileURL(resolve(workerDir, "lib/referralRewardsV2.ts")).href);
const { buildFamilyScopedDeleteStmts } = await import(
  pathToFileURL(resolve(workerDir, "lib/accountDeletion.ts")).href
);
const referralRoutes = (await import(
  pathToFileURL(resolve(workerDir, "routes/referrals.ts")).href
)).default;
const familyRoutes = (await import(
  pathToFileURL(resolve(workerDir, "routes/family.ts")).href
)).default;

const { privateKey, publicKey } = await generateKeyPair("ES256", { extractable: true });
const jwtPrivateKey = JSON.stringify(await exportJWK(privateKey));
const jwtPublicKey = JSON.stringify(await exportJWK(publicKey));

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
    this.owner.queryCount += 1;
    return this.owner.sqlite.prepare(this.sql).get(...this.bindings) ?? null;
  }

  async all() {
    this.owner.queryCount += 1;
    return { success: true, results: this.owner.sqlite.prepare(this.sql).all(...this.bindings) };
  }

  async run() {
    this.owner.queryCount += 1;
    if (typeof this.owner.beforeRun === "function") {
      await this.owner.beforeRun(this.sql, this.bindings);
    }
    if (this.owner.failSql && this.owner.failSql.test(`${this.sql}\n${this.bindings.join("|")}`)) {
      this.owner.failSql = null;
      throw new Error("injected_referral_batch_failure");
    }
    const result = this.owner.sqlite.prepare(this.sql).run(...this.bindings);
    return { success: true, meta: { changes: Number(result.changes) } };
  }
}

class Db {
  constructor(sqlite) {
    this.sqlite = sqlite;
    this.failSql = null;
    this.beforeRun = null;
    this.queryCount = 0;
  }

  prepare(sql) {
    return new Statement(this, sql);
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

  resetQueryCount() {
    this.queryCount = 0;
  }
}

function createDb() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(canonicalSchema);
  // 정본 스키마 통합 전에도 삭제 플래너의 migration-before-delete 계약을 재현한다.
  applyWebAiCreditRetentionFixture(sqlite);
  sqlite.exec(migration);
  return { sqlite, db: new Db(sqlite) };
}

function addUser(sqlite, userId, isAnonymous = false) {
  sqlite.prepare(
    "INSERT INTO users(id,is_anonymous,created_at) VALUES (?,?,?)",
  ).run(userId, isAnonymous ? 1 : 0, "2026-08-01 00:00:00.000+00");
}

function addFamily(sqlite, { familyId, parentId, childUserId = null, coParentId = null }) {
  sqlite.prepare(
    `INSERT INTO families(id,parent_id,pair_code,parent_name,created_at)
     VALUES (?,?,?,'보호자','2026-08-01 00:00:00.000+00')`,
  ).run(familyId, parentId, `KID-${familyId}`.toUpperCase());
  sqlite.prepare(
    `INSERT INTO family_members(id,family_id,user_id,role,name,is_active,created_at)
     VALUES (?,?,?,'parent','보호자',1,'2026-08-01 00:00:00.000+00')`,
  ).run(`member-${parentId}`, familyId, parentId);
  if (coParentId) {
    sqlite.prepare(
      `INSERT INTO family_members(id,family_id,user_id,role,name,is_active,created_at)
       VALUES (?,?,?,'parent','공동 보호자',1,'2026-08-01 00:00:00.000+00')`,
    ).run(`member-${coParentId}`, familyId, coParentId);
  }
  if (childUserId) {
    sqlite.prepare(
      `INSERT INTO family_members(id,family_id,user_id,role,name,is_active,child_order,created_at)
       VALUES (?,?,?,'child','아이',1,1,'2026-08-01 00:00:00.000+00')`,
    ).run(`member-${childUserId}`, familyId, childUserId);
  }
}

async function authorization(sub, familyId = null) {
  const token = await new SignJWT({ role: "parent", family_id: familyId, is_anonymous: false })
    .setProtectedHeader({ alg: "ES256" })
    .setSubject(sub)
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(privateKey);
  return `Bearer ${token}`;
}

function environment(db) {
  return {
    DB: db,
    JWT_PRIVATE_KEY: jwtPrivateKey,
    JWT_PUBLIC_KEY: jwtPublicKey,
    FAMILY_ROOM: {
      idFromName: (name) => name,
      get: () => ({ fetch: async () => new Response(null, { status: 204 }) }),
    },
  };
}

function createApp() {
  const app = new Hono();
  app.route("/api/referrals", referralRoutes);
  app.route("/api/family", familyRoutes);
  return app;
}

async function jsonRequest(app, db, path, parentId, familyId, body) {
  return app.request(`http://test.local${path}`, {
    method: "POST",
    headers: {
      authorization: await authorization(parentId, familyId),
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  }, environment(db));
}

async function rawJsonRequest(app, db, path, parentId, familyId, body, extraHeaders = {}) {
  return app.request(`http://test.local${path}`, {
    method: "POST",
    headers: {
      authorization: await authorization(parentId, familyId),
      "content-type": "application/json",
      ...extraHeaders,
    },
    body,
  }, environment(db));
}

test("추천 v2 migration은 좌표·주소 없이 단일 귀속·상태·3건 상한을 DB 제약으로 고정한다", () => {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`
    CREATE TABLE location_confirmation_records(
      id TEXT PRIMARY KEY,
      family_id TEXT NOT NULL,
      subject_user_id TEXT NOT NULL,
      action TEXT NOT NULL,
      collection_method TEXT NOT NULL,
      acquisition_path TEXT NOT NULL,
      service_code TEXT NOT NULL,
      purpose_code TEXT NOT NULL,
      occurred_at TEXT NOT NULL
    );
  `);
  sqlite.exec(migration);
  sqlite.exec(migration);
  const codeColumns = sqlite.prepare("PRAGMA table_info('referral_codes_v2')").all().map((row) => row.name);
  const completionColumns = sqlite.prepare("PRAGMA table_info('referral_completions_v2')").all().map((row) => row.name);
  assert.deepEqual(codeColumns, [
    "id", "family_id", "owner_parent_id", "reward_child_user_id", "code", "status",
    "successful_referrals", "created_at", "updated_at", "revoked_at",
  ]);
  assert.deepEqual(completionColumns, [
    "id", "referral_code_id", "referrer_family_id", "referrer_parent_id",
    "referrer_child_user_id", "referee_family_id", "referee_parent_id",
    "referee_child_user_id", "status", "reward_credits", "first_location_at",
    "latest_location_at", "qualified_at", "rewarded_at", "rejection_reason",
    "created_at", "updated_at",
  ]);
  const forbidden = /^(?:lat|lng|longitude|latitude|address|phone|email|name)$/i;
  assert.equal([...codeColumns, ...completionColumns].some((column) => forbidden.test(column)), false);
  assert.ok(
    sqlite.prepare(
      "SELECT 1 FROM sqlite_master WHERE type='index' AND name='idx_referral_completions_v2_ready'",
    ).get(),
  );
  assert.ok(
    sqlite.prepare(
      "SELECT 1 FROM sqlite_master WHERE type='trigger' AND name='trg_referral_location_evidence_snapshot'",
    ).get(),
  );
  sqlite.close();
});

test("추천 자격은 원시 확인자료를 재조회하지 않고 최초·48시간 경계 요약만 사용한다", () => {
  assert.doesNotMatch(referralRewardsSource, /(?:FROM|JOIN)\s+location_confirmation_records\b/i);
  assert.doesNotMatch(referralRewardsSource, /readLocationEvidence[\s\S]+db\.prepare/i);
});

test("추천 위치 요약은 중간 fix를 쓰지 않고 역순 earlier fix가 48시간을 채우면 준비된다", () => {
  const { sqlite } = createDb();
  addUser(sqlite, "reverse-referee-parent");
  addUser(sqlite, "reverse-referee-child");
  addFamily(sqlite, {
    familyId: "reverse-referee",
    parentId: "reverse-referee-parent",
    childUserId: "reverse-referee-child",
  });
  sqlite.prepare(
    `INSERT INTO referral_codes_v2
       (id,family_id,owner_parent_id,reward_child_user_id,code,status,created_at,updated_at)
     VALUES ('reverse-code','reverse-referrer','reverse-parent','reverse-child',
             'HYENI-6789ABCDEFGHJKMN','active',?,?)`,
  ).run("2026-07-31 00:00:00.000+00", "2026-07-31 00:00:00.000+00");
  sqlite.prepare(
    `INSERT INTO referral_completions_v2
       (id,referral_code_id,referrer_family_id,referrer_parent_id,referrer_child_user_id,
        referee_family_id,referee_parent_id,status,reward_credits,created_at,updated_at)
     VALUES ('reverse-completion','reverse-code','reverse-referrer','reverse-parent','reverse-child',
             'reverse-referee','reverse-referee-parent','pending',50,?,?)`,
  ).run("2026-07-31 00:00:00.000+00", "2026-07-31 00:00:00.000+00");

  const insertHistory = sqlite.prepare(
    `INSERT INTO location_history(user_id,family_id,lat,lng,recorded_at,is_estimated,accuracy_m)
     VALUES ('reverse-referee-child','reverse-referee',37.5,127.0,?,0,15)`,
  );
  insertHistory.run("2026-08-03 01:00:00.000+00");
  assert.deepEqual(
    { ...sqlite.prepare(
      `SELECT referee_child_user_id,first_location_at,latest_location_at
         FROM referral_completions_v2 WHERE id='reverse-completion'`,
    ).get() },
    {
      referee_child_user_id: "reverse-referee-child",
      first_location_at: "2026-08-03 01:00:00.000+00",
      latest_location_at: "2026-08-03 01:00:00.000+00",
    },
  );

  sqlite.prepare(
    "UPDATE referral_completions_v2 SET updated_at='snapshot-marker' WHERE id='reverse-completion'",
  ).run();
  insertHistory.run("2026-08-04 01:00:00.000+00");
  assert.deepEqual(
    { ...sqlite.prepare(
      `SELECT first_location_at,latest_location_at,updated_at
         FROM referral_completions_v2 WHERE id='reverse-completion'`,
    ).get() },
    {
      first_location_at: "2026-08-03 01:00:00.000+00",
      latest_location_at: "2026-08-03 01:00:00.000+00",
      updated_at: "snapshot-marker",
    },
  );

  insertHistory.run("2026-08-01 01:00:00.000+00");
  assert.deepEqual(
    { ...sqlite.prepare(
      `SELECT first_location_at,latest_location_at
         FROM referral_completions_v2 WHERE id='reverse-completion'`,
    ).get() },
    {
      first_location_at: "2026-08-01 01:00:00.000+00",
      latest_location_at: "2026-08-03 01:00:00.000+00",
    },
  );
  sqlite.close();
});

test("추천 코드는 80비트 난수 형식이며 호출마다 다르다", () => {
  const codes = Array.from({ length: 100 }, () => createReferralCode());
  assert.equal(new Set(codes).size, codes.length);
  for (const code of codes) assert.match(code, /^HYENI-[0-9A-HJKMNP-TV-Z]{16}$/);
});

test("가족 삭제는 referee 간접 참조까지 지우고 다른 가족의 추천 코드는 보존한다", async () => {
  const { sqlite, db } = createDb();
  for (const userId of ["delete-p-a", "delete-c-a", "delete-p-b"]) addUser(sqlite, userId);
  addFamily(sqlite, { familyId: "delete-f-a", parentId: "delete-p-a", childUserId: "delete-c-a" });
  addFamily(sqlite, { familyId: "delete-f-b", parentId: "delete-p-b" });
  sqlite.prepare(
    `INSERT INTO referral_codes_v2
       (id,family_id,owner_parent_id,reward_child_user_id,code,status,created_at,updated_at)
     VALUES ('delete-code','delete-f-a','delete-p-a','delete-c-a','HYENI-56789ABCDEFGHJKM','active',?,?)`,
  ).run("2026-08-01 00:00:00.000+00", "2026-08-01 00:00:00.000+00");
  sqlite.prepare(
    `INSERT INTO referral_completions_v2
       (id,referral_code_id,referrer_family_id,referrer_parent_id,referrer_child_user_id,
        referee_family_id,referee_parent_id,status,reward_credits,created_at,updated_at)
     VALUES ('delete-completion','delete-code','delete-f-a','delete-p-a','delete-c-a',
       'delete-f-b','delete-p-b','pending',50,?,?)`,
  ).run("2026-08-01 00:00:00.000+00", "2026-08-01 00:00:00.000+00");

  const statements = await buildFamilyScopedDeleteStmts(db, ["delete-f-b"]);
  await db.batch(statements);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM referral_completions_v2").get().n, 0);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM referral_codes_v2").get().n, 1);
  sqlite.close();
});

test("추천 코드 발급은 실제 stream 4KiB 상한·JSON object·단일 키를 강제한다", async () => {
  const { sqlite, db } = createDb();
  const app = createApp();
  for (const userId of ["body-parent", "body-child"]) addUser(sqlite, userId);
  addFamily(sqlite, {
    familyId: "body-family",
    parentId: "body-parent",
    childUserId: "body-child",
  });

  const oversized = await rawJsonRequest(
    app,
    db,
    "/api/referrals/code",
    "body-parent",
    "body-family",
    JSON.stringify({ rewardChildUserId: "body-child", padding: "x".repeat(4_096) }),
    { "content-length": "2" },
  );
  assert.equal(oversized.status, 413);
  assert.deepEqual(await oversized.json(), { error: "referral_payload_too_large" });

  const malformed = await rawJsonRequest(
    app,
    db,
    "/api/referrals/code",
    "body-parent",
    "body-family",
    "{",
  );
  assert.equal(malformed.status, 400);
  assert.deepEqual(await malformed.json(), { error: "invalid_json_payload" });

  for (const invalidBody of [
    [],
    { rewardChildUserId: "body-child", unexpected: true },
    { rewardChildUserId: "x".repeat(129) },
  ]) {
    const invalid = await jsonRequest(
      app,
      db,
      "/api/referrals/code",
      "body-parent",
      "body-family",
      invalidBody,
    );
    assert.equal(invalid.status, 400);
    assert.deepEqual(await invalid.json(), { error: "referral_reward_child_invalid" });
  }
  sqlite.close();
});

test("family/setup은 referralCode 정확한 키와 22자 공개 코드 형식만 허용한다", async () => {
  const { sqlite, db } = createDb();
  const app = createApp();
  for (const userId of ["setup-referrer", "setup-child", "setup-new-a", "setup-new-b"]) {
    addUser(sqlite, userId);
  }
  addFamily(sqlite, {
    familyId: "setup-referrer-family",
    parentId: "setup-referrer",
    childUserId: "setup-child",
  });

  for (const [parentId, body] of [
    ["setup-new-a", { parentName: "새 보호자", referralCode: "HYENI-" + "A".repeat(17) }],
    ["setup-new-b", { parentName: "새 보호자", referral_code: "HYENI-23456789ABCDEFGH" }],
  ]) {
    const response = await jsonRequest(app, db, "/api/family/setup", parentId, null, body);
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: "referral_code_invalid" });
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM families WHERE parent_id=?").get(parentId).n, 0);
  }
  sqlite.close();
});

test("신규 가족 setup만 추천을 한 번 원자 귀속하고 기존·self·공동 보호자는 차단한다", async () => {
  const { sqlite, db } = createDb();
  const app = createApp();
  for (const userId of ["referrer-parent", "referrer-child", "new-parent", "existing-parent", "co-parent"]) {
    addUser(sqlite, userId);
  }
  addFamily(sqlite, {
    familyId: "referrer-family",
    parentId: "referrer-parent",
    childUserId: "referrer-child",
    coParentId: "co-parent",
  });
  addFamily(sqlite, { familyId: "existing-family", parentId: "existing-parent" });

  const codeResponse = await jsonRequest(
    app,
    db,
    "/api/referrals/code",
    "referrer-parent",
    "referrer-family",
    { rewardChildUserId: "referrer-child" },
  );
  assert.equal(codeResponse.status, 200);
  const { code } = await codeResponse.json();
  assert.match(code, /^HYENI-[0-9A-HJKMNP-TV-Z]{16}$/);

  const setup = await jsonRequest(
    app,
    db,
    "/api/family/setup",
    "new-parent",
    null,
    { parentName: "새 보호자", referralCode: code },
  );
  assert.equal(setup.status, 200, JSON.stringify(await setup.clone().json()));
  const created = await setup.json();
  assert.equal(
    sqlite.prepare("SELECT referred_by_family_id FROM families WHERE id=?").get(created.id).referred_by_family_id,
    "referrer-family",
  );
  assert.deepEqual(
    { ...sqlite.prepare(
      `SELECT referrer_family_id,referee_family_id,referee_parent_id,status,reward_credits
         FROM referral_completions_v2 WHERE referee_family_id=?`,
    ).get(created.id) },
    {
      referrer_family_id: "referrer-family",
      referee_family_id: created.id,
      referee_parent_id: "new-parent",
      status: "pending",
      reward_credits: 50,
    },
  );

  for (const [parentId, familyId] of [
    ["referrer-parent", "referrer-family"],
    ["existing-parent", "existing-family"],
    ["co-parent", "referrer-family"],
  ]) {
    const blocked = await jsonRequest(
      app,
      db,
      "/api/family/setup",
      parentId,
      familyId,
      { parentName: "차단 대상", referralCode: code },
    );
    assert.equal(blocked.status, 409);
    assert.match(String((await blocked.json()).error), /^referral_(?:self|existing_family|co_parent)_forbidden$/);
  }
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM referral_completions_v2").get().n, 1);
  sqlite.close();
});

test("72시간·이력 전용 첫 위치·48시간 이후 최신 위치를 충족한 뒤 양측에 약속한 50회만 원자·멱등 지급한다", async () => {
  const { sqlite, db } = createDb();
  const app = createApp();
  for (const userId of ["referrer-parent", "referrer-child", "referee-parent", "referee-child"]) {
    addUser(sqlite, userId);
  }
  addFamily(sqlite, {
    familyId: "referrer-family",
    parentId: "referrer-parent",
    childUserId: "referrer-child",
  });
  const codeResponse = await jsonRequest(
    app,
    db,
    "/api/referrals/code",
    "referrer-parent",
    "referrer-family",
    { rewardChildUserId: "referrer-child" },
  );
  const { code } = await codeResponse.json();
  const setup = await jsonRequest(
    app,
    db,
    "/api/family/setup",
    "referee-parent",
    null,
    { parentName: "친구 보호자", referralCode: code },
  );
  assert.equal(setup.status, 200, JSON.stringify(await setup.clone().json()));
  const { id: refereeFamilyId } = await setup.json();
  sqlite.prepare(
    "UPDATE referral_completions_v2 SET created_at=?,updated_at=? WHERE referee_family_id=?",
  ).run("2026-08-01 00:00:00.000+00", "2026-08-01 00:00:00.000+00", refereeFamilyId);
  sqlite.prepare(
    `INSERT INTO family_members(id,family_id,user_id,role,name,is_active,child_order,created_at)
     VALUES ('referee-child-member',?,?,'child','친구 아이',1,1,'2026-08-01 00:30:00.000+00')`,
  ).run(refereeFamilyId, "referee-child");
  for (const recordedAt of [
    "2026-08-01 01:00:00.000+00",
    "2026-08-03 01:00:00.000+00",
  ]) {
    sqlite.prepare(
      `INSERT INTO location_history(user_id,family_id,lat,lng,recorded_at,is_estimated,accuracy_m)
       VALUES (?,?,37.5,127.0,?,1,15)`,
    ).run("referee-child", refereeFamilyId, recordedAt);
  }
  const estimatedOnly = await processPendingReferralRewards(environment(db), {
    now: new Date("2026-08-04T00:00:00.000Z"),
    limit: 10,
  });
  assert.deepEqual(estimatedOnly, { scanned: 0, rewarded: 0, rejected: 0, pending: 0, failed: 0 });
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM ai_credit_ledger").get().n, 0);
  assert.deepEqual(
    { ...sqlite.prepare(
      `SELECT referee_child_user_id,first_location_at,latest_location_at
         FROM referral_completions_v2 WHERE referee_family_id=?`,
    ).get(refereeFamilyId) },
    { referee_child_user_id: null, first_location_at: null, latest_location_at: null },
  );

  sqlite.prepare(
    `INSERT INTO location_history(user_id,family_id,lat,lng,recorded_at,is_estimated,accuracy_m)
     VALUES (?,?,37.5,127.0,'2026-08-01 01:00:00.000+00',0,15)`,
  ).run("referee-child", refereeFamilyId);
  assert.deepEqual(
    { ...sqlite.prepare(
      `SELECT referee_child_user_id,first_location_at,latest_location_at
         FROM referral_completions_v2 WHERE referee_family_id=?`,
    ).get(refereeFamilyId) },
    {
      referee_child_user_id: "referee-child",
      first_location_at: "2026-08-01 01:00:00.000+00",
      latest_location_at: "2026-08-01 01:00:00.000+00",
    },
  );

  sqlite.prepare(
    "UPDATE referral_completions_v2 SET updated_at='intermediate-marker' WHERE referee_family_id=?",
  ).run(refereeFamilyId);
  sqlite.prepare(
    `INSERT INTO location_history(user_id,family_id,lat,lng,recorded_at,is_estimated,accuracy_m)
     VALUES (?,?,37.5,127.0,'2026-08-02 01:00:00.000+00',0,15)`,
  ).run("referee-child", refereeFamilyId);
  assert.deepEqual(
    { ...sqlite.prepare(
      `SELECT latest_location_at,updated_at
         FROM referral_completions_v2 WHERE referee_family_id=?`,
    ).get(refereeFamilyId) },
    { latest_location_at: "2026-08-01 01:00:00.000+00", updated_at: "intermediate-marker" },
  );

  const tooEarly = await processPendingReferralRewards(environment(db), {
    now: new Date("2026-08-03T23:59:59.000Z"),
    limit: 10,
  });
  assert.equal(tooEarly.rewarded, 0);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM ai_credit_ledger").get().n, 0);

  sqlite.prepare(
    `INSERT INTO location_history(user_id,family_id,lat,lng,recorded_at,is_estimated,accuracy_m)
     VALUES (?,?,37.5,127.0,'2026-08-03 01:00:00.000+00',0,15)`,
  ).run("referee-child", refereeFamilyId);
  db.resetQueryCount();
  const granted = await processPendingReferralRewards(environment(db), {
    now: new Date("2026-08-04T00:01:00.000Z"),
    limit: 10,
  });
  assert.deepEqual(granted, { scanned: 1, rewarded: 1, rejected: 0, pending: 0, failed: 0 });
  assert.equal(db.queryCount, 28, "후보 1건 성공 경로의 D1 statement 예산이 바뀌었습니다");
  assert.deepEqual(
    { ...sqlite.prepare(
      "SELECT child_user_id,purchased_credits FROM ai_credit_balances WHERE family_id=?",
    ).get(refereeFamilyId) },
    { child_user_id: "referee-child", purchased_credits: 50 },
  );
  assert.deepEqual(
    { ...sqlite.prepare(
      "SELECT child_user_id,purchased_credits FROM ai_credit_balances WHERE family_id='referrer-family'",
    ).get() },
    { child_user_id: "referrer-child", purchased_credits: 50 },
  );
  assert.deepEqual(
    sqlite.prepare("SELECT delta,reason,source FROM ai_credit_ledger ORDER BY id").all().map((row) => ({ ...row })),
    [
      { delta: 50, reason: "referral_reward", source: "referral_reward" },
      { delta: 50, reason: "referral_reward", source: "referral_reward" },
    ],
  );
  assert.equal(
    sqlite.prepare("SELECT status FROM referral_completions_v2").get().status,
    "rewarded",
  );
  assert.equal(
    sqlite.prepare("SELECT successful_referrals FROM referral_codes_v2").get().successful_referrals,
    1,
  );

  const retry = await processPendingReferralRewards(environment(db), {
    now: new Date("2026-08-04T00:02:00.000Z"),
    limit: 10,
  });
  assert.equal(retry.rewarded, 0);
  assert.equal(sqlite.prepare("SELECT SUM(delta) AS n FROM ai_credit_ledger").get().n, 100);
  assert.equal(sqlite.prepare("SELECT SUM(purchased_credits) AS n FROM ai_credit_balances").get().n, 100);
  sqlite.close();
});

test("가입이 아니라 첫 실제 위치부터 48시간이 지난 뒤에만 지급한다", async () => {
  const { sqlite, db } = createDb();
  for (const userId of ["late-p-a", "late-c-a", "late-p-b", "late-c-b"]) addUser(sqlite, userId);
  addFamily(sqlite, { familyId: "late-f-a", parentId: "late-p-a", childUserId: "late-c-a" });
  addFamily(sqlite, { familyId: "late-f-b", parentId: "late-p-b", childUserId: "late-c-b" });
  sqlite.prepare(
    `INSERT INTO referral_codes_v2
       (id,family_id,owner_parent_id,reward_child_user_id,code,status,created_at,updated_at)
     VALUES ('late-code','late-f-a','late-p-a','late-c-a','HYENI-3456789ABCDEFGHJ','active',?,?)`,
  ).run("2026-08-01 00:00:00.000+00", "2026-08-01 00:00:00.000+00");
  sqlite.prepare(
    `INSERT INTO referral_completions_v2
       (id,referral_code_id,referrer_family_id,referrer_parent_id,referrer_child_user_id,
        referee_family_id,referee_parent_id,referee_child_user_id,status,reward_credits,
        first_location_at,latest_location_at,created_at,updated_at)
     VALUES ('late-completion','late-code','late-f-a','late-p-a','late-c-a',
       'late-f-b','late-p-b','late-c-b','pending',50,NULL,NULL,?,?)`,
  ).run(
    "2026-08-01 00:00:00.000+00",
    "2026-08-01 00:00:00.000+00",
  );
  sqlite.prepare(
    `INSERT INTO child_locations(user_id,family_id,lat,lng,updated_at,accuracy_m)
     VALUES ('late-c-b','late-f-b',37.5,127.0,'2026-08-02 23:00:00.000+00',15)`,
  ).run();
  sqlite.prepare(
    "UPDATE child_locations SET updated_at='2026-08-03 01:00:00.000+00' WHERE user_id='late-c-b'",
  ).run();

  const onlyTwoHours = await processPendingReferralRewards(environment(db), {
    now: new Date("2026-08-04T00:01:00.000Z"),
    limit: 1,
  });
  assert.deepEqual(onlyTwoHours, { scanned: 0, rewarded: 0, rejected: 0, pending: 0, failed: 0 });
  assert.equal(sqlite.prepare("SELECT status FROM referral_completions_v2").get().status, "pending");
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM ai_credit_ledger").get().n, 0);

  sqlite.prepare(
    "UPDATE child_locations SET updated_at='2026-08-04 23:00:00.000+00' WHERE user_id='late-c-b'",
  ).run();
  const fullRetention = await processPendingReferralRewards(environment(db), {
    now: new Date("2026-08-05T00:01:00.000Z"),
    limit: 1,
  });
  assert.deepEqual(fullRetention, { scanned: 1, rewarded: 1, rejected: 0, pending: 0, failed: 0 });
  assert.equal(sqlite.prepare("SELECT SUM(delta) AS n FROM ai_credit_ledger").get().n, 100);
  sqlite.close();
});

test("위치가 없는 오래된 추천은 limit 1 cron에서 뒤의 자격 충족 추천 지급을 막지 않는다", async () => {
  const { sqlite, db } = createDb();
  for (const userId of [
    "fair-referrer-parent",
    "fair-referrer-child",
    "fair-stale-parent",
    "fair-ready-parent",
    "fair-ready-child",
  ]) addUser(sqlite, userId);
  addFamily(sqlite, {
    familyId: "fair-referrer-family",
    parentId: "fair-referrer-parent",
    childUserId: "fair-referrer-child",
  });
  addFamily(sqlite, {
    familyId: "fair-stale-family",
    parentId: "fair-stale-parent",
  });
  addFamily(sqlite, {
    familyId: "fair-ready-family",
    parentId: "fair-ready-parent",
    childUserId: "fair-ready-child",
  });
  sqlite.prepare(
    `INSERT INTO referral_codes_v2
       (id,family_id,owner_parent_id,reward_child_user_id,code,status,created_at,updated_at)
     VALUES ('fair-code','fair-referrer-family','fair-referrer-parent','fair-referrer-child',
             'HYENI-56789ABCDEFGHJKM','active',?,?)`,
  ).run("2026-08-01 00:00:00.000+00", "2026-08-01 00:00:00.000+00");
  sqlite.prepare(
    `INSERT INTO referral_completions_v2
       (id,referral_code_id,referrer_family_id,referrer_parent_id,referrer_child_user_id,
        referee_family_id,referee_parent_id,status,reward_credits,created_at,updated_at)
     VALUES ('fair-stale-completion','fair-code','fair-referrer-family','fair-referrer-parent',
             'fair-referrer-child','fair-stale-family','fair-stale-parent','pending',50,?,?)`,
  ).run("2026-08-01 00:00:00.000+00", "2026-08-01 00:00:00.000+00");
  sqlite.prepare(
    `INSERT INTO referral_completions_v2
       (id,referral_code_id,referrer_family_id,referrer_parent_id,referrer_child_user_id,
        referee_family_id,referee_parent_id,referee_child_user_id,status,reward_credits,
        created_at,updated_at)
     VALUES ('fair-ready-completion','fair-code','fair-referrer-family','fair-referrer-parent',
             'fair-referrer-child','fair-ready-family','fair-ready-parent','fair-ready-child',
             'pending',50,?,?)`,
  ).run("2026-08-01 01:00:00.000+00", "2026-08-01 01:00:00.000+00");
  sqlite.prepare(
    `INSERT INTO child_locations(user_id,family_id,lat,lng,updated_at,accuracy_m)
     VALUES ('fair-ready-child','fair-ready-family',37.5,127.0,'2026-08-01 02:00:00.000+00',15)`,
  ).run();
  sqlite.prepare(
    `UPDATE child_locations
        SET updated_at='2026-08-03 02:00:00.000+00'
      WHERE user_id='fair-ready-child'`,
  ).run();

  const result = await processPendingReferralRewards(environment(db), {
    now: new Date("2026-08-05T00:01:00.000Z"),
    limit: 1,
  });

  assert.deepEqual(result, { scanned: 1, rewarded: 1, rejected: 0, pending: 0, failed: 0 });
  assert.equal(
    sqlite.prepare("SELECT status FROM referral_completions_v2 WHERE id='fair-stale-completion'").get().status,
    "pending",
  );
  assert.equal(
    sqlite.prepare("SELECT status FROM referral_completions_v2 WHERE id='fair-ready-completion'").get().status,
    "rewarded",
  );
  assert.equal(sqlite.prepare("SELECT SUM(delta) AS n FROM ai_credit_ledger").get().n, 100);
  sqlite.close();
});

test("양측 지급 batch 중간 실패는 잔액·원장·상태·성공횟수를 모두 rollback한다", async () => {
  const { sqlite, db } = createDb();
  for (const userId of ["p-a", "c-a", "p-b", "c-b"]) addUser(sqlite, userId);
  addFamily(sqlite, { familyId: "f-a", parentId: "p-a", childUserId: "c-a" });
  addFamily(sqlite, { familyId: "f-b", parentId: "p-b", childUserId: "c-b" });
  sqlite.prepare(
    `INSERT INTO referral_codes_v2
       (id,family_id,owner_parent_id,reward_child_user_id,code,status,created_at,updated_at)
     VALUES ('code-a','f-a','p-a','c-a','HYENI-23456789ABCDEFGH','active',?,?)`,
  ).run("2026-08-01 00:00:00.000+00", "2026-08-01 00:00:00.000+00");
  sqlite.prepare(
    `INSERT INTO referral_completions_v2
       (id,referral_code_id,referrer_family_id,referrer_parent_id,referrer_child_user_id,
        referee_family_id,referee_parent_id,referee_child_user_id,status,reward_credits,
        first_location_at,latest_location_at,created_at,updated_at)
     VALUES ('completion-a','code-a','f-a','p-a','c-a','f-b','p-b','c-b','pending',50,
       '2026-08-01 01:00:00.000+00','2026-08-03 01:00:00.000+00',?,?)`,
  ).run("2026-08-01 00:00:00.000+00", "2026-08-03 01:00:00.000+00");
  sqlite.prepare(
    `INSERT INTO child_locations(user_id,family_id,lat,lng,updated_at,accuracy_m)
     VALUES ('c-b','f-b',37.5,127.0,'2026-08-01 01:00:00.000+00',15)`,
  ).run();
  sqlite.prepare(
    "UPDATE child_locations SET updated_at='2026-08-03 01:00:00.000+00' WHERE user_id='c-b'",
  ).run();

  db.failSql = /referral:completion-a:referee/;
  const result = await processPendingReferralRewards(environment(db), {
    now: new Date("2026-08-04T00:01:00.000Z"),
    limit: 10,
  });
  assert.equal(result.failed, 1);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM ai_credit_balances").get().n, 0);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM ai_credit_ledger").get().n, 0);
  assert.equal(sqlite.prepare("SELECT status FROM referral_completions_v2").get().status, "pending");
  assert.equal(sqlite.prepare("SELECT successful_referrals FROM referral_codes_v2").get().successful_referrals, 0);
  sqlite.close();
});

test("두 가족 mutation lease 획득 중 삭제 scope가 생기면 지급 없이 전부 release한다", async () => {
  const { sqlite, db } = createDb();
  for (const userId of ["race-p-a", "race-c-a", "race-p-b", "race-c-b"]) addUser(sqlite, userId);
  addFamily(sqlite, { familyId: "race-f-a", parentId: "race-p-a", childUserId: "race-c-a" });
  addFamily(sqlite, { familyId: "race-f-b", parentId: "race-p-b", childUserId: "race-c-b" });
  sqlite.prepare(
    `INSERT INTO referral_codes_v2
       (id,family_id,owner_parent_id,reward_child_user_id,code,status,created_at,updated_at)
     VALUES ('race-code','race-f-a','race-p-a','race-c-a','HYENI-456789ABCDEFGHJK','active',?,?)`,
  ).run("2026-08-01 00:00:00.000+00", "2026-08-01 00:00:00.000+00");
  sqlite.prepare(
    `INSERT INTO referral_completions_v2
       (id,referral_code_id,referrer_family_id,referrer_parent_id,referrer_child_user_id,
        referee_family_id,referee_parent_id,referee_child_user_id,status,reward_credits,
        first_location_at,latest_location_at,created_at,updated_at)
     VALUES ('race-completion','race-code','race-f-a','race-p-a','race-c-a',
       'race-f-b','race-p-b','race-c-b','pending',50,
       '2026-08-01 01:00:00.000+00','2026-08-03 01:00:00.000+00',?,?)`,
  ).run("2026-08-01 00:00:00.000+00", "2026-08-03 01:00:00.000+00");
  sqlite.prepare(
    `INSERT INTO child_locations(user_id,family_id,lat,lng,updated_at,accuracy_m)
     VALUES ('race-c-b','race-f-b',37.5,127.0,'2026-08-01 01:00:00.000+00',15)`,
  ).run();
  sqlite.prepare(
    "UPDATE child_locations SET updated_at='2026-08-03 01:00:00.000+00' WHERE user_id='race-c-b'",
  ).run();

  let injected = false;
  db.beforeRun = async (sql, bindings) => {
    if (
      !injected
      && /INSERT INTO account_mutation_leases/.test(sql)
      && bindings[1] === "race-c-b"
    ) {
      injected = true;
      sqlite.prepare(
        `INSERT INTO account_deletion_scopes(job_id,scope_type,scope_id,created_at)
         VALUES ('race-delete','family','race-f-b','2026-08-04 00:00:00.000+00')`,
      ).run();
    }
  };
  const result = await processPendingReferralRewards(environment(db), {
    now: new Date("2026-08-04T00:01:00.000Z"),
    limit: 1,
  });
  assert.equal(injected, true);
  assert.deepEqual(result, { scanned: 1, rewarded: 0, rejected: 0, pending: 0, failed: 1 });
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM account_mutation_leases").get().n, 0);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM ai_credit_ledger").get().n, 0);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM ai_credit_balances").get().n, 0);
  assert.equal(sqlite.prepare("SELECT status FROM referral_completions_v2").get().status, "pending");
  sqlite.close();
});

test("초대 가족 수 상한이 없어 네 번째 가족도 그대로 귀속된다", async () => {
  const { sqlite, db } = createDb();
  const app = createApp();
  for (const userId of ["cap-parent", "cap-child", "fourth-parent"]) addUser(sqlite, userId);
  addFamily(sqlite, { familyId: "cap-family", parentId: "cap-parent", childUserId: "cap-child" });
  sqlite.prepare(
    `INSERT INTO referral_codes_v2
       (id,family_id,owner_parent_id,reward_child_user_id,code,status,successful_referrals,created_at,updated_at)
     VALUES ('cap-code','cap-family','cap-parent','cap-child','HYENI-23456789ABCDEFGH','active',3,?,?)`,
  ).run("2026-08-01 00:00:00.000+00", "2026-08-01 00:00:00.000+00");

  const accepted = await jsonRequest(
    app,
    db,
    "/api/family/setup",
    "fourth-parent",
    null,
    { parentName: "네 번째", referralCode: "HYENI-23456789ABCDEFGH" },
  );
  assert.equal(accepted.status, 200, JSON.stringify(await accepted.clone().json()));
  const created = await accepted.json();
  assert.equal(
    sqlite.prepare("SELECT referred_by_family_id FROM families WHERE id=?").get(created.id).referred_by_family_id,
    "cap-family",
  );
  assert.deepEqual(
    { ...sqlite.prepare(
      "SELECT status,reward_credits FROM referral_completions_v2 WHERE referee_family_id=?",
    ).get(created.id) },
    { status: "pending", reward_credits: 50 },
  );
  sqlite.close();
});
