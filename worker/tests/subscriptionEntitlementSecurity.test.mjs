import test, { after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { dirname, extname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath, pathToFileURL } from "node:url";

import { Hono } from "hono";

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

async function optionalImport(path) {
  try {
    return await import(path);
  } catch (error) {
    if (error?.code !== "ERR_MODULE_NOT_FOUND") throw error;
    return {};
  }
}

const entitlementPolicy = await optionalImport("../shared/subscriptionEntitlement.js");
const googlePlay = await optionalImport("../shared/googlePlaySubscription.js");
const qonversion = await optionalImport("../shared/qonversionWebhookAuth.js");
const qonversionWebhookRoutes = (
  await import(pathToFileURL(resolve(workerDir, "routes/qonversion-webhook.ts")).href)
).default;
const subscriptionReconcileRoutes = (
  await import(pathToFileURL(resolve(workerDir, "routes/subscription-reconcile.ts")).href)
).default;

const source = (relativePath) => readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");

async function hmacHex(body, secret) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signed = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  return Array.from(new Uint8Array(signed), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

class SubscriptionSqliteD1 {
  constructor(provider) {
    this.sqlite = new DatabaseSync(":memory:");
    this.beforeRun = null;
    this.sqlite.exec(`
      CREATE TABLE subscription_webhook_events(
        event_id TEXT PRIMARY KEY, family_id TEXT NOT NULL, event_type TEXT,
        status TEXT, payload TEXT NOT NULL, received_at TEXT NOT NULL
      );
      CREATE TABLE family_subscription(
        family_id TEXT PRIMARY KEY, status TEXT NOT NULL, product_id TEXT NOT NULL,
        qonversion_user_id TEXT NOT NULL, provider TEXT NOT NULL,
        trial_ends_at TEXT, current_period_end TEXT, cancelled_at TEXT,
        raw_event TEXT NOT NULL DEFAULT '{}', last_event_id TEXT, last_event_at TEXT,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
    `);
    this.sqlite.prepare(
      `INSERT INTO family_subscription
         (family_id,status,product_id,qonversion_user_id,provider,current_period_end,
          raw_event,created_at,updated_at)
       VALUES ('canonical-family','active','hyeni_premium','canonical-family',?,
               '2099-01-01T00:00:00.000Z','{}','2000-01-01T00:00:00.000Z',
               '2000-01-01T00:00:00.000Z')`,
    ).run(provider);
  }

  prepare(sql, bindings = []) {
    const database = this.sqlite;
    const owner = this;
    return {
      bind: (...nextBindings) => this.prepare(sql, nextBindings),
      async run() {
        if (typeof owner.beforeRun === "function") {
          await owner.beforeRun(sql, bindings);
        }
        const result = database.prepare(sql).run(...bindings);
        return { success: true, meta: { changes: Number(result.changes) } };
      },
      async first() {
        return database.prepare(sql).get(...bindings) ?? null;
      },
      async all() {
        return { success: true, results: database.prepare(sql).all(...bindings) };
      },
    };
  }

  row(sql, ...bindings) {
    return this.sqlite.prepare(sql).get(...bindings) ?? null;
  }

  close() {
    this.sqlite.close();
  }
}

test("trial은 종료일이 존재하고 현재보다 미래일 때만 프리미엄이다", () => {
  assert.equal(typeof entitlementPolicy.isPremiumSubscriptionState, "function");
  const now = new Date("2026-07-13T00:00:00.000Z");

  assert.equal(entitlementPolicy.isPremiumSubscriptionState("trial", "2026-07-20T00:00:00.000Z", null, now), true);
  assert.equal(entitlementPolicy.isPremiumSubscriptionState("trial", null, "2026-07-20T00:00:00.000Z", now), false);
  assert.equal(entitlementPolicy.isPremiumSubscriptionState("trial", "2026-07-12T23:59:59.000Z", null, now), false);
  assert.equal(entitlementPolicy.isPremiumSubscriptionState("active", null, "2026-07-20T00:00:00.000Z", now), true);
  assert.equal(entitlementPolicy.isPremiumSubscriptionState("active", null, null, now), false);
  assert.equal(entitlementPolicy.isPremiumSubscriptionState("grace", null, "2026-07-20T00:00:00.000Z", now), true);
  assert.equal(entitlementPolicy.isPremiumSubscriptionState("grace", null, "2026-07-12T23:59:59.000Z", now), false);
  assert.equal(entitlementPolicy.isPremiumSubscriptionState("cancelled", null, "2026-07-20T00:00:00.000Z", now), true);
  assert.equal(entitlementPolicy.isPremiumSubscriptionState("cancelled", null, "2026-07-12T23:59:59.000Z", now), false);
  assert.equal(entitlementPolicy.isPremiumSubscriptionState("expired", "2026-07-20T00:00:00.000Z", "2026-07-20T00:00:00.000Z", now), false);
});

test("Qonversion 웹훅은 secret 미설정 시 fail-closed하고 설정 시 유효 HMAC만 허용한다", async () => {
  assert.equal(typeof qonversion.authorizeQonversionWebhook, "function");
  const rawBody = JSON.stringify({ event: "trial_started" });
  const secret = "test-qonversion-secret";
  const validSignature = await hmacHex(rawBody, secret);

  assert.deepEqual(
    await qonversion.authorizeQonversionWebhook({ rawBody, signature: "", secret: "", allowUnsigned: false }),
    { ok: false, status: 503, error: "Webhook secret is not configured" },
  );
  assert.deepEqual(
    await qonversion.authorizeQonversionWebhook({ rawBody, signature: "", secret: "", allowUnsigned: true }),
    { ok: false, status: 503, error: "Webhook secret is not configured" },
  );
  assert.deepEqual(
    await qonversion.authorizeQonversionWebhook({ rawBody, signature: "attacker", secret: "", allowUnsigned: false }),
    { ok: false, status: 503, error: "Webhook secret is not configured" },
  );
  assert.deepEqual(
    await qonversion.authorizeQonversionWebhook({ rawBody, signature: "", secret, allowUnsigned: false }),
    { ok: false, status: 401, error: "Invalid webhook signature" },
  );
  assert.deepEqual(
    await qonversion.authorizeQonversionWebhook({ rawBody, signature: "bad", secret, allowUnsigned: false }),
    { ok: false, status: 401, error: "Invalid webhook signature" },
  );
  assert.deepEqual(
    await qonversion.authorizeQonversionWebhook({ rawBody, signature: validSignature, secret, allowUnsigned: false }),
    { ok: true, status: 200 },
  );
});

test("Qonversion 웹훅 health는 secret 미설정 상태를 수신 불가로 정직하게 반환한다", async () => {
  const app = new Hono();
  app.route("/api/billing", qonversionWebhookRoutes);

  const response = await app.request(
    "http://test.local/api/billing/qonversion-webhook",
    undefined,
    {},
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    ok: true,
    service: "qonversion-webhook",
    configured: false,
    accepting: false,
    primaryProvider: false,
  });
});

test("Qonversion 웹훅 health는 실제 secret이 있을 때만 수신 가능으로 반환한다", async () => {
  const app = new Hono();
  app.route("/api/billing", qonversionWebhookRoutes);

  const response = await app.request(
    "http://test.local/api/billing/qonversion-webhook",
    undefined,
    { QONVERSION_WEBHOOK_SECRET: "configured-secret" },
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    ok: true,
    service: "qonversion-webhook",
    configured: true,
    accepting: true,
    primaryProvider: false,
  });
});

test("Qonversion 웹훅 health는 signing secret alias만 있어도 수신 가능으로 반환한다", async () => {
  const app = new Hono();
  app.route("/api/billing", qonversionWebhookRoutes);

  const response = await app.request(
    "http://test.local/api/billing/qonversion-webhook",
    undefined,
    { QONVERSION_WEBHOOK_SIGNING_SECRET: "configured-signing-secret" },
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    ok: true,
    service: "qonversion-webhook",
    configured: true,
    accepting: true,
    primaryProvider: false,
  });
});

test("Qonversion 웹훅 POST는 secret 미설정 시 503으로 fail-closed한다", async () => {
  const app = new Hono();
  app.route("/api/billing", qonversionWebhookRoutes);

  const response = await app.request(
    "http://test.local/api/billing/qonversion-webhook",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ event: "trial_started" }),
    },
    {},
  );

  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: "qonversion_webhook_not_configured" });
});

test("Qonversion 웹훅 POST는 secret이 있어도 잘못된 서명을 401로 거부한다", async () => {
  const app = new Hono();
  app.route("/api/billing", qonversionWebhookRoutes);

  const response = await app.request(
    "http://test.local/api/billing/qonversion-webhook",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-qonversion-signature": "0".repeat(64),
      },
      body: JSON.stringify({ event: "trial_started" }),
    },
    { QONVERSION_WEBHOOK_SIGNING_SECRET: "configured-signing-secret" },
  );

  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: "qonversion_webhook_signature_invalid" });
});

test("Qonversion INSERT는 provider=qonversion을 명시하고 결제 정본 provider를 보존한다", () => {
  const webhookSource = source("routes/qonversion-webhook.ts");
  const reconcileSource = source("routes/subscription-reconcile.ts");
  const googleVerifySource = source("routes/google-play-verify.ts");
  assert.match(webhookSource, /patch\.set\("provider",\s*"qonversion"\)/);
  assert.match(webhookSource, /new Set\(\["google_play", "toss_web"\]\)/);
  assert.match(reconcileSource, /new Set\(\["google_play", "toss_web"\]\)/);
  assert.doesNotMatch(webhookSource, /getDefaultTrialEndsAt/, "webhook must not invent a trial expiry");
  for (const routeSource of [webhookSource, reconcileSource, googleVerifySource]) {
    assert.doesNotMatch(routeSource, /\bdetails\s*:/, "결제 route가 예외 상세를 응답하면 안 됩니다");
  }
});

test("Qonversion 웹훅 DB 실패는 예외 원문 없이 고정 코드만 반환한다", async () => {
  const secret = "qonversion-redaction-secret";
  const sentinel = "PRIVATE_D1_SCHEMA_AND_BINDING_SENTINEL";
  for (const scenario of [
    {
      provider: "qonversion",
      shouldFail: (sql) => /^INSERT INTO subscription_webhook_events/.test(sql.trim()),
      expectedError: "qonversion_event_persist_failed",
    },
    {
      provider: "qonversion",
      shouldFail: (sql) => /^UPDATE family_subscription SET/.test(sql.trim()),
      expectedError: "qonversion_subscription_update_failed",
    },
  ]) {
    const db = new SubscriptionSqliteD1(scenario.provider);
    try {
      db.beforeRun = async (sql) => {
        if (scenario.shouldFail(sql)) throw new Error(sentinel);
      };
      const app = new Hono();
      app.route("/api/billing", qonversionWebhookRoutes);
      const rawBody = JSON.stringify({
        event_id: `redaction-${scenario.expectedError}`,
        family_id: "canonical-family",
        event_type: "subscription_expired",
      });
      const response = await app.request(
        "http://test.local/api/billing/qonversion-webhook",
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-qonversion-signature": await hmacHex(rawBody, secret),
          },
          body: rawBody,
        },
        { DB: db, QONVERSION_WEBHOOK_SECRET: secret },
      );
      assert.equal(response.status, 500);
      const body = await response.json();
      assert.deepEqual(body, { error: scenario.expectedError });
      assert.equal(JSON.stringify(body).includes(sentinel), false);
      assert.equal(Object.hasOwn(body, "details"), false);
    } finally {
      db.close();
    }
  }
});

test("Qonversion reconcile은 DB·provider 예외 원문을 고정 코드로 축약한다", async () => {
  const sentinel = "PRIVATE_QONVERSION_PROVIDER_RESPONSE_SENTINEL";
  const loadFailureApp = new Hono();
  loadFailureApp.route("/api/subscription", subscriptionReconcileRoutes);
  const loadFailure = await loadFailureApp.request(
    "http://test.local/api/subscription/reconcile",
    { method: "POST", headers: { "x-internal-secret": "reconcile-secret" } },
    {
      DB: {
        prepare() {
          return {
            bind() {
              return { async all() { throw new Error(sentinel); } };
            },
          };
        },
      },
      PUSH_INTERNAL_SECRET: "reconcile-secret",
      QONVERSION_API_KEY: "qonversion-api-key",
    },
  );
  assert.equal(loadFailure.status, 500);
  assert.deepEqual(await loadFailure.json(), { error: "subscription_reconcile_load_failed" });

  const originalFetch = globalThis.fetch;
  try {
    const providerDb = new SubscriptionSqliteD1("qonversion");
    try {
      globalThis.fetch = async () => new Response(sentinel, { status: 502 });
      const app = new Hono();
      app.route("/api/subscription", subscriptionReconcileRoutes);
      const response = await app.request(
        "http://test.local/api/subscription/reconcile",
        { method: "POST", headers: { "x-internal-secret": "reconcile-secret" } },
        {
          DB: providerDb,
          PUSH_INTERNAL_SECRET: "reconcile-secret",
          QONVERSION_API_KEY: "qonversion-api-key",
        },
      );
      const body = await response.json();
      assert.deepEqual(body.results, [{
        familyId: "canonical-family",
        error: "subscription_reconcile_provider_failed",
      }]);
      assert.equal(JSON.stringify(body).includes(sentinel), false);
    } finally {
      providerDb.close();
    }

    const updateDb = new SubscriptionSqliteD1("qonversion");
    try {
      updateDb.beforeRun = async (sql) => {
        if (/^UPDATE family_subscription SET/.test(sql.trim())) throw new Error(sentinel);
      };
      globalThis.fetch = async () => Response.json({
        data: { status: "subscription_expired", product_id: "premium_yearly" },
      });
      const app = new Hono();
      app.route("/api/subscription", subscriptionReconcileRoutes);
      const response = await app.request(
        "http://test.local/api/subscription/reconcile",
        { method: "POST", headers: { "x-internal-secret": "reconcile-secret" } },
        {
          DB: updateDb,
          PUSH_INTERNAL_SECRET: "reconcile-secret",
          QONVERSION_API_KEY: "qonversion-api-key",
        },
      );
      const body = await response.json();
      assert.deepEqual(body.results, [{
        familyId: "canonical-family",
        error: "subscription_reconcile_update_failed",
      }]);
      assert.equal(JSON.stringify(body).includes(sentinel), false);
    } finally {
      updateDb.close();
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Qonversion 웹훅은 Google Play와 Toss Web 정본 구독을 모두 변경하지 않는다", async () => {
  for (const provider of ["google_play", "toss_web"]) {
    const db = new SubscriptionSqliteD1(provider);
    try {
      const app = new Hono();
      app.route("/api/billing", qonversionWebhookRoutes);
      const secret = "canonical-provider-webhook-secret";
      const rawBody = JSON.stringify({
        event_id: `event-${provider}`,
        family_id: "canonical-family",
        event_type: "subscription_expired",
        product_id: "premium_yearly",
      });
      const response = await app.request(
        "http://test.local/api/billing/qonversion-webhook",
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-qonversion-signature": await hmacHex(rawBody, secret),
          },
          body: rawBody,
        },
        { DB: db, QONVERSION_WEBHOOK_SECRET: secret },
      );

      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), {
        ok: true,
        eventId: `event-${provider}`,
        ignored: true,
        reason: `${provider}_owned`,
      });
      assert.deepEqual({ ...db.row(
        `SELECT provider,status,product_id,current_period_end
           FROM family_subscription WHERE family_id='canonical-family'`,
      ) }, {
        provider,
        status: "active",
        product_id: "hyeni_premium",
        current_period_end: "2099-01-01T00:00:00.000Z",
      });
    } finally {
      db.close();
    }
  }
});

test("Qonversion reconcile은 Google Play와 Toss Web 정본 구독을 외부 조회 없이 건너뛴다", async () => {
  const originalFetch = globalThis.fetch;
  let externalCalls = 0;
  globalThis.fetch = async () => {
    externalCalls += 1;
    throw new Error("canonical_provider_must_not_be_reconciled");
  };
  try {
    for (const provider of ["google_play", "toss_web"]) {
      const db = new SubscriptionSqliteD1(provider);
      try {
        const app = new Hono();
        app.route("/api/subscription", subscriptionReconcileRoutes);
        const response = await app.request(
          "http://test.local/api/subscription/reconcile",
          {
            method: "POST",
            headers: { "x-internal-secret": "reconcile-secret" },
          },
          {
            DB: db,
            PUSH_INTERNAL_SECRET: "reconcile-secret",
            QONVERSION_API_KEY: "qonversion-api-key",
          },
        );
        assert.equal(response.status, 200);
        const body = await response.json();
        assert.equal(body.checked, 0);
        assert.equal(body.reconciled, 0);
        assert.deepEqual(body.results, [{
          familyId: "canonical-family",
          skipped: `${provider}_provider`,
        }]);
        assert.equal(db.row(
          "SELECT provider FROM family_subscription WHERE family_id='canonical-family'",
        ).provider, provider);
      } finally {
        db.close();
      }
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(externalCalls, 0);
});

test("Qonversion 쓰기 직전 정본 provider가 활성화돼도 웹훅과 reconcile은 원자 가드로 보존한다", async () => {
  const secret = "provider-race-webhook-secret";
  const webhookDb = new SubscriptionSqliteD1("qonversion");
  try {
    webhookDb.beforeRun = async (sql) => {
      if (!/^UPDATE family_subscription SET/.test(sql.trim())) return;
      webhookDb.beforeRun = null;
      webhookDb.sqlite.prepare(
        "UPDATE family_subscription SET provider='toss_web' WHERE family_id='canonical-family'",
      ).run();
    };
    const app = new Hono();
    app.route("/api/billing", qonversionWebhookRoutes);
    const rawBody = JSON.stringify({
      event_id: "provider-race-webhook",
      family_id: "canonical-family",
      event_type: "subscription_expired",
    });
    const response = await app.request(
      "http://test.local/api/billing/qonversion-webhook",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-qonversion-signature": await hmacHex(rawBody, secret),
        },
        body: rawBody,
      },
      { DB: webhookDb, QONVERSION_WEBHOOK_SECRET: secret },
    );
    assert.equal(response.status, 200);
    assert.equal((await response.json()).reason, "toss_web_owned");
    assert.deepEqual({ ...webhookDb.row(
      "SELECT provider,status FROM family_subscription WHERE family_id='canonical-family'",
    ) }, { provider: "toss_web", status: "active" });
  } finally {
    webhookDb.close();
  }

  const reconcileDb = new SubscriptionSqliteD1("qonversion");
  const originalFetch = globalThis.fetch;
  try {
    reconcileDb.beforeRun = async (sql) => {
      if (!/^UPDATE family_subscription SET/.test(sql.trim())) return;
      reconcileDb.beforeRun = null;
      reconcileDb.sqlite.prepare(
        "UPDATE family_subscription SET provider='google_play' WHERE family_id='canonical-family'",
      ).run();
    };
    globalThis.fetch = async () => Response.json({
      data: {
        status: "subscription_expired",
        product_id: "premium_yearly",
      },
    });
    const app = new Hono();
    app.route("/api/subscription", subscriptionReconcileRoutes);
    const response = await app.request(
      "http://test.local/api/subscription/reconcile",
      { method: "POST", headers: { "x-internal-secret": "reconcile-secret" } },
      {
        DB: reconcileDb,
        PUSH_INTERNAL_SECRET: "reconcile-secret",
        QONVERSION_API_KEY: "qonversion-api-key",
      },
    );
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.checked, 1);
    assert.equal(body.reconciled, 0);
    assert.deepEqual(body.results, [{
      familyId: "canonical-family",
      skipped: "google_play_provider",
    }]);
    assert.deepEqual({ ...reconcileDb.row(
      "SELECT provider,status FROM family_subscription WHERE family_id='canonical-family'",
    ) }, { provider: "google_play", status: "active" });
  } finally {
    globalThis.fetch = originalFetch;
    reconcileDb.close();
  }
});

test("Google Play 무료체험 offer는 trial과 종료일로 매핑되고 base plan을 엄격 검증한다", () => {
  assert.equal(typeof googlePlay.mapGoogleSubscriptionEntitlement, "function");
  const expiryTime = "2026-07-20T00:00:00.000Z";
  const subscription = {
    startTime: "2026-07-13T00:00:00.000Z",
    subscriptionState: "SUBSCRIPTION_STATE_ACTIVE",
    externalAccountIdentifiers: {
      obfuscatedExternalAccountId: "family-hash",
      obfuscatedExternalProfileId: "parent-hash",
    },
    lineItems: [{
      productId: "hyeni_premium",
      expiryTime,
      offerDetails: { basePlanId: "monthly-2900", offerId: "trial-7d" },
      autoRenewingPlan: {
        autoRenewEnabled: true,
        recurringPrice: { currencyCode: "KRW", units: "4900", nanos: 0 },
      },
      offerPhase: { freeTrial: {} },
    }],
  };

  assert.deepEqual(
    googlePlay.mapGoogleSubscriptionEntitlement(
      subscription,
      "hyeni_premium",
      "monthly-2900",
      "trial-7d",
      new Date("2026-07-13T00:00:01.000Z"),
      "family-hash",
      "parent-hash",
    ),
    {
      status: "trial",
      currentPeriodEnd: expiryTime,
      trialEndsAt: expiryTime,
      basePlanId: "monthly-2900",
      orderId: "",
      acknowledgementState: "",
    },
  );
  assert.throws(
    () => googlePlay.mapGoogleSubscriptionEntitlement({
      ...subscription,
      lineItems: [{ ...subscription.lineItems[0], expiryTime: "2026-07-27T00:00:00.000Z" }],
    }, "hyeni_premium", "monthly-2900", "trial-7d"),
    /trial_period_mismatch/,
  );
  assert.throws(
    () => googlePlay.mapGoogleSubscriptionEntitlement(subscription, "hyeni_premium", "monthly-2900", "trial-7d", new Date(), "other-family", "parent-hash"),
    /purchase_owner_mismatch/,
  );
  assert.throws(
    () => googlePlay.mapGoogleSubscriptionEntitlement({ ...subscription, externalAccountIdentifiers: {} }, "hyeni_premium", "monthly-2900", "trial-7d", new Date(), "family-hash", "parent-hash"),
    /purchase_owner_mismatch/,
  );
  assert.throws(
    () => googlePlay.mapGoogleSubscriptionEntitlement(subscription, "hyeni_premium", "annual-27840", "trial-7d"),
    /base_plan_mismatch/,
  );
  assert.throws(
    () => googlePlay.mapGoogleSubscriptionEntitlement({ ...subscription, lineItems: [{ ...subscription.lineItems[0], offerDetails: {} }] }, "hyeni_premium", "monthly-2900", "trial-7d"),
    /base_plan_mismatch/,
  );
  assert.throws(
    () => googlePlay.mapGoogleSubscriptionEntitlement(subscription, "hyeni_premium", "monthly-2900", "different-offer"),
    /offer_id_mismatch/,
  );
  assert.throws(
    () => googlePlay.mapGoogleSubscriptionEntitlement({
      ...subscription,
      lineItems: [{ ...subscription.lineItems[0], autoRenewingPlan: undefined }],
    }, "hyeni_premium", "monthly-2900", "trial-7d"),
    /recurring_price_mismatch/,
  );
  assert.throws(
    () => googlePlay.mapGoogleSubscriptionEntitlement({
      ...subscription,
      lineItems: [{
        ...subscription.lineItems[0],
        autoRenewingPlan: {
          autoRenewEnabled: true,
          recurringPrice: { currencyCode: "KRW", units: "3900", nanos: 0 },
        },
      }],
    }, "hyeni_premium", "monthly-2900", "trial-7d"),
    /recurring_price_mismatch/,
  );
  assert.throws(
    () => googlePlay.mapGoogleSubscriptionEntitlement({
      ...subscription,
      lineItems: [{
        ...subscription.lineItems[0],
        autoRenewingPlan: {
          autoRenewEnabled: true,
          recurringPrice: { currencyCode: "USD", units: "4900", nanos: 0 },
        },
      }],
    }, "hyeni_premium", "monthly-2900", "trial-7d"),
    /recurring_price_mismatch/,
  );
  assert.doesNotThrow(() => googlePlay.mapGoogleSubscriptionEntitlement({
    ...subscription,
    lineItems: [{
      ...subscription.lineItems[0],
      offerDetails: { basePlanId: "annual-27840" },
      autoRenewingPlan: {
        autoRenewEnabled: true,
        recurringPrice: { currencyCode: "KRW", units: "39000", nanos: 0 },
      },
      offerPhase: {},
    }],
  }, "hyeni_premium", "annual-27840", ""));
  assert.doesNotThrow(() => googlePlay.mapGoogleSubscriptionEntitlement({
    ...subscription,
    lineItems: [{
      ...subscription.lineItems[0],
      offerDetails: { basePlanId: "monthly-2900" },
      offerPhase: {},
    }],
  }, "hyeni_premium", "monthly-2900", ""));
  assert.doesNotThrow(() => googlePlay.mapGoogleSubscriptionEntitlement(
    subscription,
    "hyeni_premium",
    "",
    "",
    new Date("2026-07-13T00:00:01.000Z"),
    "family-hash",
    "parent-hash",
    true,
  ));
  const legacyMonthlySubscription = {
    ...subscription,
    startTime: "2026-07-31T14:59:59.999Z",
    lineItems: [{
      ...subscription.lineItems[0],
      expiryTime: "2026-08-31T00:00:00.000Z",
      offerDetails: { basePlanId: "monthly-2900" },
      autoRenewingPlan: {
        autoRenewEnabled: true,
        recurringPrice: { currencyCode: "KRW", units: "2900", nanos: 0 },
      },
      offerPhase: {},
    }],
  };
  assert.throws(
    () => googlePlay.mapGoogleSubscriptionEntitlement(
      legacyMonthlySubscription,
      "hyeni_premium",
      "monthly-2900",
      "",
      new Date("2026-08-01T00:00:00.000Z"),
      "family-hash",
      "parent-hash",
      false,
    ),
    /recurring_price_mismatch/,
    "신규 결제 검증은 과거 월 가격을 허용하면 안 됩니다",
  );
  assert.doesNotThrow(() => googlePlay.mapGoogleSubscriptionEntitlement(
    legacyMonthlySubscription,
    "hyeni_premium",
    "",
    "",
    new Date("2026-08-01T00:00:00.000Z"),
    "family-hash",
    "parent-hash",
    true,
  ), "전환 기준일 이전 기존 월 구독은 복원할 수 있어야 합니다");
  assert.throws(
    () => googlePlay.mapGoogleSubscriptionEntitlement({
      ...legacyMonthlySubscription,
      startTime: "2026-07-31T15:00:00.000Z",
    }, "hyeni_premium", "", "", new Date("2026-08-01T00:00:00.000Z"), "family-hash", "parent-hash", true),
    /recurring_price_mismatch/,
    "전환 기준시각 이후 시작된 과거 가격 구독은 복원으로 우회하면 안 됩니다",
  );
  assert.doesNotThrow(() => googlePlay.mapGoogleSubscriptionEntitlement({
    ...legacyMonthlySubscription,
    lineItems: [{
      ...legacyMonthlySubscription.lineItems[0],
      offerDetails: { basePlanId: "annual-27840" },
      autoRenewingPlan: {
        autoRenewEnabled: true,
        recurringPrice: { currencyCode: "KRW", units: "27840", nanos: 0 },
      },
    }],
  }, "hyeni_premium", "", "", new Date("2026-08-01T00:00:00.000Z"), "family-hash", "parent-hash", true),
  "전환 기준일 이전 기존 연 구독도 복원할 수 있어야 합니다");
  assert.throws(
    () => googlePlay.mapGoogleSubscriptionEntitlement({
      ...legacyMonthlySubscription,
      lineItems: [{
        ...legacyMonthlySubscription.lineItems[0],
        autoRenewingPlan: {
          autoRenewEnabled: true,
          recurringPrice: { currencyCode: "KRW", units: "3900", nanos: 0 },
        },
      }],
    }, "hyeni_premium", "", "", new Date("2026-08-01T00:00:00.000Z"), "family-hash", "parent-hash", true),
    /recurring_price_mismatch/,
    "복원도 승인된 기존 가격 외 임의 금액은 거부해야 합니다",
  );
  assert.equal(googlePlay.mapGoogleSubscriptionEntitlement({
    ...subscription,
    subscriptionState: "SUBSCRIPTION_STATE_PENDING",
    lineItems: [{
      ...subscription.lineItems[0],
      offerDetails: { basePlanId: "monthly-2900" },
      offerPhase: {},
    }],
  }, "hyeni_premium", "monthly-2900", "").status, "expired");
  assert.equal(googlePlay.mapGoogleSubscriptionEntitlement({
    ...subscription,
    subscriptionState: "SUBSCRIPTION_STATE_PENDING",
  }, "hyeni_premium", "monthly-2900", "trial-7d").status, "expired");
  assert.equal(googlePlay.mapGoogleSubscriptionEntitlement({
    ...subscription,
    subscriptionState: "SUBSCRIPTION_STATE_ON_HOLD",
    lineItems: [{
      ...subscription.lineItems[0],
      offerDetails: { basePlanId: "monthly-2900" },
      offerPhase: {},
    }],
  }, "hyeni_premium", "monthly-2900", "").status, "expired");
  // 해지(CANCELED)는 "결제 종료일까지 프리미엄 유지" 계약이라 종료일 이전 시각을 명시해 고정한다.
  // now 를 넘기지 않으면 실행 시각(현재)이 종료일을 지나 expired 로 바뀌는 시한폭탄 테스트가 된다.
  assert.equal(googlePlay.mapGoogleSubscriptionEntitlement({
    ...subscription,
    subscriptionState: "SUBSCRIPTION_STATE_CANCELED",
    lineItems: [{
      ...subscription.lineItems[0],
      offerDetails: { basePlanId: "monthly-2900" },
      offerPhase: {},
    }],
  }, "hyeni_premium", "monthly-2900", "", new Date("2026-07-13T00:00:01.000Z")).status, "cancelled");
  assert.equal(googlePlay.mapGoogleSubscriptionEntitlement({
    ...subscription,
    lineItems: [{
      ...subscription.lineItems[0],
      expiryTime: "2026-07-12T23:59:59.000Z",
      offerDetails: { basePlanId: "monthly-2900" },
      offerPhase: {},
    }],
  }, "hyeni_premium", "monthly-2900", "", new Date("2026-07-13T00:00:00.000Z")).status, "expired");

  const verifierSource = source("routes/google-play-verify.ts");
  assert.match(verifierSource, /const offerTokenProvided = Object\.prototype\.hasOwnProperty\.call\(body, "offerToken"\)/);
  assert.match(verifierSource, /const offerToken = asString\(body\.offerToken\)/);
  assert.match(verifierSource, /!restore && offerTokenProvided && !offerToken/);
  assert.match(verifierSource, /const offerId = asString\(body\.offerId\)/);
  assert.match(verifierSource, /verifySubscriptionPurchase\(\{[^}]*offerId/s);
  assert.match(verifierSource, /hyeni-family:/);
  assert.match(verifierSource, /hyeni-user:/);
  assert.match(verifierSource, /purchase_token_claimed_by_other_family/);
  assert.match(verifierSource, /const restore = body\.restore === true/);
  assert.match(verifierSource, /restoreGooglePlay|restore/);
});

test("Google Play verifier는 서비스 계정 secret 누락을 release blocker로 판정한다", () => {
  assert.equal(typeof googlePlay.isGooglePlayVerifierConfigured, "function");
  assert.equal(googlePlay.isGooglePlayVerifierConfigured({}), false);
  assert.equal(googlePlay.isGooglePlayVerifierConfigured({ GOOGLE_PLAY_SERVICE_ACCOUNT_JSON: "{}" }), true);
});

test("리뷰 스토어 신규 지급은 종료되고 기존 상태 조회만 유지한다", () => {
  const reviewSource = source("routes/review-rewards.ts");
  const getBlock = reviewSource.slice(
    reviewSource.indexOf("reviewRewards.get"),
    reviewSource.indexOf("reviewRewards.post"),
  );
  const postBlock = reviewSource.slice(reviewSource.indexOf("reviewRewards.post"));
  assert.match(getBlock, /requireAuth/);
  assert.match(getBlock, /assertParentOfFamily/);
  assert.match(getBlock, /SELECT family_id, granted_at FROM family_review_rewards/);
  assert.match(postBlock, /requireAuth/);
  assert.match(postBlock, /assertParentOfFamily/);
  assert.match(postBlock, /review_reward_program_ended/);
  assert.match(postBlock, /410/);
  assert.doesNotMatch(postBlock, /INSERT INTO family_review_rewards|UPDATE family_review_rewards|DELETE FROM family_review_rewards/);
});

test("제품 코드에는 종료일 검증 없는 raw trial 프리미엄 sink가 남지 않는다", () => {
  const files = [
    "db/authz.ts",
    "routes/ai-chat-data.ts",
    "routes/ai.ts",
    "routes/ai-proactive.ts",
    "routes/ai-child-chat.ts",
    "routes/google-play-verify.ts",
    "routes/push-notify.ts",
    "cron/location-staleness-check.ts",
    "cron/unregistered-stay-check.ts",
    "cron/_geo.ts",
    "shared/aiCredits.js",
  ];
  const rawTrialPatterns = [
    /status\s+IN\s*\(\s*['"]trial['"]\s*,\s*['"]active['"]\s*,\s*['"]grace['"]\s*\)/i,
    /new Set\(\[\s*["']trial["']\s*,\s*["']active["']\s*,\s*["']grace["']\s*\]\)/,
  ];

  for (const file of files) {
    const contents = source(file);
    for (const pattern of rawTrialPatterns) {
      assert.doesNotMatch(contents, pattern, `${file} must validate trial_ends_at`);
    }
  }

  const authzSource = source("db/authz.ts");
  assert.doesNotMatch(authzSource, /LEGACY_PREMIUM_TIERS[^;]+trial/s, "legacy trial has no trusted expiry evidence");
  const entitlementSource = source("shared/subscriptionEntitlement.js");
  assert.match(entitlementSource, /childSubscriptions\.some[\s\S]+isPremiumChildSubscriptionState/);
  assert.match(entitlementSource, /expires_at IS NOT NULL/);
  assert.match(entitlementSource, /datetime\(substr\(\$\{prefix\}expires_at/);

  for (const file of [
    "routes/ai-chat-data.ts",
    "routes/ai.ts",
    "routes/ai-proactive.ts",
    "routes/ai-child-chat.ts",
    "routes/google-play-verify.ts",
  ]) {
    assert.match(source(file), /resolveFamilyEntitlement/, `${file} must use the common expiry resolver`);
  }
});

test("클라이언트 JWT만으로 AI 크레딧을 부여하는 QA 엔드포인트는 비활성이다", () => {
  const sourceText = source("routes/ai-chat-data.ts");
  const start = sourceText.indexOf('aiData.post("/credits/purchase"');
  const end = sourceText.indexOf("// ── 메모리", start);
  const postBlock = sourceText.slice(start, end);
  assert.match(postBlock, /ai_credit_purchase_write_disabled/);
  assert.doesNotMatch(postBlock, /INSERT INTO ai_credit_ledger|UPDATE ai_credit_balances/);
});

test("검증된 AI 크레딧은 purchase event claim과 잔액·원장을 한 D1 batch로 확정한다", () => {
  const sourceText = source("routes/google-play-verify.ts");
  assert.match(sourceText, /credit_granted_pending_consume/);
  assert.match(sourceText, /db\.batch\(/);
  assert.match(sourceText, /status='received'/);
  assert.match(sourceText, /google-play-credit:/);
  assert.doesNotMatch(sourceText, /credit ledger insert failed/);
});

test("Qonversion reconcile의 cancelled도 결제 종료일을 저장한다", () => {
  const sourceText = source("routes/subscription-reconcile.ts");
  const cancelledBranch = sourceText.slice(
    sourceText.indexOf('nextStatus === "cancelled"'),
    sourceText.indexOf("binds.push(row.family_id)"),
  );
  assert.match(cancelledBranch, /current_period_end = \?/);
  assert.match(cancelledBranch, /remote\.currentPeriodEnd/);
});
