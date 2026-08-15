import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import "./helpers/tsModuleResolve.mjs";
import { generateKeyPair, exportJWK } from "jose";
import * as rtdnStore from "../lib/googlePlayRtdnStore.ts";
import * as googlePlay from "../lib/googlePlay.ts";
import { claimBillingProvider } from "../lib/billingProviderReservation.ts";

const NOW = new Date("2026-07-13T12:00:00.000Z");
// 실제 실행 날짜가 기본 활성 구독 fixture를 만료시키지 않도록 먼 미래 시각을 사용한다.
const DEFAULT_SUBSCRIPTION_EXPIRY = "2099-08-13T00:00:00.000Z";
const PACKAGE_NAME = "com.hyeni.calendar";
const RAW_TOKEN = "SENTINEL_RAW_PURCHASE_TOKEN";
const LINKED_TOKEN = "SENTINEL_LINKED_PURCHASE_TOKEN";
const FAMILY_ID = "family-1";
const PARENT_ID = "parent-1";
const PREMIUM_FUNNEL_HASH_SECRET = "google-play-premium-funnel-test-secret-32-bytes";

const { createGooglePlayRtdnRoutes } = await import("../routes/google-play-rtdn.ts");
const { default: googlePlayVerifyRoutes } = await import("../routes/google-play-verify.ts");
const { signAccessToken } = await import("../lib/jwt.ts");
class SqliteD1 {
  constructor() {
    this.sqlite = new DatabaseSync(":memory:");
    this.beforeRun = null;
    this.beforeBatch = null;
  }

  exec(sql) {
    this.sqlite.exec(sql);
  }

  prepare(sql) {
    const sqlite = this.sqlite;
    const owner = this;
    return {
      bind(...bindings) {
        const values = bindings.map((value) => value === undefined ? null : value);
        return {
          async run() {
            if (typeof owner.beforeRun === "function") {
              await owner.beforeRun(sql, values);
            }
            const result = sqlite.prepare(sql).run(...values);
            return { success: true, meta: { changes: Number(result.changes) } };
          },
          async first() {
            return sqlite.prepare(sql).get(...values) ?? null;
          },
          async all() {
            return { success: true, results: sqlite.prepare(sql).all(...values) };
          },
        };
      },
    };
  }

  async batch(statements) {
    if (typeof this.beforeBatch === "function") await this.beforeBatch(statements);
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

  row(sql, ...bindings) {
    return this.sqlite.prepare(sql).get(...bindings) ?? null;
  }

  rows(sql, ...bindings) {
    return this.sqlite.prepare(sql).all(...bindings);
  }
}

function createDb() {
  const db = new SqliteD1();
  db.exec(readFileSync(new URL("../db/google-play-rtdn-schema.sql", import.meta.url), "utf8"));
  db.exec(`
    CREATE TABLE google_play_purchase_events (
      purchase_token_hash TEXT PRIMARY KEY, family_id TEXT NOT NULL, child_user_id TEXT,
      parent_id TEXT, product_type TEXT NOT NULL, product_id TEXT NOT NULL, base_plan_id TEXT,
      credit_amount INTEGER, debt_applied INTEGER NOT NULL DEFAULT 0, order_id TEXT, status TEXT NOT NULL DEFAULT 'received',
      verification_result TEXT NOT NULL DEFAULT '{}', granted_at TEXT, acknowledged_at TEXT,
      consumed_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE family_subscription (
      family_id TEXT PRIMARY KEY, status TEXT NOT NULL, product_id TEXT NOT NULL,
      qonversion_user_id TEXT NOT NULL, provider TEXT NOT NULL DEFAULT 'google_play',
      base_plan_id TEXT, purchase_token_hash TEXT, latest_order_id TEXT,
      current_period_end TEXT, trial_ends_at TEXT, cancelled_at TEXT, acknowledged_at TEXT,
      google_play_raw TEXT NOT NULL DEFAULT '{}', raw_event TEXT NOT NULL DEFAULT '{}',
      last_event_id TEXT, last_event_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE families (
      id TEXT PRIMARY KEY, parent_id TEXT NOT NULL, created_at TEXT
    );
    CREATE TABLE users (
      id TEXT PRIMARY KEY
    );
    CREATE TABLE family_members (
      id TEXT PRIMARY KEY, family_id TEXT NOT NULL, user_id TEXT, role TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE account_deletion_scopes (
      job_id TEXT NOT NULL, scope_type TEXT NOT NULL, scope_id TEXT NOT NULL,
      created_at TEXT NOT NULL, PRIMARY KEY (scope_type, scope_id)
    );
    CREATE TABLE account_mutation_leases (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, family_id TEXT,
      expires_at TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE family_unpair_cleanup_jobs (
      family_id TEXT NOT NULL, child_user_id TEXT NOT NULL
    );
  `);
  db.exec(readFileSync(new URL("../db/web-billing.sql", import.meta.url), "utf8"));
  return db;
}

function envelope(messageId, payload) {
  return JSON.stringify({
    message: {
      messageId,
      data: Buffer.from(JSON.stringify({
        version: "1.0",
        packageName: PACKAGE_NAME,
        eventTimeMillis: String(NOW.getTime()),
        ...payload,
      })).toString("base64"),
    },
  });
}

function testEnvelope(messageId = "test-message-1") {
  return envelope(messageId, { testNotification: { version: "1.0" } });
}

function subscriptionEnvelope(
  messageId,
  purchaseToken = RAW_TOKEN,
  subscriptionId = "untrusted-client-value",
  notificationType = 4,
  eventTimeMillis = NOW.getTime(),
) {
  return envelope(messageId, {
    eventTimeMillis: String(eventTimeMillis),
    subscriptionNotification: { version: "1.0", notificationType, purchaseToken, subscriptionId },
  });
}

function voidedEnvelope(
  messageId,
  purchaseToken,
  orderId = "SENTINEL_VOIDED_ORDER",
  productType = 2,
  refundType = 1,
) {
  return envelope(messageId, {
    voidedPurchaseNotification: {
      purchaseToken,
      orderId,
      productType,
      refundType,
    },
  });
}

async function ownerIds(familyId = FAMILY_ID, parentId = PARENT_ID) {
  return {
    accountId: await googlePlay.sha256Hex(`hyeni-family:${familyId}`),
    profileId: await googlePlay.sha256Hex(`hyeni-user:${parentId}`),
  };
}

async function playSubscription(overrides = {}) {
  const ids = await ownerIds();
  return {
    subscriptionState: "SUBSCRIPTION_STATE_ACTIVE",
    acknowledgementState: "ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED",
    latestOrderId: "order-from-google",
    linkedPurchaseToken: LINKED_TOKEN,
    externalAccountIdentifiers: {
      obfuscatedExternalAccountId: ids.accountId,
      obfuscatedExternalProfileId: ids.profileId,
    },
    lineItems: [{
      productId: "hyeni_premium",
      expiryTime: DEFAULT_SUBSCRIPTION_EXPIRY,
      offerDetails: { basePlanId: "monthly-2900", offerId: "trial-7d" },
      autoRenewingPlan: {
        autoRenewEnabled: true,
        recurringPrice: { currencyCode: "KRW", units: "4900", nanos: 0 },
      },
      offerPhase: {},
    }],
    ...overrides,
  };
}

function fetchMock(subscription, options = {}) {
  const calls = [];
  const impl = async (url) => {
    const value = String(url);
    calls.push(value);
    if (value === "https://oauth2.googleapis.com/token") return Response.json({ access_token: "access-token" });
    if (value.includes("purchases/subscriptionsv2/tokens/")) {
      if (options.onSubscription) await options.onSubscription();
      if (options.googleStatus) return Response.json({ error: "upstream" }, { status: options.googleStatus });
      return Response.json(subscription);
    }
    if (value.endsWith(":acknowledge")) {
      if (options.onAcknowledge) await options.onAcknowledge();
      if (options.ackStatus) return Response.json({ error: "ack failed" }, { status: options.ackStatus });
      return new Response(null, { status: 204 });
    }
    if (value.endsWith(":refund?revoke=true")) {
      if (options.onRefund) await options.onRefund();
      if (options.refundStatus) return Response.json({ error: "refund failed" }, { status: options.refundStatus });
      return new Response(null, { status: 204 });
    }
    throw new Error(`unexpected fetch: ${value}`);
  };
  return { calls, impl };
}

function env(db, notifyCalls = []) {
  return {
    DB: db,
    GOOGLE_PLAY_RTDN_AUDIENCE: "https://example.test/api/billing/google-play-rtdn",
    GOOGLE_PLAY_RTDN_PUSH_SERVICE_ACCOUNT_EMAIL: "push@example.iam.gserviceaccount.com",
    GOOGLE_PLAY_SERVICE_ACCOUNT_JSON: VALID_SERVICE_ACCOUNT_JSON,
    GOOGLE_PLAY_PACKAGE_NAME: PACKAGE_NAME,
    FAMILY_ROOM: {
      idFromName: (familyId) => familyId,
      get: () => ({
        fetch: async (_url, init) => {
          notifyCalls.push(JSON.parse(String(init.body)));
          return new Response(null, { status: 204 });
        },
      }),
    },
  };
}

async function request(routes, environment, body, authorization = "Bearer valid-oidc") {
  return routes.request("http://local/google-play-rtdn", {
    method: "POST",
    headers: { authorization, "content-type": "application/json" },
    body,
  }, environment);
}

async function createServiceAccountJson() {
  const keyPair = await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  );
  const key = new Uint8Array(await crypto.subtle.exportKey("pkcs8", keyPair.privateKey));
  const body = Buffer.from(key).toString("base64").match(/.{1,64}/g).join("\n");
  return JSON.stringify({
    client_email: "billing@example.iam.gserviceaccount.com",
    private_key: `-----BEGIN PRIVATE KEY-----\n${body}\n-----END PRIVATE KEY-----`,
  });
}

const VALID_SERVICE_ACCOUNT_JSON = await createServiceAccountJson();
const verifyOidc = async () => ({ email: "push@example.iam.gserviceaccount.com" });

function routes(fetchImpl = async () => { throw new Error("Google must not be called"); }) {
  return createGooglePlayRtdnRoutes({ verifyOidc, fetchImpl, now: () => NOW });
}

function seedOwnerAccount(db, familyId = FAMILY_ID, parentId = PARENT_ID) {
  db.sqlite.prepare("INSERT OR IGNORE INTO users(id) VALUES (?)").run(parentId);
  db.sqlite.prepare("INSERT OR IGNORE INTO families(id,parent_id,created_at) VALUES (?,?,?)")
    .run(familyId, parentId, NOW.toISOString());
  db.sqlite.prepare(
    "INSERT OR IGNORE INTO family_members(id,family_id,user_id,role,is_active) VALUES (?,?,?,'parent',1)",
  ).run(`parent-member-${familyId}`, familyId, parentId);
}

function seedCompletedTossTrial(db, familyId = FAMILY_ID, parentId = PARENT_ID) {
  db.sqlite.prepare(
    `INSERT INTO web_billing_trial_claims
       (family_id,parent_id,checkout_session_id,plan,status,claimed_at,trial_ends_at,updated_at)
     VALUES (?,?,?,'month','expired',?,?,?)`,
  ).run(
    familyId,
    parentId,
    `web-trial-${familyId}`,
    "2026-07-01T00:00:00.000Z",
    "2026-07-08T00:00:00.000Z",
    "2026-07-08T00:00:00.000Z",
  );
}

async function seedPurchaseOwner(db, token, familyId = FAMILY_ID, parentId = PARENT_ID) {
  seedOwnerAccount(db, familyId, parentId);
  const hash = await googlePlay.sha256Hex(token);
  db.sqlite.prepare("INSERT INTO google_play_purchase_events (purchase_token_hash,family_id,parent_id,product_type,product_id,status,verification_result,created_at,updated_at) VALUES (?,?,?,'subscription','hyeni_premium','active','{}',?,?)")
    .run(hash, familyId, parentId, NOW.toISOString(), NOW.toISOString());
}

function enablePremiumFunnel(db, environment) {
  db.exec(readFileSync(new URL("../db/premium-funnel.sql", import.meta.url), "utf8"));
  environment.PREMIUM_FUNNEL_HASH_SECRET = PREMIUM_FUNNEL_HASH_SECRET;
  return environment;
}

test("RTDN claim은 UUID fencing token으로 신규·재선점 소유자를 구분한다", async () => {
  const db = createDb();
  const first = await rtdnStore.claimGooglePlayRtdnEvent(db, {
    messageId: "lease-message", eventTimeMillis: String(NOW.getTime()), kind: "subscription", notificationType: 4,
  }, "hash", NOW);
  assert.equal(first.state, "claimed");
  assert.equal(db.row("SELECT claim_token FROM google_play_rtdn_events").claim_token, first.claimToken);
  db.sqlite.prepare("UPDATE google_play_rtdn_events SET status='retryable'").run();
  const second = await rtdnStore.claimGooglePlayRtdnEvent(db, {
    messageId: "lease-message", eventTimeMillis: String(NOW.getTime()), kind: "subscription", notificationType: 4,
  }, "hash", new Date(NOW.getTime() + 1000));
  assert.equal(second.state, "claimed");
  assert.notEqual(second.claimToken, first.claimToken);
});

test("공통 sanitizer는 중첩 token/signature/originalJson을 제거한다", () => {
  const sanitized = googlePlay.sanitizeGooglePlayForStorage({
    linkedPurchaseToken: RAW_TOKEN,
    nested: { purchaseToken: RAW_TOKEN, signature: RAW_TOKEN, originalJson: RAW_TOKEN, status: "active" },
    lineItems: [{ token: RAW_TOKEN, productId: "hyeni_premium" }],
  });
  assert.equal(JSON.stringify(sanitized).includes(RAW_TOKEN), false);
  assert.deepEqual(sanitized, { nested: { status: "active" }, lineItems: [{ productId: "hyeni_premium" }] });
});

test("인증된 test notification은 entitlement 없이 ignored 204이며 duplicate도 204다", async () => {
  const db = createDb();
  const app = routes();
  assert.equal((await request(app, env(db), testEnvelope())).status, 204);
  assert.equal(db.row("SELECT status FROM google_play_rtdn_events").status, "ignored");
  assert.equal(db.row("SELECT COUNT(*) AS count FROM family_subscription").count, 0);
  assert.equal((await request(app, env(db), testEnvelope())).status, 204);
  assert.equal(db.row("SELECT attempts FROM google_play_rtdn_events").attempts, 1);
});

test("Bearer 인증이 없으면 DB claim 전에 401이다", async () => {
  const db = createDb();
  assert.equal((await request(routes(), env(db), testEnvelope("auth-message"), "")).status, 401);
  assert.equal(db.row("SELECT COUNT(*) AS count FROM google_play_rtdn_events").count, 0);
});

test("진행 중 lease는 503이고 Google을 호출하지 않는다", async () => {
  const db = createDb();
  db.sqlite.prepare("INSERT INTO google_play_rtdn_events (message_id,package_name,event_kind,status,attempts,claim_token,lease_until,event_time_ms,received_at,updated_at) VALUES (?,?,?,'processing',1,?,?,?, ?,?)")
    .run("busy-message", PACKAGE_NAME, "test", "new-owner", "2026-07-13 12:05:00.000+00", NOW.getTime(), NOW.toISOString(), NOW.toISOString());
  assert.equal((await request(routes(), env(db), testEnvelope("busy-message"))).status, 503);
});

test("test notification도 finalize 직전 claim을 잃으면 204로 완료하지 않는다", async () => {
  const db = createDb();
  const originalPrepare = db.prepare.bind(db);
  let fenced = false;
  db.prepare = (sql) => {
    if (!fenced && sql.startsWith("UPDATE google_play_rtdn_events SET family_id=")) {
      fenced = true;
      db.sqlite.prepare("UPDATE google_play_rtdn_events SET claim_token='new-test-owner' WHERE message_id='test-claim-lost'").run();
    }
    return originalPrepare(sql);
  };
  const response = await request(routes(), env(db), testEnvelope("test-claim-lost"));
  assert.equal(response.status, 503);
  assert.equal(db.row("SELECT claim_token FROM google_play_rtdn_events").claim_token, "new-test-owner");
});

test("Google 5xx는 retryable 비2xx이고 재요청이 attempts를 올린다", async () => {
  const db = createDb();
  const google = fetchMock({}, { googleStatus: 503 });
  const app = routes(google.impl);
  assert.equal((await request(app, env(db), subscriptionEnvelope("google-5xx"))).status, 502);
  assert.deepEqual({ ...db.row("SELECT status,attempts,last_error FROM google_play_rtdn_events") }, {
    status: "retryable", attempts: 1, last_error: "google_api_failed",
  });
  assert.equal((await request(app, env(db), subscriptionEnvelope("google-5xx"))).status, 502);
  assert.equal(db.row("SELECT attempts FROM google_play_rtdn_events").attempts, 2);
});

test("일회성 AI 크레딧 voided RTDN은 미사용 잔액과 향후 구매 debt를 원자 반영한다", async () => {
  const db = createDb();
  db.exec(`
    CREATE TABLE ai_credit_balances(
      id TEXT PRIMARY KEY,family_id TEXT NOT NULL,child_user_id TEXT NOT NULL,
      parent_id TEXT,is_premium INTEGER NOT NULL,daily_included_limit INTEGER NOT NULL,
      daily_included_used INTEGER NOT NULL,daily_reset_date TEXT NOT NULL,
      purchased_credits INTEGER NOT NULL,updated_at TEXT NOT NULL
    );
    CREATE TABLE ai_credit_ledger(
      id TEXT PRIMARY KEY,family_id TEXT NOT NULL,child_user_id TEXT NOT NULL,
      parent_id TEXT,delta INTEGER NOT NULL,reason TEXT NOT NULL,source TEXT NOT NULL,
      message_id TEXT,transaction_id TEXT,created_at TEXT NOT NULL
    );
  `);
  const token = "SENTINEL_VOIDED_CREDIT_TOKEN";
  const tokenHash = await googlePlay.sha256Hex(token);
  db.sqlite.prepare(
    `INSERT INTO google_play_purchase_events
       (purchase_token_hash,family_id,child_user_id,parent_id,product_type,product_id,
        credit_amount,order_id,status,verification_result,granted_at,consumed_at,
        created_at,updated_at)
     VALUES (?,?,?,?,'inapp','hyeni_ai_credits_30',30,'stored-google-order','granted',
             '{}',?,?,?,?)`,
  ).run(
    tokenHash,
    FAMILY_ID,
    "child-refund",
    PARENT_ID,
    NOW.toISOString(),
    NOW.toISOString(),
    NOW.toISOString(),
    NOW.toISOString(),
  );
  db.sqlite.prepare(
    `INSERT INTO ai_credit_balances
       (id,family_id,child_user_id,parent_id,is_premium,daily_included_limit,
        daily_included_used,daily_reset_date,purchased_credits,updated_at)
     VALUES ('refund-balance',?,?,?,0,5,5,'2026-07-13',10,?)`,
  ).run(FAMILY_ID, "child-refund", PARENT_ID, NOW.toISOString());

  const app = routes();
  const environment = env(db);
  const first = await request(
    app,
    environment,
    voidedEnvelope("voided-credit-1", token),
  );
  assert.equal(first.status, 204);
  assert.equal(db.row("SELECT purchased_credits AS n FROM ai_credit_balances").n, -20);
  assert.deepEqual({ ...db.row(
    "SELECT delta,reason,source FROM ai_credit_ledger",
  ) }, { delta: -30, reason: "refund", source: "google_play_refund" });
  assert.equal(db.row("SELECT status FROM google_play_purchase_events").status, "refunded");
  assert.equal(db.row(
    "SELECT status FROM google_play_voided_purchase_events WHERE message_id='voided-credit-1'",
  ).status, "processed");

  assert.equal((await request(
    app,
    environment,
    voidedEnvelope("voided-credit-1", token),
  )).status, 204);
  assert.equal((await request(
    app,
    environment,
    voidedEnvelope("voided-credit-2", token),
  )).status, 204);
  assert.equal(db.row("SELECT purchased_credits AS n FROM ai_credit_balances").n, -20);
  assert.equal(db.row("SELECT COUNT(*) AS n FROM ai_credit_ledger").n, 1);

  const persisted = JSON.stringify(db.rows("SELECT * FROM google_play_voided_purchase_events"));
  assert.equal(persisted.includes(token), false);
  assert.equal(persisted.includes("SENTINEL_VOIDED_ORDER"), false);
});

test("voided가 received를 읽은 뒤 크레딧 지급 상태로 바뀌면 processed로 확정하지 않고 재시도한다", async () => {
  const db = createDb();
  const token = "SENTINEL_VOIDED_RECEIVED_RACE_TOKEN";
  const tokenHash = await googlePlay.sha256Hex(token);
  db.sqlite.prepare(
    `INSERT INTO google_play_purchase_events
       (purchase_token_hash,family_id,child_user_id,parent_id,product_type,product_id,
        credit_amount,order_id,status,verification_result,created_at,updated_at)
     VALUES (?,?,?,?,'inapp','hyeni_ai_credits_30',30,'race-order','received','{}',?,?)`,
  ).run(tokenHash, FAMILY_ID, "child-race", PARENT_ID, NOW.toISOString(), NOW.toISOString());

  let movedToGrantedState = false;
  db.beforeBatch = async () => {
    if (movedToGrantedState) return;
    movedToGrantedState = true;
    db.sqlite.prepare(
      "UPDATE google_play_purchase_events SET status='credit_granted_pending_consume',granted_at=? WHERE purchase_token_hash=?",
    ).run(NOW.toISOString(), tokenHash);
  };

  const response = await request(
    routes(),
    env(db),
    voidedEnvelope("voided-received-race", token),
  );

  assert.equal(response.status, 503);
  assert.equal(db.row(
    "SELECT status FROM google_play_purchase_events WHERE purchase_token_hash=?",
    tokenHash,
  ).status, "credit_granted_pending_consume");
  assert.deepEqual({ ...db.row(
    "SELECT status,last_error FROM google_play_voided_purchase_events WHERE message_id='voided-received-race'",
  ) }, {
    status: "retryable",
    last_error: "voided_credit_reversal_failed",
  });
});

test("current token owner 성공은 Play 상태·ack·upsert·notify를 적용하고 raw token을 0회 저장한다", async () => {
  const db = createDb();
  await seedPurchaseOwner(db, RAW_TOKEN);
  const subscription = await playSubscription({ acknowledgementState: "ACKNOWLEDGEMENT_STATE_PENDING" });
  const google = fetchMock(subscription);
  const notifications = [];
  const response = await request(routes(google.impl), env(db, notifications), subscriptionEnvelope("current-owner"));
  assert.equal(response.status, 204);
  assert.equal(db.row("SELECT status FROM google_play_rtdn_events WHERE message_id='current-owner'").status, "processed");
  assert.equal(db.row("SELECT status FROM family_subscription WHERE family_id=?", FAMILY_ID).status, "active");
  assert.equal(google.calls.filter((url) => url.endsWith(":acknowledge")).length, 1);
  assert.equal(notifications.length, 1);
  const persisted = JSON.stringify([
    ...db.rows("SELECT * FROM google_play_rtdn_events"),
    ...db.rows("SELECT * FROM google_play_purchase_events"),
    ...db.rows("SELECT * FROM family_subscription"),
    ...db.rows("SELECT * FROM google_play_billing_owners"),
  ]);
  assert.equal(persisted.includes(RAW_TOKEN), false);
  assert.equal(persisted.includes(LINKED_TOKEN), false);
});

test("새 토큰 활성화 뒤 구 토큰의 지연 RTDN은 최신 구독·provider·owner를 되돌리지 않는다", async () => {
  const db = createDb();
  const oldToken = "SENTINEL_OLD_PURCHASE_TOKEN";
  const currentToken = "SENTINEL_CURRENT_PURCHASE_TOKEN";
  const oldHash = await googlePlay.sha256Hex(oldToken);
  const currentHash = await googlePlay.sha256Hex(currentToken);
  const ids = await ownerIds();
  await seedPurchaseOwner(db, oldToken);
  db.sqlite.prepare(
    `INSERT INTO family_subscription
       (family_id,status,product_id,qonversion_user_id,provider,base_plan_id,
        purchase_token_hash,latest_order_id,current_period_end,trial_ends_at,
        cancelled_at,acknowledged_at,google_play_raw,raw_event,last_event_id,
        last_event_at,created_at,updated_at)
     VALUES (?,'active','hyeni_premium',?,'google_play','monthly-2900',?,
       'order-current','2026-08-20T00:00:00.000Z',NULL,NULL,?,'{}','{}',
       'current-event','2026-07-13T12:05:00.000Z',?,?)`,
  ).run(FAMILY_ID, FAMILY_ID, currentHash, NOW.toISOString(), NOW.toISOString(), NOW.toISOString());
  db.sqlite.prepare(
    `INSERT INTO billing_provider_reservations
       (family_id,provider,state,reservation_ref,created_at,updated_at)
     VALUES (?,'google_play','active',?,?,?)`,
  ).run(FAMILY_ID, currentHash, NOW.toISOString(), NOW.toISOString());
  db.sqlite.prepare(
    `INSERT INTO google_play_billing_owners
       (obfuscated_account_id,obfuscated_profile_id,family_id,parent_id,
        last_purchase_token_hash,created_at,updated_at)
     VALUES (?,?,?,?,?,?,?)`,
  ).run(ids.accountId, ids.profileId, FAMILY_ID, PARENT_ID, currentHash, NOW.toISOString(), NOW.toISOString());

  const staleSubscription = await playSubscription({
    subscriptionState: "SUBSCRIPTION_STATE_EXPIRED",
    linkedPurchaseToken: "SENTINEL_PREDECESSOR_PURCHASE_TOKEN",
    lineItems: [{
      productId: "hyeni_premium",
      expiryTime: "2026-07-12T00:00:00.000Z",
      offerDetails: { basePlanId: "monthly-2900" },
      autoRenewingPlan: {
        autoRenewEnabled: false,
        recurringPrice: { currencyCode: "KRW", units: "4900", nanos: 0 },
      },
      offerPhase: {},
    }],
  });
  const notifications = [];
  const response = await request(
    routes(fetchMock(staleSubscription).impl),
    env(db, notifications),
    subscriptionEnvelope("late-old-token", oldToken, "ignored", 13, NOW.getTime()),
  );

  assert.equal(response.status, 204);
  assert.deepEqual({ ...db.row(
    `SELECT status,purchase_token_hash,current_period_end,last_event_id
       FROM family_subscription WHERE family_id=?`,
    FAMILY_ID,
  ) }, {
    status: "active",
    purchase_token_hash: currentHash,
    current_period_end: "2026-08-20T00:00:00.000Z",
    last_event_id: "current-event",
  });
  assert.equal(db.row(
    "SELECT reservation_ref FROM billing_provider_reservations WHERE family_id=?",
    FAMILY_ID,
  ).reservation_ref, currentHash);
  assert.equal(db.row(
    "SELECT last_purchase_token_hash FROM google_play_billing_owners WHERE family_id=?",
    FAMILY_ID,
  ).last_purchase_token_hash, currentHash);
  assert.equal(db.row(
    "SELECT status,last_error FROM google_play_rtdn_events WHERE message_id='late-old-token'",
  ).status, "processed");
  assert.equal(notifications.length, 0);
  assert.notEqual(oldHash, currentHash);
});

test("같은 토큰의 더 오래된 RTDN은 최신 상태를 역전하지 않는다", async () => {
  const db = createDb();
  const tokenHash = await googlePlay.sha256Hex(RAW_TOKEN);
  await seedPurchaseOwner(db, RAW_TOKEN);
  db.sqlite.prepare(
    `INSERT INTO family_subscription
       (family_id,status,product_id,qonversion_user_id,provider,base_plan_id,
        purchase_token_hash,current_period_end,google_play_raw,raw_event,last_event_id,
        last_event_at,created_at,updated_at)
     VALUES (?,'cancelled','hyeni_premium',?,'google_play','monthly-2900',?,
       '2026-08-20T00:00:00.000Z','{}','{}','newer-cancel',
       '2026-07-13T12:05:00.000Z',?,?)`,
  ).run(FAMILY_ID, FAMILY_ID, tokenHash, NOW.toISOString(), NOW.toISOString());
  db.sqlite.prepare(
    `INSERT INTO billing_provider_reservations
       (family_id,provider,state,reservation_ref,created_at,updated_at)
     VALUES (?,'google_play','active',?,?,?)`,
  ).run(FAMILY_ID, tokenHash, NOW.toISOString(), NOW.toISOString());

  const notifications = [];
  const response = await request(
    routes(fetchMock(await playSubscription()).impl),
    env(db, notifications),
    subscriptionEnvelope("older-same-token", RAW_TOKEN, "ignored", 2, NOW.getTime()),
  );

  assert.equal(response.status, 204);
  assert.deepEqual({ ...db.row(
    "SELECT status,last_event_id,last_event_at FROM family_subscription WHERE family_id=?",
    FAMILY_ID,
  ) }, {
    status: "cancelled",
    last_event_id: "newer-cancel",
    last_event_at: "2026-07-13T12:05:00.000Z",
  });
  assert.equal(db.row(
    "SELECT status FROM google_play_rtdn_events WHERE message_id='older-same-token'",
  ).status, "processed");
  assert.equal(notifications.length, 0);
});

test("만료된 기존 구독은 +00 D1 시각이어도 linked token 없는 새 구매로 교체된다", async () => {
  const db = createDb();
  const oldHash = await googlePlay.sha256Hex("expired-old-token");
  const newHash = await googlePlay.sha256Hex("new-subscription-token");
  db.sqlite.prepare(
    `INSERT INTO family_subscription
       (family_id,status,product_id,qonversion_user_id,provider,base_plan_id,
        purchase_token_hash,current_period_end,google_play_raw,raw_event,last_event_id,
        last_event_at,created_at,updated_at)
     VALUES (?,'active','hyeni_premium',?,'google_play','monthly-2900',?,
       '2026-07-01 00:00:00.000+00','{}','{}','expired-event',
       '2026-07-01 00:00:00.000+00',?,?)`,
  ).run(FAMILY_ID, FAMILY_ID, oldHash, NOW.toISOString(), NOW.toISOString());
  db.sqlite.prepare(
    `INSERT INTO billing_provider_reservations
       (family_id,provider,state,reservation_ref,created_at,updated_at)
     VALUES (?,'google_play','active',?,?,?)`,
  ).run(FAMILY_ID, oldHash, NOW.toISOString(), NOW.toISOString());

  await googlePlay.upsertGooglePlayFamilySubscription(db, {
    familyId: FAMILY_ID,
    productId: "hyeni_premium",
    purchaseTokenHash: newHash,
    linkedPurchaseTokenHash: null,
    source: "google_play_purchase_verify",
    eventId: "new-subscription-event",
    eventAt: "2026-07-13T12:10:00.000Z",
    verified: {
      subscription: await playSubscription(),
      status: "active",
      productId: "hyeni_premium",
      currentPeriodEnd: "2026-08-13T12:10:00.000Z",
      trialEndsAt: null,
      basePlanId: "monthly-2900",
      offerId: "",
      linkedPurchaseToken: "",
      orderId: "new-order",
      acknowledgementState: "ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED",
    },
  }, {
    operation: "UPDATE",
    now: () => "2026-07-13 12:10:00.000+00",
  });

  assert.deepEqual({ ...db.row(
    "SELECT purchase_token_hash,last_event_id FROM family_subscription WHERE family_id=?",
    FAMILY_ID,
  ) }, {
    purchase_token_hash: newHash,
    last_event_id: "new-subscription-event",
  });
});

test("legacy +00 last_event_at도 같은 토큰의 최신 복원 이벤트를 막지 않는다", async () => {
  const db = createDb();
  const tokenHash = await googlePlay.sha256Hex(RAW_TOKEN);
  db.sqlite.prepare(
    `INSERT INTO family_subscription
       (family_id,status,product_id,qonversion_user_id,provider,base_plan_id,
        purchase_token_hash,current_period_end,google_play_raw,raw_event,last_event_id,
        last_event_at,created_at,updated_at)
     VALUES (?,'cancelled','hyeni_premium',?,'google_play','monthly-2900',?,
       '2026-08-01 00:00:00.000+00','{}','{}','legacy-event',
       '2026-07-13 12:05:00.000+00',?,?)`,
  ).run(FAMILY_ID, FAMILY_ID, tokenHash, NOW.toISOString(), NOW.toISOString());
  db.sqlite.prepare(
    `INSERT INTO billing_provider_reservations
       (family_id,provider,state,reservation_ref,created_at,updated_at)
     VALUES (?,'google_play','active',?,?,?)`,
  ).run(FAMILY_ID, tokenHash, NOW.toISOString(), NOW.toISOString());

  await googlePlay.upsertGooglePlayFamilySubscription(db, {
    familyId: FAMILY_ID,
    productId: "hyeni_premium",
    purchaseTokenHash: tokenHash,
    source: "google_play_purchase_verify",
    eventId: "restore-event",
    eventAt: "2026-07-13T12:10:00.000Z",
    verified: {
      subscription: await playSubscription(),
      status: "active",
      productId: "hyeni_premium",
      currentPeriodEnd: "2026-08-13T12:10:00.000Z",
      trialEndsAt: null,
      basePlanId: "monthly-2900",
      offerId: "",
      linkedPurchaseToken: "",
      orderId: "restore-order",
      acknowledgementState: "ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED",
    },
  }, {
    operation: "UPDATE",
    now: () => "2026-07-13 12:10:00.000+00",
  });

  assert.deepEqual({ ...db.row(
    "SELECT status,last_event_id FROM family_subscription WHERE family_id=?",
    FAMILY_ID,
  ) }, { status: "active", last_event_id: "restore-event" });
});

test("Toss 최초 결제가 미확정이면 RTDN Google 활성화는 retryable로 미루고 기존 provider 선점을 보존한다", async () => {
  const db = createDb();
  await seedPurchaseOwner(db, RAW_TOKEN);
  db.sqlite.prepare(
    `INSERT INTO billing_provider_reservations
       (family_id,provider,state,reservation_ref,created_at,updated_at)
     VALUES (?,'toss_web','reserved','web-pending-order',?,?)`,
  ).run(FAMILY_ID, NOW.toISOString(), NOW.toISOString());
  const response = await request(
    routes(fetchMock(await playSubscription()).impl),
    env(db),
    subscriptionEnvelope("toss-pending-google-rtdn"),
  );

  assert.equal(response.status, 503);
  assert.equal((await response.json()).error, "billing_provider_reconciliation_pending");
  assert.deepEqual({ ...db.row(
    "SELECT provider,state,conflicting_provider FROM billing_provider_reservations WHERE family_id=?",
    FAMILY_ID,
  ) }, {
    provider: "toss_web",
    state: "reserved",
    conflicting_provider: null,
  });
  assert.equal(db.row("SELECT COUNT(*) AS count FROM family_subscription").count, 0);
  assert.equal(db.row(
    "SELECT status FROM google_play_rtdn_events WHERE message_id='toss-pending-google-rtdn'",
  ).status, "retryable");
});

test("Toss 최초 결제가 미확정이면 직접 Google verify도 entitlement를 덮지 않고 409로 미룬다", async () => {
  const db = createDb();
  seedOwnerAccount(db);
  db.sqlite.prepare(
    `INSERT INTO billing_provider_reservations
       (family_id,provider,state,reservation_ref,created_at,updated_at)
     VALUES (?,'toss_web','reserved','web-pending-order',?,?)`,
  ).run(FAMILY_ID, NOW.toISOString(), NOW.toISOString());
  const { privateKey, publicKey } = await generateKeyPair("ES256", { extractable: true });
  const environment = {
    ...env(db),
    JWT_PRIVATE_KEY: JSON.stringify(await exportJWK(privateKey)),
    JWT_PUBLIC_KEY: JSON.stringify(await exportJWK(publicKey)),
  };
  const accessToken = await signAccessToken(environment, {
    sub: PARENT_ID,
    role: "parent",
    family_id: FAMILY_ID,
    is_anonymous: false,
  });
  const google = fetchMock(await playSubscription());
  const originalFetch = globalThis.fetch;
  globalThis.fetch = google.impl;
  try {
    const response = await googlePlayVerifyRoutes.request("http://local/google-play-verify", {
      method: "POST",
      headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
      body: JSON.stringify({
        familyId: FAMILY_ID,
        packageName: PACKAGE_NAME,
        productType: "subscription",
        productId: "hyeni_premium",
        basePlanId: "monthly-2900",
        offerId: "trial-7d",
        purchaseToken: RAW_TOKEN,
      }),
    }, environment);
    assert.equal(response.status, 409);
    assert.equal((await response.json()).error, "billing_provider_reconciliation_pending");
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(db.row("SELECT COUNT(*) AS count FROM family_subscription").count, 0);
  assert.deepEqual({ ...db.row(
    "SELECT provider,state,reservation_ref FROM billing_provider_reservations WHERE family_id=?",
    FAMILY_ID,
  ) }, {
    provider: "toss_web",
    state: "reserved",
    reservation_ref: "web-pending-order",
  });
});

test("완료된 Toss 체험 가족의 Google Play 무료 체험은 직접 verify에서 두 번째 권리를 열지 않는다", async () => {
  const db = createDb();
  seedOwnerAccount(db);
  seedCompletedTossTrial(db);
  const { privateKey, publicKey } = await generateKeyPair("ES256", { extractable: true });
  const environment = {
    ...env(db),
    JWT_PRIVATE_KEY: JSON.stringify(await exportJWK(privateKey)),
    JWT_PUBLIC_KEY: JSON.stringify(await exportJWK(publicKey)),
  };
  const accessToken = await signAccessToken(environment, {
    sub: PARENT_ID,
    role: "parent",
    family_id: FAMILY_ID,
    is_anonymous: false,
  });
  const google = fetchMock(await playSubscription({
    startTime: "2099-01-01T00:00:00.000Z",
    lineItems: [{
      productId: "hyeni_premium",
      expiryTime: "2099-01-08T00:00:00.000Z",
      offerDetails: { basePlanId: "monthly-2900", offerId: "trial-7d" },
      autoRenewingPlan: {
        autoRenewEnabled: true,
        recurringPrice: { currencyCode: "KRW", units: "4900", nanos: 0 },
      },
      offerPhase: { freeTrial: {} },
    }],
  }));
  const originalFetch = globalThis.fetch;
  globalThis.fetch = google.impl;
  try {
    const response = await googlePlayVerifyRoutes.request("http://local/google-play-verify", {
      method: "POST",
      headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
      body: JSON.stringify({
        familyId: FAMILY_ID,
        packageName: PACKAGE_NAME,
        productType: "subscription",
        productId: "hyeni_premium",
        basePlanId: "monthly-2900",
        offerId: "trial-7d",
        purchaseToken: RAW_TOKEN,
      }),
    }, environment);
    assert.equal(response.status, 409);
    assert.equal((await response.json()).error, "family_trial_already_used");
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(db.row("SELECT COUNT(*) AS count FROM family_subscription").count, 0);
  assert.equal(db.row(
    "SELECT checkout_session_id FROM web_billing_trial_claims WHERE family_id=?",
    FAMILY_ID,
  ).checkout_session_id, `web-trial-${FAMILY_ID}`);
});

test("완료된 Toss 체험 가족의 Google Play 무료 체험은 RTDN에서도 acknowledge·권리 부여 없이 닫는다", async () => {
  const db = createDb();
  await seedPurchaseOwner(db, RAW_TOKEN);
  seedCompletedTossTrial(db);
  const google = fetchMock(await playSubscription({
    startTime: "2099-01-01T00:00:00.000Z",
    acknowledgementState: "ACKNOWLEDGEMENT_STATE_PENDING",
    lineItems: [{
      productId: "hyeni_premium",
      expiryTime: "2099-01-08T00:00:00.000Z",
      offerDetails: { basePlanId: "monthly-2900", offerId: "trial-7d" },
      autoRenewingPlan: {
        autoRenewEnabled: true,
        recurringPrice: { currencyCode: "KRW", units: "4900", nanos: 0 },
      },
      offerPhase: { freeTrial: {} },
    }],
  }));
  const response = await request(
    routes(google.impl),
    env(db),
    subscriptionEnvelope("toss-trial-google-trial-rtdn"),
  );

  assert.equal(response.status, 204);
  assert.deepEqual({ ...db.row(
    "SELECT status,last_error FROM google_play_rtdn_events WHERE message_id=?",
    "toss-trial-google-trial-rtdn",
  ) }, {
    status: "processed",
    last_error: "family_trial_already_used",
  });
  assert.equal(db.row("SELECT COUNT(*) AS count FROM family_subscription").count, 0);
  assert.equal(google.calls.some((url) => url.endsWith(":acknowledge")), false);
});

test("Toss 체험 이력은 Google Play 유료 active 구독의 직접 verify를 막지 않는다", async () => {
  const db = createDb();
  seedOwnerAccount(db);
  seedCompletedTossTrial(db);
  const { privateKey, publicKey } = await generateKeyPair("ES256", { extractable: true });
  const environment = {
    ...env(db),
    JWT_PRIVATE_KEY: JSON.stringify(await exportJWK(privateKey)),
    JWT_PUBLIC_KEY: JSON.stringify(await exportJWK(publicKey)),
  };
  const accessToken = await signAccessToken(environment, {
    sub: PARENT_ID,
    role: "parent",
    family_id: FAMILY_ID,
    is_anonymous: false,
  });
  const google = fetchMock(await playSubscription());
  const originalFetch = globalThis.fetch;
  globalThis.fetch = google.impl;
  try {
    const response = await googlePlayVerifyRoutes.request("http://local/google-play-verify", {
      method: "POST",
      headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
      body: JSON.stringify({
        familyId: FAMILY_ID,
        packageName: PACKAGE_NAME,
        productType: "subscription",
        productId: "hyeni_premium",
        basePlanId: "monthly-2900",
        offerId: "trial-7d",
        purchaseToken: RAW_TOKEN,
      }),
    }, environment);
    assert.equal(response.status, 200);
    assert.equal((await response.json()).status, "active");
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(db.row("SELECT status FROM family_subscription WHERE family_id=?", FAMILY_ID).status, "active");
});

test("성공한 Google Play 무료 체험은 Toss와 공유하는 가족 claim을 남긴다", async () => {
  const db = createDb();
  await seedPurchaseOwner(db, RAW_TOKEN);
  const tokenHash = await googlePlay.sha256Hex(RAW_TOKEN);
  const google = fetchMock(await playSubscription({
    startTime: "2099-01-01T00:00:00.000Z",
    lineItems: [{
      productId: "hyeni_premium",
      expiryTime: "2099-01-08T00:00:00.000Z",
      offerDetails: { basePlanId: "monthly-2900", offerId: "trial-7d" },
      autoRenewingPlan: {
        autoRenewEnabled: true,
        recurringPrice: { currencyCode: "KRW", units: "4900", nanos: 0 },
      },
      offerPhase: { freeTrial: {} },
    }],
  }));
  const response = await request(
    routes(google.impl),
    env(db),
    subscriptionEnvelope("google-trial-family-claim"),
  );

  assert.equal(response.status, 204);
  assert.deepEqual({ ...db.row(
    `SELECT parent_id,checkout_session_id,provider,plan,status,trial_ends_at
       FROM web_billing_trial_claims WHERE family_id=?`,
    FAMILY_ID,
  ) }, {
    parent_id: PARENT_ID,
    checkout_session_id: `google-play:${tokenHash}`,
    provider: "google_play",
    plan: "month",
    status: "active",
    trial_ends_at: "2099-01-08 00:00:00.000+00",
  });
});

test("검증 mapping이 있는 15분 지난 Google reserved 고아 행은 새 Google·Toss 결제를 영구 차단하지 않는다", async () => {
  const run = async (provider, reservationRef) => {
    const db = createDb();
    seedOwnerAccount(db);
    const oldHash = await googlePlay.sha256Hex("orphan-google-token");
    db.sqlite.prepare(
      `INSERT INTO google_play_purchase_events
         (purchase_token_hash,family_id,parent_id,product_type,product_id,status,
          verification_result,created_at,updated_at)
       VALUES (?,?,?,'subscription','hyeni_premium','received','{}',?,?)`,
    ).run(oldHash, FAMILY_ID, PARENT_ID, NOW.toISOString(), NOW.toISOString());
    db.sqlite.prepare(
      `INSERT INTO billing_provider_reservations
         (family_id,provider,state,reservation_ref,created_at,updated_at)
       VALUES (?,'google_play','reserved',?,'2026-07-13 11:00:00.000+00',
               '2026-07-13 11:00:00.000+00')`,
    ).run(FAMILY_ID, oldHash);

    const claim = await claimBillingProvider(db, {
      familyId: FAMILY_ID,
      provider,
      reservationRef,
      now: NOW,
    });
    assert.equal(claim.status, "acquired");
    assert.deepEqual({ ...db.row(
      "SELECT provider,state,reservation_ref FROM billing_provider_reservations WHERE family_id=?",
      FAMILY_ID,
    ) }, { provider, state: "reserved", reservation_ref: reservationRef });
  };

  await run("google_play", "new-google-token-hash");
  await run("toss_web", "new-toss-order");
});

test("Google preflight lease는 Toss 동시 checkout을 막고 취소 release 뒤 즉시 넘겨준다", async () => {
  const db = createDb();
  seedOwnerAccount(db);
  const { privateKey, publicKey } = await generateKeyPair("ES256", { extractable: true });
  const environment = {
    ...env(db),
    JWT_PRIVATE_KEY: JSON.stringify(await exportJWK(privateKey)),
    JWT_PUBLIC_KEY: JSON.stringify(await exportJWK(publicKey)),
  };
  const accessToken = await signAccessToken(environment, {
    sub: PARENT_ID,
    role: "parent",
    family_id: FAMILY_ID,
    is_anonymous: false,
  });
  const preflight = await googlePlayVerifyRoutes.request("http://local/google-play-preflight", {
    method: "POST",
    headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
    body: JSON.stringify({ familyId: FAMILY_ID, basePlanId: "monthly-2900" }),
  }, environment);
  assert.equal(preflight.status, 200);
  const preflightBody = await preflight.json();
  assert.equal(preflightBody.ok, true);
  assert.equal(preflightBody.trialEligible, true);
  assert.match(preflightBody.reservationRef, /^google-play-preflight:[0-9a-f-]{36}$/);

  const tossWhileReserved = await claimBillingProvider(db, {
    familyId: FAMILY_ID,
    provider: "toss_web",
    reservationRef: "toss-racing-order",
    now: NOW,
  });
  assert.equal(tossWhileReserved.status, "deferred");

  const released = await googlePlayVerifyRoutes.request("http://local/google-play-preflight/release", {
    method: "POST",
    headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
    body: JSON.stringify({ familyId: FAMILY_ID, reservationRef: preflightBody.reservationRef }),
  }, environment);
  assert.equal(released.status, 200);
  assert.equal((await released.json()).released, true);

  const tossAfterCancel = await claimBillingProvider(db, {
    familyId: FAMILY_ID,
    provider: "toss_web",
    reservationRef: "toss-after-cancel",
    now: NOW,
  });
  assert.equal(tossAfterCancel.status, "acquired");
});

test("Google preflight는 가족 trial 이력과 기존 Toss active를 결제창 전에 fail-closed 판정한다", async () => {
  const db = createDb();
  seedOwnerAccount(db);
  seedCompletedTossTrial(db);
  const { privateKey, publicKey } = await generateKeyPair("ES256", { extractable: true });
  const environment = {
    ...env(db),
    JWT_PRIVATE_KEY: JSON.stringify(await exportJWK(privateKey)),
    JWT_PUBLIC_KEY: JSON.stringify(await exportJWK(publicKey)),
  };
  const accessToken = await signAccessToken(environment, {
    sub: PARENT_ID,
    role: "parent",
    family_id: FAMILY_ID,
    is_anonymous: false,
  });
  const eligibility = await googlePlayVerifyRoutes.request("http://local/google-play-trial-eligibility", {
    method: "POST",
    headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
    body: JSON.stringify({ familyId: FAMILY_ID }),
  }, environment);
  assert.equal(eligibility.status, 200);
  assert.equal((await eligibility.json()).trialEligible, false);

  const tossEnd = "2026-09-01T00:00:00.000Z";
  db.sqlite.prepare(
    `INSERT INTO family_subscription
       (family_id,status,product_id,qonversion_user_id,provider,base_plan_id,
        current_period_end,google_play_raw,raw_event,created_at,updated_at)
     VALUES (?,'active','hyeni_premium_monthly',?,'toss_web','web-month',?,'{}','{}',?,?)`,
  ).run(FAMILY_ID, `toss:${FAMILY_ID}`, tossEnd, NOW.toISOString(), NOW.toISOString());
  db.sqlite.prepare(
    `INSERT INTO billing_provider_reservations
       (family_id,provider,state,reservation_ref,created_at,updated_at)
     VALUES (?,'toss_web','active','toss-existing-active',?,?)`,
  ).run(FAMILY_ID, NOW.toISOString(), NOW.toISOString());
  const preflight = await googlePlayVerifyRoutes.request("http://local/google-play-preflight", {
    method: "POST",
    headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
    body: JSON.stringify({ familyId: FAMILY_ID, basePlanId: "monthly-2900" }),
  }, environment);
  assert.equal(preflight.status, 409);
  assert.equal((await preflight.json()).error, "other_billing_provider_active");
  assert.deepEqual({ ...db.row(
    "SELECT provider,state,reservation_ref FROM billing_provider_reservations WHERE family_id=?",
    FAMILY_ID,
  ) }, {
    provider: "toss_web",
    state: "active",
    reservation_ref: "toss-existing-active",
  });
});

test("직접 verify는 서버 preflightRef를 purchase token hash로 교환해 active를 확정한다", async () => {
  const db = createDb();
  seedOwnerAccount(db);
  const { privateKey, publicKey } = await generateKeyPair("ES256", { extractable: true });
  const environment = {
    ...env(db),
    JWT_PRIVATE_KEY: JSON.stringify(await exportJWK(privateKey)),
    JWT_PUBLIC_KEY: JSON.stringify(await exportJWK(publicKey)),
  };
  const accessToken = await signAccessToken(environment, {
    sub: PARENT_ID,
    role: "parent",
    family_id: FAMILY_ID,
    is_anonymous: false,
  });
  const preflight = await googlePlayVerifyRoutes.request("http://local/google-play-preflight", {
    method: "POST",
    headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
    body: JSON.stringify({ familyId: FAMILY_ID, basePlanId: "monthly-2900" }),
  }, environment);
  const reservationRef = (await preflight.json()).reservationRef;
  const google = fetchMock(await playSubscription());
  const originalFetch = globalThis.fetch;
  globalThis.fetch = google.impl;
  try {
    const verified = await googlePlayVerifyRoutes.request("http://local/google-play-verify", {
      method: "POST",
      headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
      body: JSON.stringify({
        familyId: FAMILY_ID,
        packageName: PACKAGE_NAME,
        productType: "subscription",
        productId: "hyeni_premium",
        basePlanId: "monthly-2900",
        offerId: "trial-7d",
        offerToken: "eligible-offer-token",
        providerReservationRef: reservationRef,
        purchaseToken: RAW_TOKEN,
      }),
    }, environment);
    assert.equal(verified.status, 200);
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.deepEqual({ ...db.row(
    "SELECT provider,state,reservation_ref FROM billing_provider_reservations WHERE family_id=?",
    FAMILY_ID,
  ) }, {
    provider: "google_play",
    state: "active",
    reservation_ref: await googlePlay.sha256Hex(RAW_TOKEN),
  });
});

test("직접 Google verify 실패는 provider 응답 원문 없이 고정 오류 코드만 반환한다", async () => {
  const db = createDb();
  seedOwnerAccount(db);
  const { privateKey, publicKey } = await generateKeyPair("ES256", { extractable: true });
  const environment = {
    ...env(db),
    JWT_PRIVATE_KEY: JSON.stringify(await exportJWK(privateKey)),
    JWT_PUBLIC_KEY: JSON.stringify(await exportJWK(publicKey)),
  };
  const accessToken = await signAccessToken(environment, {
    sub: PARENT_ID,
    role: "parent",
    family_id: FAMILY_ID,
    is_anonymous: false,
  });
  const sentinel = "PRIVATE_GOOGLE_PROVIDER_RESPONSE_SENTINEL";
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const value = String(url);
    if (value === "https://oauth2.googleapis.com/token") {
      return Response.json({ access_token: "access-token" });
    }
    if (value.includes("purchases/subscriptionsv2/tokens/")) {
      return Response.json({ error: sentinel }, { status: 502 });
    }
    throw new Error(`unexpected fetch: ${value}`);
  };
  try {
    const response = await googlePlayVerifyRoutes.request("http://local/google-play-verify", {
      method: "POST",
      headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
      body: JSON.stringify({
        familyId: FAMILY_ID,
        packageName: PACKAGE_NAME,
        productType: "subscription",
        productId: "hyeni_premium",
        basePlanId: "monthly-2900",
        offerId: "trial-7d",
        purchaseToken: "provider-error-purchase-token",
      }),
    }, environment);
    assert.equal(response.status, 502);
    const body = await response.json();
    assert.deepEqual(body, { ok: false, error: "verification_failed" });
    assert.equal(JSON.stringify(body).includes(sentinel), false);
    assert.equal(Object.hasOwn(body, "details"), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("직접 verify의 독립 Google 중복 구매는 기존 구독을 보존하고 신규 주문만 자동 환불한다", async () => {
  const db = createDb();
  seedOwnerAccount(db);
  const incumbentTokenHash = await googlePlay.sha256Hex("incumbent-google-token");
  const duplicateToken = "independent-duplicate-google-token";
  const duplicateTokenHash = await googlePlay.sha256Hex(duplicateToken);
  db.sqlite.prepare(
    `INSERT INTO family_subscription
       (family_id,status,product_id,qonversion_user_id,provider,base_plan_id,
        purchase_token_hash,latest_order_id,current_period_end,google_play_raw,raw_event,
        last_event_at,created_at,updated_at)
     VALUES (?,'active','hyeni_premium',?,'google_play','monthly-2900',?,
             'incumbent-order','2099-09-01T00:00:00.000Z','{}','{}',?,?,?)`,
  ).run(
    FAMILY_ID,
    FAMILY_ID,
    incumbentTokenHash,
    NOW.toISOString(),
    NOW.toISOString(),
    NOW.toISOString(),
  );
  db.sqlite.prepare(
    `INSERT INTO billing_provider_reservations
       (family_id,provider,state,reservation_ref,created_at,updated_at)
     VALUES (?,'google_play','active',?,?,?)`,
  ).run(FAMILY_ID, incumbentTokenHash, NOW.toISOString(), NOW.toISOString());

  const { privateKey, publicKey } = await generateKeyPair("ES256", { extractable: true });
  const environment = {
    ...env(db),
    JWT_PRIVATE_KEY: JSON.stringify(await exportJWK(privateKey)),
    JWT_PUBLIC_KEY: JSON.stringify(await exportJWK(publicKey)),
  };
  const accessToken = await signAccessToken(environment, {
    sub: PARENT_ID,
    role: "parent",
    family_id: FAMILY_ID,
    is_anonymous: false,
  });
  const google = fetchMock(await playSubscription({
    latestOrderId: "independent-duplicate-order",
    linkedPurchaseToken: "",
  }));
  const originalFetch = globalThis.fetch;
  globalThis.fetch = google.impl;
  try {
    const response = await googlePlayVerifyRoutes.request("http://local/google-play-verify", {
      method: "POST",
      headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
      body: JSON.stringify({
        familyId: FAMILY_ID,
        packageName: PACKAGE_NAME,
        productType: "subscription",
        productId: "hyeni_premium",
        basePlanId: "monthly-2900",
        offerId: "trial-7d",
        purchaseToken: duplicateToken,
      }),
    }, environment);
    assert.equal(response.status, 409);
    assert.equal((await response.json()).error, "stale_purchase_refunded");
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(
    google.calls.some((url) => url.endsWith("/orders/independent-duplicate-order:refund?revoke=true")),
    true,
  );
  assert.deepEqual({ ...db.row(
    `SELECT provider,status,purchase_token_hash,latest_order_id,current_period_end
       FROM family_subscription WHERE family_id=?`,
    FAMILY_ID,
  ) }, {
    provider: "google_play",
    status: "active",
    purchase_token_hash: incumbentTokenHash,
    latest_order_id: "incumbent-order",
    current_period_end: "2099-09-01T00:00:00.000Z",
  });
  assert.deepEqual({ ...db.row(
    "SELECT provider,state,reservation_ref FROM billing_provider_reservations WHERE family_id=?",
    FAMILY_ID,
  ) }, {
    provider: "google_play",
    state: "active",
    reservation_ref: incumbentTokenHash,
  });
  assert.deepEqual({ ...db.row(
    `SELECT status,order_id,granted_at FROM google_play_purchase_events
      WHERE purchase_token_hash=?`,
    duplicateTokenHash,
  ) }, {
    status: "stale_refunded",
    order_id: "independent-duplicate-order",
    granted_at: null,
  });
});

test("독립 Google 중복 구매 환불 실패는 pending으로 남고 재시도 성공 시 한 번만 완료된다", async () => {
  const db = createDb();
  seedOwnerAccount(db);
  const incumbentTokenHash = await googlePlay.sha256Hex("refund-retry-incumbent-token");
  const duplicateToken = "refund-retry-duplicate-token";
  const duplicateTokenHash = await googlePlay.sha256Hex(duplicateToken);
  db.sqlite.prepare(
    `INSERT INTO family_subscription
       (family_id,status,product_id,qonversion_user_id,provider,base_plan_id,
        purchase_token_hash,latest_order_id,current_period_end,google_play_raw,raw_event,
        last_event_at,created_at,updated_at)
     VALUES (?,'active','hyeni_premium',?,'google_play','monthly-2900',?,
             'retry-incumbent-order','2099-09-01T00:00:00.000Z','{}','{}',?,?,?)`,
  ).run(FAMILY_ID, FAMILY_ID, incumbentTokenHash, NOW.toISOString(), NOW.toISOString(), NOW.toISOString());
  db.sqlite.prepare(
    `INSERT INTO billing_provider_reservations
       (family_id,provider,state,reservation_ref,created_at,updated_at)
     VALUES (?,'google_play','active',?,?,?)`,
  ).run(FAMILY_ID, incumbentTokenHash, NOW.toISOString(), NOW.toISOString());

  const { privateKey, publicKey } = await generateKeyPair("ES256", { extractable: true });
  const environment = {
    ...env(db),
    JWT_PRIVATE_KEY: JSON.stringify(await exportJWK(privateKey)),
    JWT_PUBLIC_KEY: JSON.stringify(await exportJWK(publicKey)),
  };
  const accessToken = await signAccessToken(environment, {
    sub: PARENT_ID,
    role: "parent",
    family_id: FAMILY_ID,
    is_anonymous: false,
  });
  const requestBody = JSON.stringify({
    familyId: FAMILY_ID,
    packageName: PACKAGE_NAME,
    productType: "subscription",
    productId: "hyeni_premium",
    basePlanId: "monthly-2900",
    offerId: "trial-7d",
    purchaseToken: duplicateToken,
  });
  const runVerify = (fetchImpl) => {
    const previousFetch = globalThis.fetch;
    globalThis.fetch = fetchImpl;
    return googlePlayVerifyRoutes.request("http://local/google-play-verify", {
      method: "POST",
      headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
      body: requestBody,
    }, environment).finally(() => {
      globalThis.fetch = previousFetch;
    });
  };

  const failed = await runVerify(fetchMock(await playSubscription({
    latestOrderId: "retry-duplicate-order",
    linkedPurchaseToken: "",
  }), { refundStatus: 500 }).impl);
  assert.equal(failed.status, 503);
  assert.equal((await failed.json()).error, "billing_provider_refund_failed");
  assert.equal(
    db.row("SELECT status FROM google_play_purchase_events WHERE purchase_token_hash=?", duplicateTokenHash).status,
    "stale_refund_pending",
  );

  const retriedGoogle = fetchMock(await playSubscription({
    latestOrderId: "retry-duplicate-order",
    linkedPurchaseToken: "",
  }));
  const retried = await runVerify(retriedGoogle.impl);
  assert.equal(retried.status, 409);
  assert.equal((await retried.json()).error, "stale_purchase_refunded");
  assert.equal(
    db.row("SELECT status FROM google_play_purchase_events WHERE purchase_token_hash=?", duplicateTokenHash).status,
    "stale_refunded",
  );
  assert.equal(
    retriedGoogle.calls.filter((url) => url.endsWith("/orders/retry-duplicate-order:refund?revoke=true")).length,
    1,
  );
  assert.equal(
    db.row("SELECT purchase_token_hash FROM family_subscription WHERE family_id=?", FAMILY_ID).purchase_token_hash,
    incumbentTokenHash,
  );
});

test("Google preflightRef는 검증된 purchase hash로 원자 전환되고 재시도도 deferred되지 않는다", async () => {
  const db = createDb();
  const preflightRef = "google-play-preflight:11111111-1111-4111-8111-111111111111";
  const purchaseHash = await googlePlay.sha256Hex("verified-purchase-for-preflight");
  const reserved = await claimBillingProvider(db, {
    familyId: FAMILY_ID,
    provider: "google_play",
    reservationRef: preflightRef,
    now: NOW,
  });
  assert.equal(reserved.status, "acquired");

  const exchanged = await claimBillingProvider(db, {
    familyId: FAMILY_ID,
    provider: "google_play",
    reservationRef: purchaseHash,
    expectedReservationRef: preflightRef,
    now: NOW,
  });
  assert.equal(exchanged.status, "acquired");
  assert.equal(exchanged.row.reservation_ref, purchaseHash);

  const responseLostRetry = await claimBillingProvider(db, {
    familyId: FAMILY_ID,
    provider: "google_play",
    reservationRef: purchaseHash,
    expectedReservationRef: preflightRef,
    now: new Date(NOW.getTime() + 1_000),
  });
  assert.equal(responseLostRetry.status, "acquired");

  const restoreFamilyId = "family-restore-after-response-loss";
  const restorePreflightRef = "google-play-preflight:33333333-3333-4333-8333-333333333333";
  await claimBillingProvider(db, {
    familyId: restoreFamilyId,
    provider: "google_play",
    reservationRef: restorePreflightRef,
    now: NOW,
  });
  const restoreWithoutClientRef = await claimBillingProvider(db, {
    familyId: restoreFamilyId,
    provider: "google_play",
    reservationRef: await googlePlay.sha256Hex("restored-purchase-token"),
    now: new Date(NOW.getTime() + 1_000),
  });
  assert.equal(
    restoreWithoutClientRef.status,
    "acquired",
    "구매 성공 뒤 앱 응답이 유실돼 preflightRef를 잃어도 서버 검증된 restore는 즉시 교환해야 합니다",
  );
});

test("purchase mapping이 아직 없는 15분 지난 preflight lease도 자동 회수된다", async () => {
  const db = createDb();
  db.sqlite.prepare(
    `INSERT INTO billing_provider_reservations
       (family_id,provider,state,reservation_ref,created_at,updated_at)
     VALUES (?,'google_play','reserved',?,'2026-07-13 11:00:00.000+00',
             '2026-07-13 11:00:00.000+00')`,
  ).run(FAMILY_ID, "google-play-preflight:22222222-2222-4222-8222-222222222222");

  const toss = await claimBillingProvider(db, {
    familyId: FAMILY_ID,
    provider: "toss_web",
    reservationRef: "toss-after-stale-play-preflight",
    now: NOW,
  });
  assert.equal(toss.status, "acquired");
  assert.deepEqual({ ...db.row(
    "SELECT provider,state,reservation_ref FROM billing_provider_reservations WHERE family_id=?",
    FAMILY_ID,
  ) }, {
    provider: "toss_web",
    state: "reserved",
    reservation_ref: "toss-after-stale-play-preflight",
  });
});

test("Google verify는 provider 선점 전에 검증된 received owner mapping을 기록한다", () => {
  const source = readFileSync(new URL("../routes/google-play-verify.ts", import.meta.url), "utf8");
  const verified = source.indexOf("const canApplySubscription");
  const mapping = source.indexOf("await markPurchaseReceived(verified.basePlanId)", verified);
  const claim = source.indexOf("providerClaim = await claimBillingProvider", verified);
  assert.ok(verified >= 0 && mapping > verified && claim > mapping);
});

test("Toss가 이미 활성인데 RTDN Google 구매가 확인되면 자동 환불하고 Toss active를 보존한다", async () => {
  const db = createDb();
  await seedPurchaseOwner(db, RAW_TOKEN);
  const tossEnd = "2026-09-01T00:00:00.000Z";
  db.sqlite.prepare(
    `INSERT INTO family_subscription
       (family_id,status,product_id,qonversion_user_id,provider,base_plan_id,
        current_period_end,google_play_raw,raw_event,created_at,updated_at)
     VALUES (?,'active','hyeni_premium_monthly',?,'toss_web','web-month',?,'{}','{}',?,?)`,
  ).run(FAMILY_ID, `toss:${FAMILY_ID}`, tossEnd, NOW.toISOString(), NOW.toISOString());
  db.sqlite.prepare(
    `INSERT INTO billing_provider_reservations
       (family_id,provider,state,reservation_ref,created_at,updated_at)
     VALUES (?,'toss_web','active','toss-order-safe',?,?)`,
  ).run(FAMILY_ID, NOW.toISOString(), NOW.toISOString());

  const google = fetchMock(await playSubscription());
  const response = await request(
    routes(google.impl),
    env(db),
    subscriptionEnvelope("toss-active-google-conflict"),
  );

  assert.equal(response.status, 204);
  assert.deepEqual({ ...db.row(
    "SELECT provider,status,current_period_end FROM family_subscription WHERE family_id=?",
    FAMILY_ID,
  ) }, {
    provider: "toss_web",
    status: "active",
    current_period_end: tossEnd,
  });
  assert.deepEqual({ ...db.row(
    `SELECT provider,state,conflicting_provider,conflict_ref,conflict_reason,resolution_status
       FROM billing_provider_reservations WHERE family_id=?`,
    FAMILY_ID,
  ) }, {
    provider: "toss_web",
    state: "active",
    conflicting_provider: null,
    conflict_ref: null,
    conflict_reason: null,
    resolution_status: null,
  });
  assert.equal(google.calls.some((url) => url.endsWith("/orders/order-from-google:refund?revoke=true")), true);
  assert.deepEqual({ ...db.row(
    "SELECT status,last_error FROM google_play_rtdn_events WHERE message_id='toss-active-google-conflict'",
  ) }, {
    status: "processed",
    last_error: "billing_provider_conflict_refunded",
  });
});

test("Google 자동 환불 실패는 RTDN retryable로 남기고 재시도 성공 뒤 Toss active를 복구한다", async () => {
  const db = createDb();
  await seedPurchaseOwner(db, RAW_TOKEN);
  db.sqlite.prepare(
    `INSERT INTO family_subscription
       (family_id,status,product_id,qonversion_user_id,provider,base_plan_id,
        current_period_end,google_play_raw,raw_event,created_at,updated_at)
     VALUES (?,'active','hyeni_premium_monthly',?,'toss_web','web-month',?,'{}','{}',?,?)`,
  ).run(FAMILY_ID, `toss:${FAMILY_ID}`, "2026-09-01T00:00:00.000Z", NOW.toISOString(), NOW.toISOString());
  db.sqlite.prepare(
    `INSERT INTO billing_provider_reservations
       (family_id,provider,state,reservation_ref,created_at,updated_at)
     VALUES (?,'toss_web','active','toss-renewal-safe',?,?)`,
  ).run(FAMILY_ID, NOW.toISOString(), NOW.toISOString());
  const body = subscriptionEnvelope("toss-active-refund-retry");

  const failed = await request(
    routes(fetchMock(await playSubscription(), { refundStatus: 500 }).impl),
    env(db),
    body,
  );
  assert.equal(failed.status, 503);
  assert.equal((await failed.json()).error, "billing_provider_refund_failed");
  assert.deepEqual({ ...db.row(
    "SELECT provider,state,conflicting_provider FROM billing_provider_reservations WHERE family_id=?",
    FAMILY_ID,
  ) }, { provider: "toss_web", state: "active", conflicting_provider: null });
  assert.equal(
    db.row("SELECT status FROM google_play_rtdn_events WHERE message_id='toss-active-refund-retry'").status,
    "retryable",
  );

  const retried = await request(
    routes(fetchMock(await playSubscription()).impl),
    env(db),
    body,
  );
  assert.equal(retried.status, 204);
  assert.deepEqual({ ...db.row(
    "SELECT provider,state,conflicting_provider FROM billing_provider_reservations WHERE family_id=?",
    FAMILY_ID,
  ) }, { provider: "toss_web", state: "active", conflicting_provider: null });
  assert.deepEqual({ ...db.row(
    "SELECT status,last_error FROM google_play_rtdn_events WHERE message_id='toss-active-refund-retry'",
  ) }, { status: "processed", last_error: "billing_provider_conflict_refunded" });
});

test("기존 refund_required 충돌 행도 Google 환불 확인과 함께 Toss active로 자동 복구한다", async () => {
  const db = createDb();
  await seedPurchaseOwner(db, RAW_TOKEN);
  db.sqlite.prepare(
    `INSERT INTO family_subscription
       (family_id,status,product_id,qonversion_user_id,provider,base_plan_id,
        current_period_end,google_play_raw,raw_event,created_at,updated_at)
     VALUES (?,'active','hyeni_premium_monthly',?,'toss_web','web-month',?,'{}','{}',?,?)`,
  ).run(FAMILY_ID, `toss:${FAMILY_ID}`, "2026-09-01T00:00:00.000Z", NOW.toISOString(), NOW.toISOString());
  db.sqlite.prepare(
    `INSERT INTO billing_provider_reservations
       (family_id,provider,state,reservation_ref,conflicting_provider,conflict_ref,
        conflict_reason,resolution_status,created_at,updated_at)
     VALUES (?,'toss_web','conflict','toss-legacy-safe','google_play','order-from-google',
             'google_purchase_after_toss_activation','refund_required',?,?)`,
  ).run(FAMILY_ID, NOW.toISOString(), NOW.toISOString());

  const response = await request(
    routes(fetchMock(await playSubscription()).impl),
    env(db),
    subscriptionEnvelope("legacy-conflict-refund-recovery"),
  );
  assert.equal(response.status, 204);
  assert.deepEqual({ ...db.row(
    `SELECT provider,state,conflicting_provider,conflict_ref,conflict_reason,resolution_status
       FROM billing_provider_reservations WHERE family_id=?`,
    FAMILY_ID,
  ) }, {
    provider: "toss_web",
    state: "active",
    conflicting_provider: null,
    conflict_ref: null,
    conflict_reason: null,
    resolution_status: null,
  });
});

test("Toss 활성 중 직접 Google 구매도 자동 환불하고 기존 Toss renewal 상태를 끊지 않는다", async () => {
  const db = createDb();
  seedOwnerAccount(db);
  const tossEnd = "2026-09-01T00:00:00.000Z";
  db.sqlite.prepare(
    `INSERT INTO family_subscription
       (family_id,status,product_id,qonversion_user_id,provider,base_plan_id,
        current_period_end,google_play_raw,raw_event,created_at,updated_at)
     VALUES (?,'active','hyeni_premium_monthly',?,'toss_web','web-month',?,'{}','{}',?,?)`,
  ).run(FAMILY_ID, `toss:${FAMILY_ID}`, tossEnd, NOW.toISOString(), NOW.toISOString());
  db.sqlite.prepare(
    `INSERT INTO billing_provider_reservations
       (family_id,provider,state,reservation_ref,created_at,updated_at)
     VALUES (?,'toss_web','active','toss-order-safe',?,?)`,
  ).run(FAMILY_ID, NOW.toISOString(), NOW.toISOString());
  const { privateKey, publicKey } = await generateKeyPair("ES256", { extractable: true });
  const environment = {
    ...env(db),
    JWT_PRIVATE_KEY: JSON.stringify(await exportJWK(privateKey)),
    JWT_PUBLIC_KEY: JSON.stringify(await exportJWK(publicKey)),
  };
  const accessToken = await signAccessToken(environment, {
    sub: PARENT_ID,
    role: "parent",
    family_id: FAMILY_ID,
    is_anonymous: false,
  });
  const google = fetchMock(await playSubscription());
  const originalFetch = globalThis.fetch;
  globalThis.fetch = google.impl;
  try {
    const response = await googlePlayVerifyRoutes.request("http://local/google-play-verify", {
      method: "POST",
      headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
      body: JSON.stringify({
        familyId: FAMILY_ID,
        packageName: PACKAGE_NAME,
        productType: "subscription",
        productId: "hyeni_premium",
        basePlanId: "monthly-2900",
        offerId: "trial-7d",
        purchaseToken: RAW_TOKEN,
      }),
    }, environment);
    assert.equal(response.status, 409);
    assert.equal((await response.json()).error, "billing_provider_conflict_refunded");
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(google.calls.some((url) => url.endsWith("/orders/order-from-google:refund?revoke=true")), true);
  assert.deepEqual({ ...db.row(
    `SELECT provider,state,conflicting_provider,resolution_status
       FROM billing_provider_reservations WHERE family_id=?`,
    FAMILY_ID,
  ) }, {
    provider: "toss_web",
    state: "active",
    conflicting_provider: null,
    resolution_status: null,
  });
  assert.equal(
    db.row("SELECT status FROM google_play_purchase_events WHERE family_id=?", FAMILY_ID).status,
    "conflict_refunded",
  );
});

test("RTDN은 재검증된 trial·기간 연장·revoke만 서버 퍼널에 멱등 기록한다", async () => {
  const scenarios = [
    {
      name: "trial",
      notificationType: 4,
      expectedEvent: "trial_start",
      previous: null,
      subscription: await playSubscription({
        startTime: "2026-07-13T00:00:00.000Z",
        lineItems: [{
          productId: "hyeni_premium",
          expiryTime: "2026-07-20T00:00:00.000Z",
          offerDetails: { basePlanId: "monthly-2900", offerId: "trial-7d" },
          autoRenewingPlan: {
            autoRenewEnabled: true,
            recurringPrice: { currencyCode: "KRW", units: "4900", nanos: 0 },
          },
          offerPhase: { freeTrial: {} },
        }],
      }),
    },
    {
      name: "renewal",
      notificationType: 2,
      expectedEvent: "renewal",
      previous: {
        status: "active",
        currentPeriodEnd: "2026-07-20T00:00:00.000Z",
      },
      subscription: await playSubscription(),
    },
    {
      name: "refund",
      notificationType: 12,
      expectedEvent: "refund",
      previous: {
        status: "active",
        currentPeriodEnd: "2026-08-13T00:00:00.000Z",
      },
      subscription: await playSubscription({
        subscriptionState: "SUBSCRIPTION_STATE_EXPIRED",
        lineItems: [{
          productId: "hyeni_premium",
          expiryTime: "2026-07-13T11:59:59.000Z",
          offerDetails: { basePlanId: "monthly-2900" },
          autoRenewingPlan: {
            autoRenewEnabled: false,
            recurringPrice: { currencyCode: "KRW", units: "4900", nanos: 0 },
          },
          offerPhase: {},
        }],
      }),
    },
  ];

  for (const scenario of scenarios) {
    const db = createDb();
    await seedPurchaseOwner(db, RAW_TOKEN);
    if (scenario.previous) {
      db.sqlite.prepare(
        `INSERT INTO family_subscription
          (family_id,status,product_id,qonversion_user_id,provider,base_plan_id,
           purchase_token_hash,current_period_end,trial_ends_at,google_play_raw,raw_event,
           created_at,updated_at)
         VALUES (?,?, 'hyeni_premium',?,'google_play','monthly-2900',?,?,NULL,'{}','{}',?,?)`,
      ).run(
        FAMILY_ID,
        scenario.previous.status,
        FAMILY_ID,
        await googlePlay.sha256Hex(RAW_TOKEN),
        scenario.previous.currentPeriodEnd,
        NOW.toISOString(),
        NOW.toISOString(),
      );
    }
    const environment = enablePremiumFunnel(db, env(db));
    const google = fetchMock(scenario.subscription);
    const app = routes(google.impl);

    const first = await request(
      app,
      environment,
      subscriptionEnvelope(`funnel-${scenario.name}-1`, RAW_TOKEN, "ignored", scenario.notificationType),
    );
    assert.equal(first.status, 204, scenario.name);
    assert.deepEqual({ ...db.row(
      "SELECT event,provider,plan,app_version FROM premium_funnel_events",
    ) }, {
      event: scenario.expectedEvent,
      provider: "google_play",
      plan: "month",
      app_version: null,
    });

    const second = await request(
      app,
      environment,
      subscriptionEnvelope(`funnel-${scenario.name}-2`, RAW_TOKEN, "ignored", scenario.notificationType),
    );
    assert.equal(second.status, 204, `${scenario.name} replay`);
    assert.equal(db.row("SELECT COUNT(*) AS count FROM premium_funnel_events").count, 1);
    const stored = JSON.stringify(db.rows("SELECT * FROM premium_funnel_events"));
    assert.equal(stored.includes(FAMILY_ID), false);
    assert.equal(stored.includes(RAW_TOKEN), false);
    assert.equal(stored.includes("order-from-google"), false);
  }
});

test("RTDN owner 확인 뒤 계정 삭제가 완료되면 삭제된 결제 그래프를 다시 만들지 않는다", async () => {
  const db = createDb();
  await seedPurchaseOwner(db, RAW_TOKEN);
  const subscription = await playSubscription({ acknowledgementState: "ACKNOWLEDGEMENT_STATE_PENDING" });
  const google = fetchMock(subscription, {
    onAcknowledge: async () => {
      db.sqlite.prepare("DELETE FROM family_members WHERE family_id=?").run(FAMILY_ID);
      db.sqlite.prepare("DELETE FROM google_play_purchase_events WHERE family_id=?").run(FAMILY_ID);
      db.sqlite.prepare("DELETE FROM google_play_billing_owners WHERE family_id=?").run(FAMILY_ID);
      db.sqlite.prepare("DELETE FROM family_subscription WHERE family_id=?").run(FAMILY_ID);
      db.sqlite.prepare("DELETE FROM families WHERE id=?").run(FAMILY_ID);
      db.sqlite.prepare("DELETE FROM users WHERE id=?").run(PARENT_ID);
    },
  });

  const response = await request(
    routes(google.impl),
    env(db),
    subscriptionEnvelope("deleted-owner-race"),
  );

  assert.notEqual(response.status, 204);
  assert.equal(db.row("SELECT COUNT(*) AS count FROM family_subscription").count, 0);
  assert.equal(db.row("SELECT COUNT(*) AS count FROM google_play_purchase_events").count, 0);
  assert.equal(db.row("SELECT COUNT(*) AS count FROM google_play_billing_owners").count, 0);
  assert.equal(db.row("SELECT status FROM google_play_rtdn_events WHERE message_id='deleted-owner-race'").status, "retryable");
});

test("linked token과 exact binding도 owner를 찾고 subscriptionId 입력값은 신뢰하지 않는다", async () => {
  for (const mode of ["linked", "binding"]) {
    const db = createDb();
    const ids = await ownerIds();
    if (mode === "linked") await seedPurchaseOwner(db, LINKED_TOKEN);
    else {
      seedOwnerAccount(db);
      db.sqlite.prepare("INSERT INTO google_play_billing_owners VALUES (?,?,?,?,?,?,?)")
        .run(ids.accountId, ids.profileId, FAMILY_ID, PARENT_ID, null, NOW.toISOString(), NOW.toISOString());
    }
    const google = fetchMock(await playSubscription());
    const response = await request(routes(google.impl), env(db), subscriptionEnvelope(`owner-${mode}`, RAW_TOKEN, "wrong-client-product"));
    assert.equal(response.status, 204);
    assert.equal(db.row("SELECT status FROM google_play_rtdn_events").status, "processed");
  }
});

test("owner 미매핑과 package 설정 오류는 retryable 503이다", async () => {
  const db = createDb();
  const google = fetchMock(await playSubscription());
  assert.equal((await request(routes(google.impl), env(db), subscriptionEnvelope("unmapped"))).status, 503);
  assert.equal(db.row("SELECT status FROM google_play_rtdn_events").status, "retryable");

  const badDb = createDb();
  const badEnv = env(badDb);
  badEnv.GOOGLE_PLAY_PACKAGE_NAME = "wrong.package";
  assert.equal((await request(routes(google.impl), badEnv, subscriptionEnvelope("bad-package"))).status, 503);
  assert.equal(badDb.row("SELECT status FROM google_play_rtdn_events").status, "retryable");
});

test("owner·product·base mismatch는 entitlement 없이 ignored 처리한다", async () => {
  const cases = [
    { name: "owner", subscription: await playSubscription({ externalAccountIdentifiers: { obfuscatedExternalAccountId: "wrong", obfuscatedExternalProfileId: "wrong" } }) },
    { name: "product", subscription: await playSubscription({ lineItems: [{ productId: "wrong", expiryTime: "2026-08-13T00:00:00.000Z", offerDetails: { basePlanId: "monthly-2900" } }] }) },
    { name: "base", subscription: await playSubscription({ lineItems: [{ productId: "hyeni_premium", expiryTime: "2026-08-13T00:00:00.000Z", offerDetails: { basePlanId: "wrong-base" } }] }) },
  ];
  for (const item of cases) {
    const db = createDb();
    await seedPurchaseOwner(db, RAW_TOKEN);
    const response = await request(routes(fetchMock(item.subscription).impl), env(db), subscriptionEnvelope(`mismatch-${item.name}`));
    assert.equal(response.status, 204);
    assert.equal(db.row("SELECT status FROM google_play_rtdn_events").status, "ignored");
    assert.equal(db.row("SELECT COUNT(*) AS count FROM family_subscription").count, 0);
  }
});

test("출시 가격과 다른 Google Play 구독은 retryable로 닫고 entitlement를 만들지 않는다", async () => {
  const db = createDb();
  await seedPurchaseOwner(db, RAW_TOKEN);
  const subscription = await playSubscription({
    lineItems: [{
      productId: "hyeni_premium",
      expiryTime: "2026-08-13T00:00:00.000Z",
      offerDetails: { basePlanId: "monthly-2900" },
      autoRenewingPlan: {
        autoRenewEnabled: true,
        recurringPrice: { currencyCode: "KRW", units: "3900", nanos: 0 },
      },
      offerPhase: {},
    }],
  });
  const response = await request(
    routes(fetchMock(subscription).impl),
    env(db),
    subscriptionEnvelope("price-mismatch"),
  );
  assert.equal(response.status, 503);
  assert.equal(db.row("SELECT status FROM google_play_rtdn_events").status, "retryable");
  assert.equal(db.row("SELECT COUNT(*) AS count FROM family_subscription").count, 0);
});

test("실제 재선점 뒤 old delivery의 ack 실패는 새 claim을 덮지 않고 non2xx다", async () => {
  const db = createDb();
  await seedPurchaseOwner(db, RAW_TOKEN);
  const event = { messageId: "lease-lost", eventTimeMillis: String(NOW.getTime()), kind: "subscription", notificationType: 4 };
  let newerClaimToken = "";
  const google = fetchMock(await playSubscription({ acknowledgementState: "ACKNOWLEDGEMENT_STATE_PENDING" }), {
    ackStatus: 503,
    onSubscription: async () => {
      db.sqlite.prepare("UPDATE google_play_rtdn_events SET status='retryable', lease_until=NULL WHERE message_id=?").run(event.messageId);
      const newer = await rtdnStore.claimGooglePlayRtdnEvent(db, event, await googlePlay.sha256Hex(RAW_TOKEN), new Date(NOW.getTime() + 1000));
      assert.equal(newer.state, "claimed");
      newerClaimToken = newer.claimToken;
    },
  });
  const response = await request(routes(google.impl), env(db), subscriptionEnvelope(event.messageId));
  assert.equal(response.status, 503);
  assert.deepEqual({ ...db.row("SELECT status,claim_token,attempts FROM google_play_rtdn_events") }, {
    status: "processing", claim_token: newerClaimToken, attempts: 2,
  });
});

test("S1이 lease를 잃고 S2 processed 뒤 재개해도 S2 구독 transaction을 바꾸지 않는다", async () => {
  const db = createDb();
  await seedPurchaseOwner(db, RAW_TOKEN);
  let reachedResolve;
  let releaseResolve;
  const reached = new Promise((resolve) => { reachedResolve = resolve; });
  const release = new Promise((resolve) => { releaseResolve = resolve; });
  const oldGoogle = fetchMock(await playSubscription({ developerPayload: "old-active" }), {
    onSubscription: async () => { reachedResolve(); await release; },
  });
  const oldRequest = request(routes(oldGoogle.impl), env(db), subscriptionEnvelope("interleaving"));
  await reached;
  db.sqlite.prepare("UPDATE google_play_rtdn_events SET status='retryable', lease_until=NULL WHERE message_id='interleaving'").run();

  const newGoogle = fetchMock(await playSubscription({
    subscriptionState: "SUBSCRIPTION_STATE_CANCELED",
    developerPayload: "new-cancelled",
  }));
  const newer = await request(routes(newGoogle.impl), env(db), subscriptionEnvelope("interleaving"));
  assert.equal(newer.status, 204);
  const beforeOldResume = JSON.stringify({
    subscription: db.row("SELECT * FROM family_subscription"),
    purchase: db.row("SELECT * FROM google_play_purchase_events WHERE purchase_token_hash=?", await googlePlay.sha256Hex(RAW_TOKEN)),
    owner: db.row("SELECT * FROM google_play_billing_owners"),
  });
  releaseResolve();
  const old = await oldRequest;
  assert.equal(old.status, 503);
  assert.equal(JSON.stringify({
    subscription: db.row("SELECT * FROM family_subscription"),
    purchase: db.row("SELECT * FROM google_play_purchase_events WHERE purchase_token_hash=?", await googlePlay.sha256Hex(RAW_TOKEN)),
    owner: db.row("SELECT * FROM google_play_billing_owners"),
  }), beforeOldResume);
  assert.equal(db.row("SELECT status FROM family_subscription").status, "cancelled");
});

test("family 또는 purchase write 실패는 RTDN transaction 전체를 rollback한다", async () => {
  for (const failure of ["family_subscription", "google_play_purchase_events"]) {
    const db = createDb();
    await seedPurchaseOwner(db, RAW_TOKEN);
    const originalPrepare = db.prepare.bind(db);
    db.prepare = (sql) => {
      const prepared = originalPrepare(sql);
      if (!sql.startsWith("INSERT INTO") || !sql.includes(failure)) return prepared;
      return {
        bind(...bindings) {
          const bound = prepared.bind(...bindings);
          return { ...bound, run: async () => { throw new Error(`forced_${failure}_failure`); } };
        },
      };
    };
    const response = await request(routes(fetchMock(await playSubscription()).impl), env(db), subscriptionEnvelope(`rollback-${failure}`));
    assert.notEqual(response.status, 204);
    assert.equal(db.row("SELECT COUNT(*) AS count FROM family_subscription").count, 0);
    assert.equal(db.row("SELECT COUNT(*) AS count FROM google_play_billing_owners").count, 0);
    assert.equal(db.row("SELECT verification_result FROM google_play_purchase_events").verification_result, "{}");
  }
});

test("notify 실패는 retryable이고 다음 delivery가 transaction을 재적용해 processed된다", async () => {
  const db = createDb();
  await seedPurchaseOwner(db, RAW_TOKEN);
  const environment = env(db);
  let notifyCount = 0;
  environment.FAMILY_ROOM.get = () => ({
    fetch: async () => new Response(null, { status: ++notifyCount === 1 ? 500 : 204 }),
  });
  const app = routes(fetchMock(await playSubscription()).impl);
  assert.equal((await request(app, environment, subscriptionEnvelope("notify-retry"))).status, 502);
  assert.equal(db.row("SELECT status FROM google_play_rtdn_events").status, "retryable");
  assert.equal((await request(app, environment, subscriptionEnvelope("notify-retry"))).status, 204);
  assert.equal(db.row("SELECT status FROM google_play_rtdn_events").status, "processed");
  assert.equal(notifyCount, 2);
});

test("AI 크레딧 consume 성공 뒤 최종 D1 실패는 consumptionState=1 재검증으로 중복 없이 복구한다", async () => {
  const db = createDb();
  db.exec(`
    ALTER TABLE families ADD COLUMN user_tier TEXT;
    ALTER TABLE families ADD COLUMN subscription_tier TEXT;
    ALTER TABLE family_subscription ADD COLUMN remote_listen_enabled INTEGER DEFAULT 1;
    CREATE TABLE subscriptions(
      id TEXT PRIMARY KEY, family_id TEXT NOT NULL, status TEXT, expires_at TEXT
    );
    CREATE TABLE family_review_rewards(
      family_id TEXT PRIMARY KEY, granted_at TEXT
    );
    CREATE TABLE ai_credit_balances(
      id TEXT PRIMARY KEY, family_id TEXT NOT NULL, child_user_id TEXT NOT NULL,
      parent_id TEXT NOT NULL, is_premium INTEGER NOT NULL,
      daily_included_limit INTEGER NOT NULL, daily_included_used INTEGER NOT NULL,
      daily_reset_date TEXT NOT NULL, purchased_credits INTEGER NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(family_id, child_user_id)
    );
    CREATE TABLE ai_credit_ledger(
      id TEXT PRIMARY KEY, family_id TEXT NOT NULL, child_user_id TEXT NOT NULL,
      parent_id TEXT NOT NULL, delta INTEGER NOT NULL, reason TEXT NOT NULL,
      source TEXT NOT NULL, transaction_id TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL
    );
  `);
  seedOwnerAccount(db);
  db.sqlite.prepare(
    "INSERT INTO users(id) VALUES (?)",
  ).run("child-credit");
  db.sqlite.prepare(
    "INSERT INTO family_members(id,family_id,user_id,role,is_active) VALUES ('child-credit-member',?,?,'child',1)",
  ).run(FAMILY_ID, "child-credit");
  db.sqlite.prepare(
    `INSERT INTO ai_credit_balances
       (id,family_id,child_user_id,parent_id,is_premium,daily_included_limit,
        daily_included_used,daily_reset_date,purchased_credits,updated_at)
     VALUES ('credit-debt-balance',?,?,?,0,5,0,'2026-08-01',-25,'2026-08-01 00:00:00+00')`,
  ).run(FAMILY_ID, "child-credit", PARENT_ID);

  const { privateKey, publicKey } = await generateKeyPair("ES256", { extractable: true });
  const environment = {
    ...env(db),
    JWT_PRIVATE_KEY: JSON.stringify(await exportJWK(privateKey)),
    JWT_PUBLIC_KEY: JSON.stringify(await exportJWK(publicKey)),
  };
  const accessToken = await signAccessToken(environment, {
    sub: PARENT_ID,
    role: "parent",
    family_id: FAMILY_ID,
    is_anonymous: false,
  });
  const ids = await ownerIds();
  let consumptionState = 0;
  let consumeCalls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const value = String(url);
    if (value === "https://oauth2.googleapis.com/token") {
      return Response.json({ access_token: "access-token" });
    }
    if (value.endsWith(":consume")) {
      consumeCalls += 1;
      consumptionState = 1;
      return new Response(null, { status: 204 });
    }
    if (value.includes("/purchases/products/")) {
      return Response.json({
        purchaseState: 0,
        consumptionState,
        orderId: "credit-order-from-google",
        obfuscatedExternalAccountId: ids.accountId,
        obfuscatedExternalProfileId: ids.profileId,
      });
    }
    throw new Error(`unexpected fetch: ${value}`);
  };
  const body = JSON.stringify({
    familyId: FAMILY_ID,
    childUserId: "child-credit",
    packageName: PACKAGE_NAME,
    productType: "inapp",
    productId: "hyeni_ai_credits_30",
    purchaseToken: "credit-recovery-token",
  });
  db.beforeRun = async (sql) => {
    if (/UPDATE google_play_purchase_events SET status='granted'/.test(sql)) {
      db.beforeRun = null;
      throw new Error("injected finalization failure");
    }
  };

  try {
    const first = await googlePlayVerifyRoutes.request("http://local/google-play-verify", {
      method: "POST",
      headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
      body,
    }, environment);
    assert.equal(first.status, 500);
    const firstBody = await first.json();
    assert.deepEqual(firstBody, { ok: false, error: "google_play_processing_failed" });
    assert.equal(JSON.stringify(firstBody).includes("injected finalization failure"), false);
    assert.equal(db.row("SELECT status FROM google_play_purchase_events").status, "credit_granted_pending_consume");
    assert.equal(db.row("SELECT purchased_credits FROM ai_credit_balances").purchased_credits, 5);

    const retry = await googlePlayVerifyRoutes.request("http://local/google-play-verify", {
      method: "POST",
      headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
      body,
    }, environment);
    assert.equal(retry.status, 200);
    const retryBody = await retry.json();
    assert.equal(retryBody.debtApplied, 25);
    assert.equal(retryBody.availableCreditsAdded, 5);
    assert.equal(retryBody.creditStatus.purchasedCredits, 5);
    assert.equal(retryBody.creditStatus.purchasedCreditDebt, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(consumeCalls, 1);
  assert.equal(db.row("SELECT status FROM google_play_purchase_events").status, "granted");
  assert.equal(db.row("SELECT purchased_credits FROM ai_credit_balances").purchased_credits, 5);
  assert.equal(db.row("SELECT debt_applied FROM google_play_purchase_events").debt_applied, 25);
  assert.equal(db.row("SELECT COUNT(*) AS n FROM ai_credit_ledger").n, 1);
});

test("기존 google-play-verify는 악성 client purchase/order metadata를 D1에 전혀 저장하지 않는다", async () => {
  const db = createDb();
  db.exec(readFileSync(new URL("../db/premium-funnel.sql", import.meta.url), "utf8"));
  db.sqlite.prepare("INSERT INTO users(id) VALUES (?)").run(PARENT_ID);
  db.sqlite.prepare("INSERT INTO families VALUES (?,?,?)")
    .run(FAMILY_ID, PARENT_ID, NOW.toISOString());
  db.sqlite.prepare(
    "INSERT INTO family_members(id,family_id,user_id,role,is_active) VALUES ('parent-member',?,?,'parent',1)",
  ).run(FAMILY_ID, PARENT_ID);
  const { privateKey, publicKey } = await generateKeyPair("ES256", { extractable: true });
  const environment = {
    ...env(db),
    JWT_PRIVATE_KEY: JSON.stringify(await exportJWK(privateKey)),
    JWT_PUBLIC_KEY: JSON.stringify(await exportJWK(publicKey)),
    PREMIUM_FUNNEL_HASH_SECRET,
  };
  const accessToken = await signAccessToken(environment, {
    sub: PARENT_ID, role: "parent", family_id: FAMILY_ID, is_anonymous: false,
  });
  const google = fetchMock(await playSubscription());
  const originalFetch = globalThis.fetch;
  globalThis.fetch = google.impl;
  const maliciousBody = {
    familyId: FAMILY_ID,
    packageName: PACKAGE_NAME,
    productType: "subscription",
    productId: "hyeni_premium",
    basePlanId: "monthly-2900",
    offerId: "trial-7d",
    purchaseToken: RAW_TOKEN,
    orderId: RAW_TOKEN,
    purchase: {
      packageName: RAW_TOKEN,
      products: [RAW_TOKEN],
      purchaseState: RAW_TOKEN,
      originalJson: RAW_TOKEN,
      signature: RAW_TOKEN,
      purchaseToken: RAW_TOKEN,
      orderId: RAW_TOKEN,
    },
  };
  try {
    const response = await googlePlayVerifyRoutes.request("http://local/google-play-verify", {
      method: "POST",
      headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
      body: JSON.stringify(maliciousBody),
    }, environment);
    assert.equal(response.status, 200);
    const duplicate = await googlePlayVerifyRoutes.request("http://local/google-play-verify", {
      method: "POST",
      headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
      body: JSON.stringify(maliciousBody),
    }, environment);
    assert.equal(duplicate.status, 200);
    assert.equal(Object.hasOwn(await duplicate.json(), "verification"), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
  const persisted = JSON.stringify([
    ...db.rows("SELECT * FROM google_play_purchase_events"),
    ...db.rows("SELECT * FROM family_subscription"),
    ...db.rows("SELECT * FROM google_play_billing_owners"),
  ]);
  assert.equal(persisted.includes(RAW_TOKEN), false);
  assert.equal(db.row("SELECT order_id FROM google_play_purchase_events").order_id, "order-from-google");
  assert.deepEqual({ ...db.row(
    "SELECT event,provider,plan,app_version FROM premium_funnel_events",
  ) }, {
    event: "entitlement_activated",
    provider: "google_play",
    plan: "month",
    app_version: null,
  });
  const funnelPersisted = JSON.stringify(db.rows("SELECT * FROM premium_funnel_events"));
  assert.equal(funnelPersisted.includes(FAMILY_ID), false);
  assert.equal(funnelPersisted.includes(PARENT_ID), false);
  assert.equal(funnelPersisted.includes(RAW_TOKEN), false);
  assert.equal(funnelPersisted.includes("order-from-google"), false);
});
