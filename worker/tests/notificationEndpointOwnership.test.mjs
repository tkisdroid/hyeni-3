import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

let ownership = {};
try {
  ownership = await import("../lib/notificationEndpointOwnership.ts");
} catch (error) {
  if (error?.code !== "ERR_MODULE_NOT_FOUND") throw error;
}

class Statement {
  constructor(db, sql, bindings = []) {
    this.db = db;
    this.sql = sql;
    this.bindings = bindings;
  }

  bind(...bindings) {
    return new Statement(this.db, this.sql, bindings);
  }

  async run() {
    const result = this.db.prepare(this.sql).run(...this.bindings);
    return { success: true, meta: { changes: Number(result.changes) }, results: [] };
  }

  async first() {
    return this.db.prepare(this.sql).get(...this.bindings) ?? null;
  }
}

function createOwnershipDb() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`
    CREATE TABLE fcm_tokens(
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      family_id TEXT NOT NULL,
      fcm_token TEXT NOT NULL,
      created_at TEXT,
      updated_at TEXT,
      platform TEXT NOT NULL DEFAULT 'android',
      registration_instance_id TEXT NOT NULL,
      disabled_at TEXT,
      disabled_reason TEXT
    );
    CREATE UNIQUE INDEX idx_fcm_tokens_token_active_unique
      ON fcm_tokens(fcm_token) WHERE disabled_at IS NULL;

    CREATE TABLE push_subscriptions(
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      family_id TEXT NOT NULL,
      endpoint TEXT NOT NULL,
      subscription TEXT NOT NULL,
      created_at TEXT,
      updated_at TEXT,
      registration_instance_id TEXT NOT NULL,
      disabled_at TEXT,
      disabled_reason TEXT
    );
    CREATE UNIQUE INDEX idx_push_subscriptions_endpoint_active_unique
      ON push_subscriptions(endpoint) WHERE disabled_at IS NULL;
  `);
  return {
    sqlite,
    db: { prepare: (sql) => new Statement(sqlite, sql) },
  };
}

function api() {
  assert.equal(typeof ownership.upsertFcmTokenOwnership, "function", "FCM 원자 upsert helper가 필요합니다");
  assert.equal(typeof ownership.unregisterOwnedFcmToken, "function", "FCM 현재 소유자 unregister helper가 필요합니다");
  assert.equal(typeof ownership.refreshLegacyFcmTokenOwnership, "function", "구버전 FCM 제한 갱신 helper가 필요합니다");
  assert.equal(typeof ownership.upsertPushSubscriptionOwnership, "function", "웹 푸시 원자 upsert helper가 필요합니다");
  assert.equal(typeof ownership.unregisterOwnedPushSubscription, "function", "웹 푸시 exact unregister helper가 필요합니다");
  assert.equal(typeof ownership.isPushSubscriptionRegistrationCurrent, "function", "현재 웹 푸시 등록 세션 판정 helper가 필요합니다");
  return ownership;
}

test("endpoint ownership helper는 빈 token과 endpoint를 DB에 저장하지 않는다", async () => {
  const { db } = createOwnershipDb();
  const { upsertFcmTokenOwnership, upsertPushSubscriptionOwnership } = api();

  await assert.rejects(() => upsertFcmTokenOwnership(db, {
    id: "fcm-empty", userId: "user-a", familyId: "family-a", token: "  ",
    platform: "android", registrationInstanceId: "session-a", now: "2026-07-14T01:00:00.000Z",
  }), /invalid_fcm_token_ownership/);
  await assert.rejects(() => upsertPushSubscriptionOwnership(db, {
    id: "push-empty", userId: "user-a", familyId: "family-a", endpoint: "",
    subscription: "{}", registrationInstanceId: "session-a", now: "2026-07-14T01:00:00.000Z",
  }), /invalid_push_subscription_ownership/);

  await assert.rejects(() => upsertFcmTokenOwnership(db, {
    id: "fcm-no-session", userId: "user-a", familyId: "family-a", token: "token-a",
    platform: "android", registrationInstanceId: " ", now: "2026-07-14T01:00:00.000Z",
  }), /invalid_fcm_token_ownership/);
});

test("같은 FCM token의 타 사용자 이관과 오래된 로그인 덮어쓰기를 거부한다", async () => {
  const { sqlite, db } = createOwnershipDb();
  const { upsertFcmTokenOwnership } = api();

  assert.equal(await upsertFcmTokenOwnership(db, {
    id: "fcm-a", userId: "user-a", familyId: "family-a", token: "same-token",
    platform: "android", registrationInstanceId: "session-a", now: "2026-07-14T01:00:00.000Z",
  }), true);
  assert.equal(await upsertFcmTokenOwnership(db, {
    id: "fcm-b", userId: "user-b", familyId: "family-b", token: "same-token",
    platform: "android", registrationInstanceId: "session-b", now: "2026-07-14T01:01:00.000Z",
  }), false);
  assert.equal(await upsertFcmTokenOwnership(db, {
    id: "fcm-a-delayed", userId: "user-a", familyId: "family-a", token: "same-token",
    platform: "android", registrationInstanceId: "session-old", now: "2026-07-14T01:02:00.000Z",
  }), false);

  assert.deepEqual(
    { ...sqlite.prepare("SELECT user_id, family_id, registration_instance_id, COUNT(*) AS count FROM fcm_tokens WHERE fcm_token=? AND disabled_at IS NULL").get("same-token") },
    { user_id: "user-a", family_id: "family-a", registration_instance_id: "session-a", count: 1 },
  );
});

test("A 해제 뒤 B가 claim한 FCM token은 늦은 A upsert가 되돌리지 못한다", async () => {
  const { sqlite, db } = createOwnershipDb();
  const { upsertFcmTokenOwnership, unregisterOwnedFcmToken } = api();
  const token = "transferred-after-clean-unregister";
  assert.equal(await upsertFcmTokenOwnership(db, {
    id: "fcm-a", userId: "user-a", familyId: "family-a", token,
    platform: "android", registrationInstanceId: "session-a", now: "2026-07-14T01:00:00.000Z",
  }), true);
  assert.equal(await unregisterOwnedFcmToken(db, {
    token, userId: "user-a", registrationInstanceId: "session-a", now: "2026-07-14T01:01:00.000Z",
  }), true);
  assert.equal(await upsertFcmTokenOwnership(db, {
    id: "fcm-b", userId: "user-b", familyId: "family-b", token,
    platform: "android", registrationInstanceId: "session-b", now: "2026-07-14T01:02:00.000Z",
  }), true);
  assert.equal(await upsertFcmTokenOwnership(db, {
    id: "fcm-a-late", userId: "user-a", familyId: "family-a", token,
    platform: "android", registrationInstanceId: "session-a", now: "2026-07-14T01:03:00.000Z",
  }), false);

  assert.deepEqual(
    { ...sqlite.prepare("SELECT user_id, registration_instance_id FROM fcm_tokens WHERE fcm_token=? AND disabled_at IS NULL").get(token) },
    { user_id: "user-b", registration_instance_id: "session-b" },
  );
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM fcm_tokens WHERE fcm_token=?").get(token).count, 2);
});

test("exact unregister로 폐기된 등록 세션은 새 소유자가 없어도 늦은 upsert로 부활하지 않는다", async () => {
  const { sqlite, db } = createOwnershipDb();
  const {
    unregisterOwnedFcmToken,
    unregisterOwnedPushSubscription,
    upsertFcmTokenOwnership,
    upsertPushSubscriptionOwnership,
  } = api();
  const endpoint = "https://push.example/retired-session";
  assert.equal(await upsertFcmTokenOwnership(db, {
    id: "fcm-old", userId: "user-a", familyId: "family-a", token: "retired-token",
    platform: "android", registrationInstanceId: "session-old", now: "2026-07-14T01:00:00.000Z",
  }), true);
  assert.equal(await upsertPushSubscriptionOwnership(db, {
    id: "push-old", userId: "user-a", familyId: "family-a", endpoint,
    subscription: "{}", registrationInstanceId: "session-old", now: "2026-07-14T01:00:00.000Z",
  }), true);
  await unregisterOwnedFcmToken(db, {
    token: "retired-token", userId: "user-a", registrationInstanceId: "session-old",
    now: "2026-07-14T01:01:00.000Z",
  });
  await unregisterOwnedPushSubscription(db, {
    endpoint, userId: "user-a", registrationInstanceId: "session-old",
    now: "2026-07-14T01:01:00.000Z",
  });

  assert.equal(await upsertFcmTokenOwnership(db, {
    id: "fcm-delayed", userId: "user-a", familyId: "family-a", token: "retired-token",
    platform: "android", registrationInstanceId: "session-old", now: "2026-07-14T01:02:00.000Z",
  }), false);
  assert.equal(await upsertPushSubscriptionOwnership(db, {
    id: "push-delayed", userId: "user-a", familyId: "family-a", endpoint,
    subscription: "{}", registrationInstanceId: "session-old", now: "2026-07-14T01:02:00.000Z",
  }), false);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM fcm_tokens WHERE fcm_token=? AND disabled_at IS NULL").get("retired-token").count, 0);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM push_subscriptions WHERE endpoint=? AND disabled_at IS NULL").get(endpoint).count, 0);
});

test("FCM unregister는 exact 활성 행만 비파괴 비활성화한다", async () => {
  const { sqlite, db } = createOwnershipDb();
  const { upsertFcmTokenOwnership, unregisterOwnedFcmToken } = api();
  await upsertFcmTokenOwnership(db, {
    id: "fcm-a", userId: "user-a", familyId: "family-a", token: "owned-token",
    platform: "android", registrationInstanceId: "session-old", now: "2026-07-14T01:00:00.000Z",
  });
  assert.equal(await unregisterOwnedFcmToken(db, {
    token: "owned-token", userId: "user-a", registrationInstanceId: "wrong-session",
    now: "2026-07-14T01:01:00.000Z",
  }), false);
  assert.equal(await unregisterOwnedFcmToken(db, {
    token: "owned-token", userId: "user-a", registrationInstanceId: "session-old",
    now: "2026-07-14T01:02:00.000Z",
  }), true);
  assert.deepEqual(
    { ...sqlite.prepare("SELECT disabled_at, disabled_reason FROM fcm_tokens WHERE fcm_token=?").get("owned-token") },
    { disabled_at: "2026-07-14T01:02:00.000Z", disabled_reason: "session_unregistered" },
  );
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM fcm_tokens").get().count, 1);
});

test("웹 푸시 endpoint는 같은 등록 세션만 갱신하고 stale/타 사용자 탈취를 거부한다", async () => {
  const { sqlite, db } = createOwnershipDb();
  const {
    isPushSubscriptionRegistrationCurrent,
    upsertPushSubscriptionOwnership,
    unregisterOwnedPushSubscription,
  } = api();
  const endpoint = "https://push.example/subscription-a";

  assert.equal(await upsertPushSubscriptionOwnership(db, {
    id: "push-a", userId: "user-a", familyId: "family-a", endpoint,
    subscription: "{\"version\":1}", registrationInstanceId: "session-old", now: "2026-07-14T01:00:00.000Z",
  }), true);
  assert.equal(await upsertPushSubscriptionOwnership(db, {
    id: "push-a2", userId: "user-a", familyId: "family-a", endpoint,
    subscription: "{\"version\":2}", registrationInstanceId: "session-new", now: "2026-07-14T01:01:00.000Z",
  }), false);
  assert.equal(await upsertPushSubscriptionOwnership(db, {
    id: "push-a3", userId: "user-a", familyId: "family-a", endpoint,
    subscription: "{\"version\":2}", registrationInstanceId: "session-old", now: "2026-07-14T01:01:30.000Z",
  }), true);
  assert.equal(await upsertPushSubscriptionOwnership(db, {
    id: "push-b", userId: "user-b", familyId: "family-b", endpoint,
    subscription: "{\"version\":3}", registrationInstanceId: "session-b", now: "2026-07-14T01:02:00.000Z",
  }), false);

  assert.deepEqual(
    { ...sqlite.prepare("SELECT user_id, family_id, subscription, registration_instance_id, COUNT(*) AS count FROM push_subscriptions WHERE endpoint=? AND disabled_at IS NULL").get(endpoint) },
    { user_id: "user-a", family_id: "family-a", subscription: "{\"version\":2}", registration_instance_id: "session-old", count: 1 },
  );
  assert.equal(await isPushSubscriptionRegistrationCurrent(db, {
    endpoint, userId: "user-a", familyId: "family-a", registrationInstanceId: "session-old",
  }), true);
  assert.equal(await isPushSubscriptionRegistrationCurrent(db, {
    endpoint, userId: "user-a", familyId: "family-a", registrationInstanceId: "session-new",
  }), false);
  assert.equal(await unregisterOwnedPushSubscription(db, {
    endpoint, userId: "user-a", registrationInstanceId: "session-new", now: "2026-07-14T01:02:30.000Z",
  }), false);
  assert.equal(await unregisterOwnedPushSubscription(db, {
    endpoint, userId: "user-a", registrationInstanceId: "session-old", now: "2026-07-14T01:03:00.000Z",
  }), true);
  assert.deepEqual(
    { ...sqlite.prepare("SELECT disabled_at, disabled_reason FROM push_subscriptions WHERE endpoint=?").get(endpoint) },
    { disabled_at: "2026-07-14T01:03:00.000Z", disabled_reason: "session_unregistered" },
  );
});

test("비활성 이력은 같은 token/endpoint의 새 활성 등록을 막지 않는다", async () => {
  const { sqlite, db } = createOwnershipDb();
  const { upsertFcmTokenOwnership, upsertPushSubscriptionOwnership } = api();
  const endpoint = "https://push.example/concurrent";
  sqlite.prepare(`INSERT INTO fcm_tokens VALUES (?,?,?,?,?,?,?,?,?,?)`).run(
    "old-fcm", "user-a", "family-a", "same-disabled-token", "2026-07-14T00:00:00Z",
    "2026-07-14T00:00:00Z", "android", "session-a", "2026-07-14T00:30:00Z", "session_unregistered",
  );
  sqlite.prepare(`INSERT INTO push_subscriptions VALUES (?,?,?,?,?,?,?,?,?,?)`).run(
    "old-push", "user-a", "family-a", endpoint, "{}", "2026-07-14T00:00:00Z",
    "2026-07-14T00:00:00Z", "session-a", "2026-07-14T00:30:00Z", "session_unregistered",
  );

  assert.equal(await upsertFcmTokenOwnership(db, {
    id: "new-fcm", userId: "user-b", familyId: "family-b", token: "same-disabled-token",
    platform: "android", registrationInstanceId: "session-b", now: "2026-07-14T01:00:00.000Z",
  }), true);
  assert.equal(await upsertPushSubscriptionOwnership(db, {
    id: "new-push", userId: "user-b", familyId: "family-b", endpoint,
    subscription: "{\"owner\":\"b\"}", registrationInstanceId: "session-b", now: "2026-07-14T01:00:00.000Z",
  }), true);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM fcm_tokens WHERE fcm_token=?").get("same-disabled-token").count, 2);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM push_subscriptions WHERE endpoint=?").get(endpoint).count, 2);
});

test("migration의 legacy sentinel은 같은 소유자의 첫 최신 세션으로만 승격된다", async () => {
  const { sqlite, db } = createOwnershipDb();
  const { upsertFcmTokenOwnership, upsertPushSubscriptionOwnership } = api();
  sqlite.prepare(`INSERT INTO fcm_tokens VALUES (?,?,?,?,?,?,?,?,NULL,NULL)`).run(
    "legacy-fcm", "user-a", "family-a", "legacy-token", "2026-07-14T00:00:00Z",
    "2026-07-14T00:00:00Z", "android", "legacy:legacy-fcm",
  );
  sqlite.prepare(`INSERT INTO push_subscriptions VALUES (?,?,?,?,?,?,?,?,NULL,NULL)`).run(
    "legacy-push", "user-a", "family-a", "https://push.example/legacy", "{}",
    "2026-07-14T00:00:00Z", "2026-07-14T00:00:00Z", "legacy:legacy-push",
  );

  assert.equal(await upsertFcmTokenOwnership(db, {
    id: "ignored", userId: "user-a", familyId: "family-a", token: "legacy-token",
    platform: "android", registrationInstanceId: "session-a", now: "2026-07-14T01:00:00.000Z",
  }), true);
  assert.equal(await upsertPushSubscriptionOwnership(db, {
    id: "ignored", userId: "user-a", familyId: "family-a", endpoint: "https://push.example/legacy",
    subscription: "{\"upgraded\":true}", registrationInstanceId: "session-a", now: "2026-07-14T01:00:00.000Z",
  }), true);
  assert.equal(sqlite.prepare("SELECT registration_instance_id FROM fcm_tokens WHERE id='legacy-fcm'").get().registration_instance_id, "session-a");
  assert.equal(sqlite.prepare("SELECT registration_instance_id FROM push_subscriptions WHERE id='legacy-push'").get().registration_instance_id, "session-a");
});

test("구스키마에서는 안전하지 않은 legacy 등록·해제를 실행하지 않고 명시적으로 닫는다", async () => {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`
    CREATE TABLE fcm_tokens(
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, family_id TEXT NOT NULL,
      fcm_token TEXT NOT NULL, platform TEXT NOT NULL, created_at TEXT, updated_at TEXT
    );
    INSERT INTO fcm_tokens VALUES (
      'legacy-existing','user-a','family-a','token-a','android',
      '2026-07-14T00:00:00.000Z','2026-07-14T00:00:00.000Z'
    );
  `);
  const db = { prepare: (sql) => new Statement(sqlite, sql) };
  const { refreshLegacyFcmTokenOwnership, upsertFcmTokenOwnership, unregisterOwnedFcmToken } = api();

  assert.equal(await refreshLegacyFcmTokenOwnership(db, {
    token: "token-a", userId: "user-a", familyId: "family-a", platform: "android",
    now: "2026-07-14T01:00:00.000Z",
  }), true);
  assert.equal(await refreshLegacyFcmTokenOwnership(db, {
    token: "token-a", userId: "user-b", familyId: "family-b", platform: "android",
    now: "2026-07-14T01:01:00.000Z",
  }), false);
  assert.equal(await refreshLegacyFcmTokenOwnership(db, {
    token: "missing-token", userId: "user-a", familyId: "family-a", platform: "android",
    now: "2026-07-14T01:02:00.000Z",
  }), false);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM fcm_tokens").get().count, 1);

  await assert.rejects(() => upsertFcmTokenOwnership(db, {
    id: "legacy", userId: "user-a", familyId: "family-a", token: "token-a",
    platform: "android", registrationInstanceId: "session-a", now: "2026-07-14T01:00:00.000Z",
  }), (error) => error?.code === "notification_endpoint_schema_unavailable");
  await assert.rejects(() => unregisterOwnedFcmToken(db, {
    token: "token-a", userId: "user-a", registrationInstanceId: "session-a",
    now: "2026-07-14T01:03:00.000Z",
  }), (error) => error?.code === "notification_endpoint_schema_unavailable");
});

test("1회용 ownership migration은 기존 행을 삭제하지 않고 모호·무효·중복 endpoint만 비활성화한다", () => {
  const migrationPath = new URL("../db/notification-endpoint-ownership.sql", import.meta.url);
  let migration = "";
  try {
    migration = readFileSync(migrationPath, "utf8");
  } catch {
    assert.fail("notification endpoint ownership migration이 필요합니다");
  }
  assert.doesNotMatch(migration, /\bDELETE\b|ownership_archive/i, "운영 endpoint 이력은 삭제·이관하지 않습니다");
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`
    CREATE TABLE families(id TEXT PRIMARY KEY, parent_id TEXT NOT NULL);
    CREATE TABLE family_members(
      id TEXT PRIMARY KEY, family_id TEXT NOT NULL, user_id TEXT,
      role TEXT NOT NULL, is_active INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE fcm_tokens(
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, family_id TEXT NOT NULL,
      fcm_token TEXT NOT NULL, created_at TEXT, updated_at TEXT,
      platform TEXT NOT NULL DEFAULT 'android'
    );
    CREATE TABLE push_subscriptions(
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, family_id TEXT NOT NULL,
      endpoint TEXT NOT NULL, subscription TEXT NOT NULL, created_at TEXT
    );
    INSERT INTO families VALUES ('family-a','parent-a'), ('family-b','parent-b');
    INSERT INTO family_members VALUES
      ('member-a','family-a','user-a','child',1),
      ('member-b','family-b','user-b','child',1),
      ('member-old','family-a','user-old','child',0);

    INSERT INTO fcm_tokens VALUES
      ('valid-old','user-a','family-a','shared-token','2026-07-14T00:00:00Z','2026-07-14T00:00:00Z','android'),
      ('invalid-new','user-old','family-a','shared-token','2026-07-14T02:00:00Z','2026-07-14T02:00:00Z','android'),
      ('latest-a','user-a','family-a','multi-valid','2026-07-14T01:00:00Z','2026-07-14T01:00:00Z','android'),
      ('latest-b','user-b','family-b','multi-valid','2026-07-14T02:00:00Z','2026-07-14T02:00:00Z','android'),
      ('tie-first','user-a','family-a','tie-token','2026-07-14T03:00:00Z','2026-07-14T03:00:00Z','android'),
      ('tie-last','user-a','family-a','tie-token','2026-07-14T03:00:00Z','2026-07-14T03:00:00Z','android'),
      ('invalid-only-a','user-old','family-a','invalid-only','2026-07-14T00:00:00Z','2026-07-14T00:00:00Z','android'),
      ('invalid-only-b','ghost','family-b','invalid-only','2026-07-14T01:00:00Z','2026-07-14T01:00:00Z','android'),
      ('single-valid','user-a','family-a','single-token','2026-07-14T04:00:00Z','2026-07-14T04:00:00Z','android');

    INSERT INTO push_subscriptions VALUES
      ('push-valid-old','user-a','family-a','https://push.example/shared','{\"valid\":1}','2026-07-14T00:00:00Z'),
      ('push-invalid-new','user-old','family-a','https://push.example/shared','{\"invalid\":1}','2026-07-14T02:00:00Z'),
      ('push-older','user-a','family-a','https://push.example/valid-dupe','{\"version\":1}','2026-07-14T00:00:00Z'),
      ('push-newer','user-a','family-a','https://push.example/valid-dupe','{\"version\":2}','2026-07-14T01:00:00Z'),
      ('push-invalid-only','ghost','family-b','https://push.example/invalid','{\"invalid\":1}','2026-07-14T00:00:00Z');
  `);

  sqlite.exec(migration);

  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM fcm_tokens").get().count, 9);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM fcm_tokens WHERE fcm_token='shared-token' AND disabled_reason='cross_user_ownership'").get().count, 2);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM fcm_tokens WHERE fcm_token='multi-valid' AND disabled_reason='cross_user_ownership'").get().count, 2);
  assert.equal(sqlite.prepare("SELECT id FROM fcm_tokens WHERE fcm_token='tie-token' AND disabled_at IS NULL").get().id, "tie-last");
  assert.equal(sqlite.prepare("SELECT disabled_reason FROM fcm_tokens WHERE id='tie-first'").get().disabled_reason, "duplicate_token");
  assert.equal(sqlite.prepare("SELECT registration_instance_id FROM fcm_tokens WHERE id='tie-last'").get().registration_instance_id, "legacy:tie-last");
  assert.equal(sqlite.prepare("SELECT id FROM fcm_tokens WHERE fcm_token='single-token' AND disabled_at IS NULL").get().id, "single-valid");
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM fcm_tokens WHERE fcm_token='invalid-only' AND disabled_reason='cross_user_ownership'").get().count, 2);

  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM push_subscriptions").get().count, 5);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM push_subscriptions WHERE endpoint='https://push.example/shared' AND disabled_reason='cross_user_ownership'").get().count, 2);
  assert.equal(sqlite.prepare("SELECT id FROM push_subscriptions WHERE endpoint='https://push.example/valid-dupe' AND disabled_at IS NULL").get().id, "push-newer");
  assert.equal(sqlite.prepare("SELECT disabled_reason FROM push_subscriptions WHERE id='push-older'").get().disabled_reason, "duplicate_endpoint");
  assert.equal(sqlite.prepare("SELECT registration_instance_id FROM push_subscriptions WHERE id='push-newer'").get().registration_instance_id, "legacy:push-newer");
  assert.equal(sqlite.prepare("SELECT disabled_reason FROM push_subscriptions WHERE endpoint='https://push.example/invalid'").get().disabled_reason, "invalid_owner");

  assert.throws(() => sqlite.prepare(
    "INSERT INTO fcm_tokens(id,user_id,family_id,fcm_token,platform) VALUES (?,?,?,?,?)",
  ).run("duplicate", "user-a", "family-a", "tie-token", "android"), /UNIQUE constraint failed/);
  assert.throws(() => sqlite.prepare(
    "INSERT INTO push_subscriptions(id,user_id,family_id,endpoint,subscription) VALUES (?,?,?,?,?)",
  ).run("duplicate", "user-a", "family-a", "https://push.example/valid-dupe", "{}"), /UNIQUE constraint failed/);

  assert.doesNotThrow(() => sqlite.prepare(
    "INSERT INTO fcm_tokens(id,user_id,family_id,fcm_token,platform,disabled_at,disabled_reason) VALUES (?,?,?,?,?,?,?)",
  ).run("disabled-history", "user-a", "family-a", "tie-token", "android", "2026-07-14T05:00:00Z", "test_history"));
  assert.doesNotThrow(() => sqlite.prepare(
    "INSERT INTO push_subscriptions(id,user_id,family_id,endpoint,subscription,disabled_at,disabled_reason) VALUES (?,?,?,?,?,?,?)",
  ).run("disabled-history", "user-a", "family-a", "https://push.example/valid-dupe", "{}", "2026-07-14T05:00:00Z", "test_history"));

  assert.throws(() => sqlite.exec(migration), /duplicate column name/);
});
