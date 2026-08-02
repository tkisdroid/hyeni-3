import test, { after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { dirname, extname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath, pathToFileURL } from "node:url";

const workerDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
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

const entitlementPolicy = await import("../shared/subscriptionEntitlement.js");
const authz = await import(pathToFileURL(resolve(workerDir, "db/authz.ts")).href);
const pushNotify = await import(pathToFileURL(resolve(workerDir, "routes/push-notify.ts")).href);

class D1StatementAdapter {
  constructor(db, sql, bindings = []) {
    this.db = db;
    this.sql = sql;
    this.bindings = bindings;
  }

  bind(...bindings) {
    return new D1StatementAdapter(this.db, this.sql, bindings);
  }

  async first() {
    return this.db.prepare(this.sql).get(...this.bindings) ?? null;
  }

  async all() {
    return { results: this.db.prepare(this.sql).all(...this.bindings) };
  }
}

class D1DatabaseAdapter {
  constructor(db) {
    this.db = db;
  }

  prepare(sql) {
    return new D1StatementAdapter(this.db, sql);
  }
}

function createDb() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`
    CREATE TABLE families(
      id TEXT PRIMARY KEY,
      user_tier TEXT NOT NULL DEFAULT 'free',
      subscription_tier TEXT NOT NULL DEFAULT 'free',
      registered_place_alerts_enabled INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE family_subscription(
      family_id TEXT PRIMARY KEY,
      status TEXT,
      trial_ends_at TEXT,
      current_period_end TEXT,
      remote_listen_enabled INTEGER DEFAULT 1
    );
    CREATE TABLE subscriptions(
      id TEXT PRIMARY KEY,
      family_id TEXT NOT NULL,
      status TEXT NOT NULL,
      expires_at TEXT
    );
    CREATE TABLE family_review_rewards(
      family_id TEXT PRIMARY KEY,
      granted_at TEXT NOT NULL
    );
    CREATE TABLE push_idempotency(
      key TEXT PRIMARY KEY,
      created_at TEXT NOT NULL,
      first_sent_at TEXT,
      family_id TEXT,
      action TEXT
    );
    CREATE TABLE force_ring_events(
      family_id TEXT NOT NULL,
      triggered_at TEXT NOT NULL,
      delivered_at TEXT,
      stop_reason TEXT
    );
  `);
  return { sqlite, db: new D1DatabaseAdapter(sqlite) };
}

function insertFamily(sqlite, familyId, userTier = "free", subscriptionTier = "free") {
  sqlite.prepare("INSERT INTO families(id,user_tier,subscription_tier) VALUES (?,?,?)")
    .run(familyId, userTier, subscriptionTier);
}

test("공통 resolver는 Free/Premium 두 티어와 reviewed grandfather를 분리한다", async () => {
  assert.equal(typeof entitlementPolicy.resolveFamilyEntitlement, "function");
  const { sqlite, db } = createDb();
  const now = new Date("2026-08-01T00:00:00.000Z");

  insertFamily(sqlite, "family-free");
  insertFamily(sqlite, "family-reviewed");
  insertFamily(sqlite, "family-premium");
  sqlite.prepare("INSERT INTO family_review_rewards VALUES (?,?)")
    .run("family-reviewed", "2026-07-01 00:00:00+00");
  sqlite.prepare("INSERT INTO family_subscription VALUES (?,?,?,?,?)")
    .run("family-premium", "active", null, "2026-09-01 00:00:00+00", 0);

  assert.deepEqual(
    await entitlementPolicy.resolveFamilyEntitlement(db, "family-free", now),
    {
      tier: "free",
      isPremium: false,
      source: "free",
      hasGrandfatheredReviewLimits: false,
      remoteListenEnabled: true,
    },
  );
  assert.deepEqual(
    await entitlementPolicy.resolveFamilyEntitlement(db, "family-reviewed", now),
    {
      tier: "free",
      isPremium: false,
      source: "free",
      hasGrandfatheredReviewLimits: true,
      remoteListenEnabled: true,
    },
  );
  assert.deepEqual(
    await entitlementPolicy.resolveFamilyEntitlement(db, "family-premium", now),
    {
      tier: "premium",
      isPremium: true,
      source: "family_subscription",
      hasGrandfatheredReviewLimits: false,
      remoteListenEnabled: false,
    },
  );
  sqlite.close();
});

test("만료 가족 구독은 legacy를 막되 유효 child 구독 호환은 유지한다", async () => {
  const { sqlite, db } = createDb();
  const now = new Date("2026-08-01T00:00:00.000Z");

  insertFamily(sqlite, "family-legacy", "premium", "premium");
  insertFamily(sqlite, "family-expired", "premium", "premium");
  insertFamily(sqlite, "family-child", "premium", "premium");
  insertFamily(sqlite, "family-child-expired");
  sqlite.prepare("INSERT INTO family_subscription VALUES (?,?,?,?,?)")
    .run("family-expired", "cancelled", null, "2026-07-31 23:59:59+00", 1);
  sqlite.prepare("INSERT INTO family_subscription VALUES (?,?,?,?,?)")
    .run("family-child", "expired", null, "2026-07-01 00:00:00+00", 1);
  sqlite.prepare("INSERT INTO subscriptions VALUES (?,?,?,?)")
    .run("sub-child", "family-child", " Grace ", "2026-08-10 00:00:00+00");
  sqlite.prepare("INSERT INTO subscriptions VALUES (?,?,?,?)")
    .run("sub-child-expired", "family-child-expired", "active", "2026-07-01 00:00:00+00");

  assert.equal((await entitlementPolicy.resolveFamilyEntitlement(db, "family-legacy", now)).source, "legacy_family");
  assert.equal((await entitlementPolicy.resolveFamilyEntitlement(db, "family-legacy", now)).tier, "premium");
  assert.equal((await entitlementPolicy.resolveFamilyEntitlement(db, "family-expired", now)).tier, "free");
  assert.equal((await entitlementPolicy.resolveFamilyEntitlement(db, "family-child", now)).source, "child_subscription");
  assert.equal((await entitlementPolicy.resolveFamilyEntitlement(db, "family-child", now)).tier, "premium");
  assert.equal((await entitlementPolicy.resolveFamilyEntitlement(db, "family-child-expired", now)).tier, "free");
  sqlite.close();
});

test("공통 resolver의 D1 오류는 typed 503으로 fail-closed한다", async () => {
  const failingDb = { prepare: () => { throw new Error("D1 unavailable"); } };
  await assert.rejects(
    entitlementPolicy.resolveFamilyEntitlement(failingDb, "family-a"),
    (error) => error?.code === "family_entitlement_unavailable" && error?.status === 503,
  );
  await assert.rejects(
    authz.isFamilyPremium(failingDb, "family-a"),
    (error) => error?.code === "family_entitlement_unavailable" && error?.status === 503,
  );
});

test("optional review 조회 오류는 grandfather만 닫고 유효 Premium을 강등하지 않는다", async () => {
  const { sqlite, db } = createDb();
  insertFamily(sqlite, "family-premium");
  sqlite.prepare("INSERT INTO family_subscription VALUES (?,?,?,?,?)")
    .run("family-premium", "active", null, "2099-01-01 00:00:00+00", 1);
  const reviewFailingDb = {
    prepare(sql) {
      if (sql.includes("family_review_rewards")) throw new Error("review table unavailable");
      return db.prepare(sql);
    },
  };

  assert.deepEqual(
    await entitlementPolicy.resolveFamilyEntitlement(reviewFailingDb, "family-premium"),
    {
      tier: "premium",
      isPremium: true,
      source: "family_subscription",
      hasGrandfatheredReviewLimits: false,
      remoteListenEnabled: true,
    },
  );
  sqlite.close();
});

test("서버 서비스 한도는 일정 무제한·Free 장소 2·reviewed 장소 3을 강제한다", async () => {
  const { sqlite, db } = createDb();
  insertFamily(sqlite, "family-free");
  insertFamily(sqlite, "family-reviewed");
  insertFamily(sqlite, "family-premium");
  sqlite.prepare("INSERT INTO family_review_rewards VALUES (?,?)")
    .run("family-reviewed", "2026-07-01 00:00:00+00");
  sqlite.prepare("INSERT INTO family_subscription VALUES (?,?,?,?,?)")
    .run("family-premium", "active", null, "2099-01-01 00:00:00+00", 1);

  for (const familyId of ["", "unknown-family", "family-free", "family-reviewed", "family-premium"]) {
    assert.equal(await authz.serviceLimitForFamily(db, familyId, "schedule"), null);
  }
  assert.equal(await authz.serviceLimitForFamily(db, "family-free", "saved_place"), 2);
  assert.equal(await authz.serviceLimitForFamily(db, "family-reviewed", "saved_place"), 3);
  assert.equal(await authz.serviceLimitForFamily(db, "family-premium", "saved_place"), null);
  assert.equal(await authz.serviceLimitForFamily(db, "family-free", "danger_zone"), 1);
  assert.equal(await authz.serviceLimitForFamily(db, "family-reviewed", "danger_zone"), 1);
  assert.equal(await authz.serviceLimitForFamily(db, "family-premium", "danger_zone"), null);
  sqlite.close();
});

test("premium SQL도 API resolver와 같은 expiry·child·legacy 우선순위를 사용한다", () => {
  assert.equal(typeof entitlementPolicy.premiumFamilyEntitlementSql, "function");
  const premiumSql = entitlementPolicy.premiumFamilyEntitlementSql("f");
  assert.match(premiumSql, /\bUNION\b/);
  assert.doesNotMatch(
    premiumSql,
    /entitlement_cs\.family_id\s*=\s*f\.id/,
    "cron 전체 가족 조회에서 subscriptions를 가족마다 반복 스캔하지 않는다",
  );
  const { sqlite } = createDb();
  const future = new Date(Date.now() + 24 * 60 * 60_000).toISOString();
  const past = new Date(Date.now() - 24 * 60 * 60_000).toISOString();

  insertFamily(sqlite, "family-sub");
  insertFamily(sqlite, "family-legacy", "premium", "free");
  insertFamily(sqlite, "family-expired", "premium", "premium");
  insertFamily(sqlite, "family-child");
  sqlite.prepare("INSERT INTO family_subscription VALUES (?,?,?,?,?)")
    .run("family-sub", " Trial ", future, null, 1);
  sqlite.prepare("INSERT INTO family_subscription VALUES (?,?,?,?,?)")
    .run("family-expired", "expired", null, past, 1);
  sqlite.prepare("INSERT INTO subscriptions VALUES (?,?,?,?)")
    .run("sub-child", "family-child", "active", future);

  const rows = sqlite.prepare(
    `SELECT f.id FROM families f
      WHERE ${premiumSql}
      ORDER BY f.id`,
  ).all();
  assert.deepEqual(rows.map((row) => row.id), ["family-child", "family-legacy", "family-sub"]);
  sqlite.close();
});

test("일반 API·위치·주변소리·cron은 공통 resolver 모듈을 참조한다", () => {
  const source = (path) => readFileSync(resolve(workerDir, path), "utf8");
  assert.match(source("routes/entitlement.ts"), /resolveFamilyEntitlement/);
  assert.match(source("db/authz.ts"), /resolveFamilyEntitlement/);
  assert.match(source("routes/push-notify.ts"), /resolveFamilyEntitlement/);
  for (const path of [
    "cron/_geo.ts",
    "cron/location-staleness-check.ts",
    "cron/unregistered-stay-check.ts",
  ]) {
    assert.match(source(path), /premiumFamilyEntitlementSql/);
  }
  assert.match(
    source("index.ts"),
    /family_entitlement_unavailable[\s\S]+503/,
    "typed entitlement 오류는 전역에서 503으로 보존한다",
  );
});

test("AI 상태·크레딧 seed도 별도 구독 판정 없이 공통 resolver를 사용한다", () => {
  const source = (path) => readFileSync(resolve(workerDir, path), "utf8");
  for (const path of [
    "routes/ai-chat-data.ts",
    "routes/ai-child-chat.ts",
    "routes/ai-proactive.ts",
    "routes/ai.ts",
    "routes/google-play-verify.ts",
  ]) {
    const contents = source(path);
    assert.match(contents, /resolveFamilyEntitlement/, `${path} must use the common resolver`);
    assert.doesNotMatch(
      contents,
      /premiumSubscriptionSql|premiumChildSubscriptionSql|isPremiumChildSubscriptionState|isPremiumAiSubscriptionStatus/,
      `${path} must not maintain a second entitlement path`,
    );
  }

  const googlePlaySource = source("routes/google-play-verify.ts");
  assert.doesNotMatch(
    googlePlaySource,
    /is_premium\s*=\s*CASE\s+WHEN\s+is_premium\s*<>\s*0\s+OR/i,
    "만료된 Premium 캐시를 구매 시 영구 유지하지 않는다",
  );
  assert.match(googlePlaySource, /SET parent_id=\?,\s*is_premium=\?/s);
});

test("주변소리 gate는 child 호환 Premium·만료 억제·가족 kill switch를 공통 판정한다", async () => {
  assert.equal(typeof pushNotify.validateRemoteListenEntitlement, "function");
  const { sqlite, db } = createDb();
  insertFamily(sqlite, "family-child", "premium", "premium");
  insertFamily(sqlite, "family-expired", "premium", "premium");
  insertFamily(sqlite, "family-disabled");
  sqlite.prepare("INSERT INTO family_subscription VALUES (?,?,?,?,?)")
    .run("family-child", "expired", null, "2026-01-01 00:00:00+00", 1);
  sqlite.prepare("INSERT INTO subscriptions VALUES (?,?,?,?)")
    .run("sub-child", "family-child", "active", "2099-01-01 00:00:00+00");
  sqlite.prepare("INSERT INTO family_subscription VALUES (?,?,?,?,?)")
    .run("family-expired", "cancelled", null, "2026-01-01 00:00:00+00", 1);
  sqlite.prepare("INSERT INTO family_subscription VALUES (?,?,?,?,?)")
    .run("family-disabled", "active", null, "2099-01-01 00:00:00+00", 0);

  assert.equal(await pushNotify.validateRemoteListenEntitlement(db, "family-child"), null);
  const expired = await pushNotify.validateRemoteListenEntitlement(db, "family-expired");
  assert.equal(expired.status, 402);
  assert.deepEqual(await expired.json(), { error: "remote_listen_requires_premium" });
  const disabled = await pushNotify.validateRemoteListenEntitlement(db, "family-disabled");
  assert.equal(disabled.status, 403);
  assert.deepEqual(await disabled.json(), { error: "remote_listen_disabled_by_family" });
  sqlite.close();
});

test("원격 소리 울리기 quota도 공통 Free/Premium 판정을 사용한다", async () => {
  const { sqlite, db } = createDb();
  insertFamily(sqlite, "family-free");
  insertFamily(sqlite, "family-child");
  sqlite.prepare("INSERT INTO subscriptions VALUES (?,?,?,?)")
    .run("sub-child", "family-child", "active", "2099-01-01 00:00:00+00");

  assert.deepEqual(
    await pushNotify.forceRingCheckQuota(db, "family-free"),
    { allowed: true, quota: 1, used: 0, tier: "free" },
  );
  assert.deepEqual(
    await pushNotify.forceRingCheckQuota(db, "family-child"),
    { allowed: true, quota: 10, used: 0, tier: "premium" },
  );
  sqlite.close();
});
