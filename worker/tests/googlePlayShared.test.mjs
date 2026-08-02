import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

async function optionalImport(path) {
  try {
    return await import(path);
  } catch (error) {
    if (error?.code !== "ERR_MODULE_NOT_FOUND") throw error;
    return {};
  }
}

const googlePlay = await optionalImport("../lib/googlePlay.ts");
const subscriptionPolicy = await optionalImport("../shared/googlePlaySubscription.js");
const routeSource = readFileSync(new URL("../routes/google-play-verify.ts", import.meta.url), "utf8");

function base64UrlDecode(value) {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
}

function arrayBufferToPem(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  const body = btoa(binary).match(/.{1,64}/g)?.join("\n") ?? "";
  return `-----BEGIN PRIVATE KEY-----\n${body}\n-----END PRIVATE KEY-----`;
}

function createDb(existing = false) {
  const writes = [];
  const db = {
    writes,
    prepare(sql) {
      return {
        bind(...bindings) {
          return {
            first: async () => existing && sql.startsWith("SELECT family_id") ? { family_id: "family-1" } : null,
            run: async () => {
              writes.push({ sql, bindings });
              return { success: true, meta: { changes: 1 } };
            },
          };
        },
      };
    },
    async batch(statements) {
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      return results;
    },
  };
  return db;
}

const activeSubscription = {
  subscriptionState: "SUBSCRIPTION_STATE_ACTIVE",
  acknowledgementState: "ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED",
  latestOrderId: "order-1",
  linkedPurchaseToken: "previous-token",
  externalAccountIdentifiers: {
    obfuscatedExternalAccountId: "account-hash",
    obfuscatedExternalProfileId: "profile-hash",
  },
  lineItems: [{
    productId: "hyeni_premium",
    expiryTime: "2026-08-13T00:00:00.000Z",
    offerDetails: { basePlanId: "monthly-2900", offerId: "trial-7d" },
    autoRenewingPlan: {
      autoRenewEnabled: true,
      recurringPrice: { currencyCode: "KRW", units: "4900", nanos: 0 },
    },
    offerPhase: {},
  }],
};

test("sha256Hex는 기존 구매 토큰 해시를 64자리 소문자 hex로 만든다", async () => {
  assert.equal(typeof googlePlay.sha256Hex, "function");
  assert.equal(
    await googlePlay.sha256Hex("purchase-token"),
    "3f955299b922937e8acf830313756fd3752c199963113835d81480dbf5aa2f27",
  );
});

test("서비스 계정 OAuth는 RS256 androidpublisher assertion으로 access token을 받는다", async () => {
  assert.equal(typeof googlePlay.getGoogleAccessToken, "function");
  const keyPair = await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  );
  const privateKey = await crypto.subtle.exportKey("pkcs8", keyPair.privateKey);
  const requests = [];
  const fetchImpl = async (url, init) => {
    requests.push({ url: String(url), init });
    return Response.json({ access_token: "google-access-token" });
  };

  const accessToken = await googlePlay.getGoogleAccessToken(JSON.stringify({
    client_email: "billing@example.iam.gserviceaccount.com",
    private_key: arrayBufferToPem(privateKey),
  }), fetchImpl);

  assert.equal(accessToken, "google-access-token");
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, "https://oauth2.googleapis.com/token");
  assert.equal(requests[0].init.method, "POST");
  const form = new URLSearchParams(String(requests[0].init.body));
  assert.equal(form.get("grant_type"), "urn:ietf:params:oauth:grant-type:jwt-bearer");
  const assertion = form.get("assertion");
  assert.ok(assertion);
  const [encodedHeader, encodedClaim, encodedSignature] = assertion.split(".");
  assert.deepEqual(JSON.parse(new TextDecoder().decode(base64UrlDecode(encodedHeader))), { alg: "RS256", typ: "JWT" });
  const claim = JSON.parse(new TextDecoder().decode(base64UrlDecode(encodedClaim)));
  assert.equal(claim.iss, "billing@example.iam.gserviceaccount.com");
  assert.equal(claim.scope, "https://www.googleapis.com/auth/androidpublisher");
  assert.equal(claim.aud, "https://oauth2.googleapis.com/token");
  assert.equal(claim.exp - claim.iat, 3600);
  assert.equal(await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    keyPair.publicKey,
    base64UrlDecode(encodedSignature),
    new TextEncoder().encode(`${encodedHeader}.${encodedClaim}`),
  ), true);
});

test("googleJson은 Bearer 인증을 유지하고 실패 응답을 google_api_failed로 전달한다", async () => {
  assert.equal(typeof googlePlay.googleJson, "function");
  const requests = [];
  const fetchImpl = async (url, init) => {
    requests.push({ url: String(url), init });
    return Response.json({ error: { code: 503, message: "upstream unavailable" } }, { status: 503 });
  };

  await assert.rejects(
    googlePlay.googleJson("https://androidpublisher.googleapis.com/test", "access-token", {}, fetchImpl),
    /google_api_failed:503/,
  );
  assert.equal(new Headers(requests[0].init.headers).get("authorization"), "Bearer access-token");
});

test("subscriptionsv2 조회는 경로 값을 인코딩하고 검증된 구독 매핑을 반환한다", async () => {
  assert.equal(typeof googlePlay.getGooglePlaySubscription, "function");
  assert.equal(typeof googlePlay.verifyGooglePlaySubscription, "function");
  const requests = [];
  const fetchImpl = async (url) => {
    requests.push(String(url));
    return Response.json(activeSubscription);
  };

  const verified = await googlePlay.verifyGooglePlaySubscription({
    packageName: "com.hyeni.calendar",
    productId: "hyeni_premium",
    basePlanId: "monthly-2900",
    offerId: "trial-7d",
    purchaseToken: "token/with spaces",
    accessToken: "access-token",
    expectedAccountId: "account-hash",
    expectedProfileId: "profile-hash",
    restore: false,
    now: new Date("2026-07-13T00:00:00.000Z"),
    fetchImpl,
  });

  assert.equal(
    requests[0],
    "https://androidpublisher.googleapis.com/androidpublisher/v3/applications/com.hyeni.calendar/purchases/subscriptionsv2/tokens/token%2Fwith%20spaces",
  );
  assert.equal(verified.status, "active");
  assert.equal(verified.productId, "hyeni_premium");
  assert.equal(verified.basePlanId, "monthly-2900");
  assert.equal(verified.offerId, "trial-7d");
  assert.equal(verified.linkedPurchaseToken, "previous-token");
  assert.deepEqual(verified.subscription, activeSubscription);
});

test("구독 매핑은 RTDN owner 조회에 필요한 product, offer, linked token을 보존한다", () => {
  const mapped = subscriptionPolicy.mapGoogleSubscriptionPurchaseMetadata(activeSubscription, "hyeni_premium");
  assert.equal(mapped.productId, "hyeni_premium");
  assert.equal(mapped.offerId, "trial-7d");
  assert.equal(mapped.linkedPurchaseToken, "previous-token");
});

test("subscriptionsv2 order 정본은 line item latestSuccessfulOrderId를 우선한다", () => {
  const subscription = {
    ...activeSubscription,
    latestOrderId: "legacy-order",
    lineItems: [{ ...activeSubscription.lineItems[0], latestSuccessfulOrderId: "line-order" }],
  };
  const mapped = subscriptionPolicy.mapGoogleSubscriptionEntitlement(
    subscription,
    "hyeni_premium",
    "monthly-2900",
    "trial-7d",
    new Date("2026-07-13T00:00:00.000Z"),
  );
  assert.equal(mapped.orderId, "line-order");
});

test("검증된 Google Play 구독 INSERT는 기존 컬럼 계약을 유지한다", async () => {
  assert.equal(typeof googlePlay.upsertGooglePlayFamilySubscription, "function");
  const db = createDb(false);
  await googlePlay.upsertGooglePlayFamilySubscription(
    db,
    {
      familyId: "family-1",
      productId: "hyeni_premium",
      purchaseTokenHash: "token-hash",
      fallbackOrderId: "client-order",
      source: "google_play_purchase_verify",
      verified: {
        subscription: activeSubscription,
        status: "active",
        productId: "hyeni_premium",
        basePlanId: "monthly-2900",
        offerId: "trial-7d",
        linkedPurchaseToken: "previous-token",
        currentPeriodEnd: "2026-08-13T00:00:00.000Z",
        trialEndsAt: null,
        orderId: "order-1",
        acknowledgementState: "ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED",
      },
    },
    { operation: "INSERT", now: () => "2026-07-13 00:00:00.000+00" },
  );

  assert.equal(db.writes.length, 3);
  assert.match(db.writes[0].sql, /INSERT INTO family_subscription/);
  assert.match(db.writes[0].sql, /'google_play'/);
  assert.match(db.writes[1].sql, /UPDATE billing_provider_reservations/);
  assert.match(db.writes[2].sql, /google_play_subscription_consistency_guard_failed/);
  assert.equal(db.writes[0].bindings[0], "family-1");
  assert.equal(db.writes[0].bindings[1], "active");
  assert.equal(db.writes[0].bindings[2], "hyeni_premium");
});

test("검증된 Google Play 구독 UPDATE는 provider 정본을 유지한다", async () => {
  const db = createDb(true);
  await googlePlay.upsertGooglePlayFamilySubscription(
    db,
    {
      familyId: "family-1",
      productId: "hyeni_premium",
      purchaseTokenHash: "token-hash",
      source: "google_play_rtdn",
      eventId: "pubsub-message-1",
      verified: {
        subscription: activeSubscription,
        status: "cancelled",
        productId: "hyeni_premium",
        basePlanId: "monthly-2900",
        offerId: "trial-7d",
        linkedPurchaseToken: "previous-token",
        currentPeriodEnd: "2026-08-13T00:00:00.000Z",
        trialEndsAt: null,
        orderId: "order-1",
        acknowledgementState: "ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED",
      },
    },
    { operation: "UPDATE", now: () => "2026-07-13 00:00:00.000+00" },
  );

  assert.equal(db.writes.length, 3);
  assert.match(db.writes[0].sql, /provider='google_play'/);
  assert.match(db.writes[1].sql, /UPDATE billing_provider_reservations/);
  assert.match(db.writes[2].sql, /google_play_subscription_consistency_guard_failed/);
});

test("family_subscription 기존 operation 조회는 DB write와 분리된다", async () => {
  assert.equal(typeof googlePlay.getGooglePlayFamilySubscriptionOperation, "function");
  assert.equal(await googlePlay.getGooglePlayFamilySubscriptionOperation(createDb(false), "family-1"), "INSERT");
  assert.equal(await googlePlay.getGooglePlayFamilySubscriptionOperation(createDb(true), "family-1"), "UPDATE");
});

test("family_subscription upsert helper는 별도 조회·realtime notify 없이 batch 내부 일관성만 확인한다", async () => {
  assert.equal(typeof googlePlay.upsertGooglePlayFamilySubscription, "function");
  const storage = createDb(false);
  const db = {
    writes: storage.writes,
    prepare(sql) {
      if (/^SELECT /.test(sql)) {
        assert.match(sql, /google_play_subscription_consistency_guard_failed/);
      }
      return storage.prepare(sql);
    },
    batch: storage.batch.bind(storage),
  };
  await googlePlay.upsertGooglePlayFamilySubscription(db, {
    familyId: "family-1",
    productId: "hyeni_premium",
    purchaseTokenHash: "token-hash",
    source: "google_play_purchase_verify",
    verified: {
      subscription: activeSubscription,
      status: "active",
      productId: "hyeni_premium",
      basePlanId: "monthly-2900",
      offerId: "trial-7d",
      linkedPurchaseToken: "previous-token",
      currentPeriodEnd: "2026-08-13T00:00:00.000Z",
      trialEndsAt: null,
      orderId: "order-1",
      acknowledgementState: "ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED",
    },
  }, { operation: "INSERT", now: () => "2026-07-13 00:00:00.000+00" });

  assert.equal(db.writes.length, 3);
  assert.match(db.writes[0].sql, /^INSERT INTO family_subscription/);
  assert.match(db.writes[1].sql, /^UPDATE billing_provider_reservations/);
  assert.match(db.writes[2].sql, /^SELECT CASE WHEN/);
});

test("family_subscription 영속 JSON에는 linked purchase token이 남지 않는다", async () => {
  const db = createDb(false);
  await googlePlay.upsertGooglePlayFamilySubscription(db, {
    familyId: "family-1",
    productId: "hyeni_premium",
    purchaseTokenHash: "safe-hash",
    source: "google_play_purchase_verify",
    verified: {
      subscription: activeSubscription,
      status: "active",
      productId: "hyeni_premium",
      basePlanId: "monthly-2900",
      offerId: "trial-7d",
      linkedPurchaseToken: "previous-token",
      currentPeriodEnd: "2026-08-13T00:00:00.000Z",
      trialEndsAt: null,
      orderId: "order-1",
      acknowledgementState: "ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED",
    },
  }, { operation: "INSERT", now: () => "2026-07-13 00:00:00.000+00" });

  assert.equal(JSON.stringify(db.writes).includes("previous-token"), false);
});

test("구매 route는 기존 SELECT·write·notify 오류 경계를 유지한다", () => {
  const start = routeSource.indexOf("const googleRawJson = JSON.stringify(storedVerified.subscription)");
  const end = routeSource.indexOf("UPDATE google_play_purchase_events", start);
  const block = routeSource.slice(start, end);

  assert.match(block, /const subscriptionOperation = await getGooglePlayFamilySubscriptionOperation\(db, familyId\);/);
  assert.match(block, /try\s*{\s*await upsertGooglePlayFamilySubscription/s);
  assert.match(block, /catch\s*\{[\s\S]*subscription_grant_failed[\s\S]*await notifyPg\(/);
  assert.ok(block.indexOf("getGooglePlayFamilySubscriptionOperation") < block.indexOf("try"));
  assert.ok(block.indexOf("await notifyPg") > block.indexOf("subscription_grant_failed"));
});
