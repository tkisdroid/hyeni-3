import {
  mapGoogleSubscriptionEntitlement,
  mapGoogleSubscriptionPurchaseMetadata,
} from "../shared/googlePlaySubscription.js";
import { isPremiumSubscriptionState } from "../shared/subscriptionEntitlement.js";

export type JsonMap = Record<string, unknown>;
type FetchImplementation = typeof fetch;

export interface VerifiedGooglePlaySubscription {
  subscription: JsonMap;
  status: string;
  productId: string;
  currentPeriodEnd: string | null;
  trialEndsAt: string | null;
  basePlanId: string;
  offerId: string;
  linkedPurchaseToken: string;
  orderId: string;
  acknowledgementState: string;
}

export type GooglePlayFamilySubscriptionOperation = "INSERT" | "UPDATE";

export function sanitizeGooglePlayForStorage(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeGooglePlayForStorage);
  if (!value || typeof value !== "object") return value;
  const sanitized: JsonMap = {};
  for (const [key, item] of Object.entries(value as JsonMap)) {
    const normalizedKey = key.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (normalizedKey.includes("token") || normalizedKey.includes("signature") || normalizedKey.includes("originaljson")) {
      continue;
    }
    sanitized[key] = sanitizeGooglePlayForStorage(item);
  }
  return sanitized;
}

export function prepareGooglePlayBillingOwnerUpsert(
  db: D1Database,
  args: {
    obfuscatedAccountId: string;
    obfuscatedProfileId: string;
    familyId: string;
    parentId: string;
    purchaseTokenHash: string;
    subscriptionEventId?: string | null;
    now: string;
  },
): D1PreparedStatement {
  return db.prepare(
    `INSERT INTO google_play_billing_owners
       (obfuscated_account_id,obfuscated_profile_id,family_id,parent_id,
        last_purchase_token_hash,created_at,updated_at)
     SELECT ?,?,?,?,?,?,?
      WHERE EXISTS(
        SELECT 1 FROM family_subscription fs
         WHERE fs.family_id=? AND fs.provider='google_play'
           AND fs.purchase_token_hash=?
           AND (? IS NULL OR fs.last_event_id=?)
      )
     ON CONFLICT(obfuscated_account_id,obfuscated_profile_id) DO UPDATE SET
       family_id=excluded.family_id,
       parent_id=excluded.parent_id,
       last_purchase_token_hash=excluded.last_purchase_token_hash,
       updated_at=excluded.updated_at`,
  ).bind(
    args.obfuscatedAccountId,
    args.obfuscatedProfileId,
    args.familyId,
    args.parentId,
    args.purchaseTokenHash,
    args.now,
    args.now,
    args.familyId,
    args.purchaseTokenHash,
    args.subscriptionEventId ?? null,
    args.subscriptionEventId ?? null,
  );
}

export async function upsertGooglePlayBillingOwner(
  db: D1Database,
  args: Parameters<typeof prepareGooglePlayBillingOwnerUpsert>[1],
): Promise<void> {
  const result = await prepareGooglePlayBillingOwnerUpsert(db, args).run();
  if (Number(result.meta?.changes ?? 0) !== 1) {
    throw new Error("google_play_billing_owner_guard_failed");
  }
}

export async function sha256Hex(value: string): Promise<string> {
  const data = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  bytes.forEach((byte) => binary += String.fromCharCode(byte));
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlJson(value: unknown): string {
  return base64Url(new TextEncoder().encode(JSON.stringify(value)));
}

function pemToArrayBuffer(pem: string): ArrayBuffer {
  const normalized = pem
    .replace(/\\n/g, "\n")
    .replace("-----BEGIN PRIVATE KEY-----", "")
    .replace("-----END PRIVATE KEY-----", "")
    .replace(/\s/g, "");
  const binary = atob(normalized);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes.buffer;
}

async function signServiceAccountJwt(serviceAccountJson: string): Promise<string> {
  const serviceAccount = JSON.parse(serviceAccountJson) as JsonMap;
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${base64UrlJson({ alg: "RS256", typ: "JWT" })}.${base64UrlJson({
    iss: serviceAccount.client_email,
    scope: "https://www.googleapis.com/auth/androidpublisher",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  })}`;
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToArrayBuffer(String(serviceAccount.private_key ?? "")),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(unsigned));
  return `${unsigned}.${base64Url(new Uint8Array(signature))}`;
}

export async function getGoogleAccessToken(
  serviceAccountJson: string,
  fetchImpl: FetchImplementation = fetch,
): Promise<string> {
  const assertion = await signServiceAccountJwt(serviceAccountJson);
  const response = await fetchImpl("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  const data = await response.json().catch(() => ({})) as JsonMap;
  if (!response.ok || !data.access_token) {
    throw new Error(`google_oauth_failed:${data.error_description || data.error || response.status}`);
  }
  return String(data.access_token);
}

export async function googleJson(
  url: string,
  accessToken: string,
  init: RequestInit = {},
  fetchImpl: FetchImplementation = fetch,
): Promise<JsonMap> {
  const response = await fetchImpl(url, {
    ...init,
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
      ...(init.headers || {}),
    },
  });
  const data = response.status === 204 ? {} : await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`google_api_failed:${response.status}:${JSON.stringify(data).slice(0, 500)}`);
  }
  return data as JsonMap;
}

/** 검증된 중복 Google Play 주문을 환불하고 entitlement를 즉시 회수합니다. */
export async function refundGooglePlayOrder(args: {
  packageName: string;
  orderId: string;
  accessToken: string;
  fetchImpl?: FetchImplementation;
}): Promise<void> {
  const packageName = encodeURIComponent(args.packageName);
  const orderId = encodeURIComponent(args.orderId);
  await googleJson(
    `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${packageName}/orders/${orderId}:refund?revoke=true`,
    args.accessToken,
    { method: "POST" },
    args.fetchImpl,
  );
}

export async function getGooglePlaySubscription(args: {
  packageName: string;
  purchaseToken: string;
  accessToken: string;
  fetchImpl?: FetchImplementation;
}): Promise<JsonMap> {
  const packageName = encodeURIComponent(args.packageName);
  const token = encodeURIComponent(args.purchaseToken);
  return googleJson(
    `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${packageName}/purchases/subscriptionsv2/tokens/${token}`,
    args.accessToken,
    {},
    args.fetchImpl,
  );
}

export async function verifyGooglePlaySubscription(args: {
  packageName: string;
  productId: string;
  basePlanId: string;
  offerId: string;
  purchaseToken: string;
  accessToken: string;
  expectedAccountId: string;
  expectedProfileId: string;
  restore: boolean;
  now?: Date;
  fetchImpl?: FetchImplementation;
}): Promise<VerifiedGooglePlaySubscription> {
  const subscription = await getGooglePlaySubscription(args);
  return {
    subscription,
    ...mapGoogleSubscriptionPurchaseMetadata(subscription, args.productId),
    ...mapGoogleSubscriptionEntitlement(
      subscription,
      args.productId,
      args.basePlanId,
      args.offerId,
      args.now ?? new Date(),
      args.expectedAccountId,
      args.expectedProfileId,
      args.restore,
    ),
  } as VerifiedGooglePlaySubscription;
}

export async function getGooglePlayFamilySubscriptionOperation(
  db: D1Database,
  familyId: string,
): Promise<GooglePlayFamilySubscriptionOperation> {
  const existing = await db
    .prepare("SELECT family_id FROM family_subscription WHERE family_id=? LIMIT 1")
    .bind(familyId)
    .first<{ family_id: string }>();
  return existing ? "UPDATE" : "INSERT";
}

type GooglePlaySubscriptionWriteInput = {
  familyId: string;
  purchaseTokenHash: string;
  linkedPurchaseTokenHash?: string | null;
  eventAt: string;
};

export async function canApplyGooglePlayFamilySubscriptionWrite(
  db: D1Database,
  input: GooglePlaySubscriptionWriteInput,
  now = new Date(),
): Promise<boolean> {
  const current = await db.prepare(
    `SELECT provider,purchase_token_hash,status,trial_ends_at,current_period_end,last_event_at
       FROM family_subscription WHERE family_id=? LIMIT 1`,
  ).bind(input.familyId).first<{
    provider: string | null;
    purchase_token_hash: string | null;
    status: string | null;
    trial_ends_at: string | null;
    current_period_end: string | null;
    last_event_at: string | null;
  }>();
  if (!current || current.provider !== "google_play" || !current.purchase_token_hash) return true;

  if (current.purchase_token_hash === input.purchaseTokenHash) {
    if (!current.last_event_at) return true;
    const currentEventMs = Date.parse(current.last_event_at);
    const incomingEventMs = Date.parse(input.eventAt);
    return Number.isFinite(incomingEventMs)
      && (!Number.isFinite(currentEventMs) || incomingEventMs >= currentEventMs);
  }
  if (
    input.linkedPurchaseTokenHash
    && current.purchase_token_hash === input.linkedPurchaseTokenHash
  ) return true;

  return !isPremiumSubscriptionState(
    current.status,
    current.trial_ends_at,
    current.current_period_end,
    now,
  );
}

export function prepareGooglePlayFamilySubscriptionWrite(
  db: D1Database,
  args: {
    familyId: string;
    productId: string;
    purchaseTokenHash: string;
    linkedPurchaseTokenHash?: string | null;
    fallbackOrderId?: string;
    source: string;
    eventId?: string;
    eventAt?: string;
    verified: VerifiedGooglePlaySubscription;
  },
  dependencies: {
    operation: GooglePlayFamilySubscriptionOperation;
    now: () => string;
  },
): D1PreparedStatement {
  const { familyId, productId, purchaseTokenHash, verified } = args;
  const operation = dependencies.operation;
  const now = dependencies.now();
  const eventId = args.eventId || purchaseTokenHash;
  const eventAt = args.eventAt || now;
  const cancelledAt = ["cancelled", "expired"].includes(verified.status) ? new Date().toISOString() : null;
  const storedSubscription = sanitizeGooglePlayForStorage(verified.subscription);
  const googleRawJson = JSON.stringify(storedSubscription);
  const rawEventJson = JSON.stringify({ source: args.source, subscription: storedSubscription });
  const providerGuard = `EXISTS(
    SELECT 1 FROM billing_provider_reservations bpr
     WHERE bpr.family_id=family_subscription.family_id
       AND bpr.provider='google_play' AND bpr.state IN ('reserved','active')
  )`;
  const existingProviderCanChange = `(
    family_subscription.provider='google_play'
    OR NOT (
      (LOWER(TRIM(COALESCE(family_subscription.status,''))) IN ('active','grace','cancelled')
        AND family_subscription.current_period_end IS NOT NULL
        AND datetime(substr(family_subscription.current_period_end,1,19))>datetime('now'))
      OR
      (LOWER(TRIM(COALESCE(family_subscription.status,'')))='trial'
        AND family_subscription.trial_ends_at IS NOT NULL
        AND datetime(substr(family_subscription.trial_ends_at,1,19))>datetime('now'))
    )
  )`;
  const currentGoogleEntitlementActive = `(
    (LOWER(TRIM(COALESCE(family_subscription.status,''))) IN ('active','grace','cancelled')
      AND family_subscription.current_period_end IS NOT NULL
      AND datetime(substr(family_subscription.current_period_end,1,19))
          >datetime(substr(?,1,19)))
    OR
    (LOWER(TRIM(COALESCE(family_subscription.status,'')))='trial'
      AND family_subscription.trial_ends_at IS NOT NULL
      AND datetime(substr(family_subscription.trial_ends_at,1,19))
          >datetime(substr(?,1,19)))
  )`;
  const tokenLineageGuard = `(
    family_subscription.provider<>'google_play'
    OR family_subscription.purchase_token_hash IS NULL
    OR family_subscription.purchase_token_hash=?
    OR (? IS NOT NULL AND family_subscription.purchase_token_hash=?)
    OR NOT ${currentGoogleEntitlementActive}
  )`;
  const eventFreshnessGuard = `(
    family_subscription.provider<>'google_play'
    OR family_subscription.purchase_token_hash IS NULL
    OR family_subscription.purchase_token_hash<>?
    OR family_subscription.last_event_at IS NULL
    OR datetime(substr(family_subscription.last_event_at,1,19))
       <=datetime(substr(?,1,19))
  )`;

  if (operation === "UPDATE") {
    return db
      .prepare(`UPDATE family_subscription
                   SET status=?, product_id=?, provider='google_play', base_plan_id=?,
                       purchase_token_hash=?, latest_order_id=?, current_period_end=?,
                       trial_ends_at=?, cancelled_at=?, acknowledged_at=?, google_play_raw=?,
                       raw_event=?, last_event_id=?, last_event_at=?, qonversion_user_id=?, updated_at=?
                 WHERE family_id=? AND ${providerGuard} AND ${existingProviderCanChange}
                   AND ${tokenLineageGuard} AND ${eventFreshnessGuard}`)
      .bind(
        verified.status,
        productId,
        verified.basePlanId,
        purchaseTokenHash,
        verified.orderId || args.fallbackOrderId || null,
        verified.currentPeriodEnd,
        verified.trialEndsAt,
        cancelledAt,
        now,
        googleRawJson,
        rawEventJson,
        eventId,
        eventAt,
        familyId,
        now,
        familyId,
        purchaseTokenHash,
        args.linkedPurchaseTokenHash ?? null,
        args.linkedPurchaseTokenHash ?? null,
        now,
        now,
        purchaseTokenHash,
        eventAt,
      );
  } else {
    return db
      .prepare(`INSERT INTO family_subscription
                  (family_id,status,product_id,qonversion_user_id,provider,base_plan_id,
                   purchase_token_hash,latest_order_id,current_period_end,trial_ends_at,
                   cancelled_at,acknowledged_at,google_play_raw,raw_event,last_event_id,
                   last_event_at,created_at,updated_at)
                SELECT ?,?,?,?,'google_play',?,?,?,?,?,?,?,?,?,?,?,?,?
                 WHERE EXISTS(
                   SELECT 1 FROM billing_provider_reservations bpr
                    WHERE bpr.family_id=? AND bpr.provider='google_play'
                      AND bpr.state IN ('reserved','active')
                 )`)
      .bind(familyId, verified.status, productId, familyId, verified.basePlanId, purchaseTokenHash, verified.orderId || args.fallbackOrderId || null, verified.currentPeriodEnd, verified.trialEndsAt, cancelledAt, now, googleRawJson, rawEventJson, eventId, eventAt, now, now, familyId);
  }
}

export function prepareGooglePlayProviderFinalization(
  db: D1Database,
  input: {
    familyId: string;
    purchaseTokenHash: string;
    eventId: string;
    active: boolean;
    now: string;
  },
): D1PreparedStatement {
  return db.prepare(
    `UPDATE billing_provider_reservations
        SET state=?, reservation_ref=?, conflicting_provider=NULL, conflict_ref=NULL,
            conflict_reason=NULL, resolution_status=NULL, updated_at=?
      WHERE family_id=? AND provider='google_play' AND state IN ('reserved','active')
        AND EXISTS(
          SELECT 1 FROM family_subscription fs
           WHERE fs.family_id=? AND fs.provider='google_play'
             AND fs.purchase_token_hash=? AND fs.last_event_id=?
        )`,
  ).bind(
    input.active ? "active" : "released",
    input.purchaseTokenHash,
    input.now,
    input.familyId,
    input.familyId,
    input.purchaseTokenHash,
    input.eventId,
  );
}

export function prepareGooglePlaySubscriptionConsistencyGuard(
  db: D1Database,
  input: {
    familyId: string;
    purchaseTokenHash: string;
    eventId: string;
    active: boolean;
  },
): D1PreparedStatement {
  return db.prepare(
    `SELECT CASE WHEN
       EXISTS(
         SELECT 1 FROM family_subscription fs
          WHERE fs.family_id=?1 AND fs.provider='google_play'
            AND fs.purchase_token_hash=?2 AND fs.last_event_id=?3
       )
       AND EXISTS(
         SELECT 1 FROM billing_provider_reservations bpr
          WHERE bpr.family_id=?1 AND bpr.provider='google_play'
            AND bpr.reservation_ref=?2 AND bpr.state=?4
       )
     THEN 1 ELSE json_extract('google_play_subscription_consistency_guard_failed','$') END AS ok`,
  ).bind(
    input.familyId,
    input.purchaseTokenHash,
    input.eventId,
    input.active ? "active" : "released",
  );
}

export async function upsertGooglePlayFamilySubscription(
  db: D1Database,
  args: Parameters<typeof prepareGooglePlayFamilySubscriptionWrite>[1],
  dependencies: Parameters<typeof prepareGooglePlayFamilySubscriptionWrite>[2],
): Promise<void> {
  const now = dependencies.now();
  const eventId = args.eventId || args.purchaseTokenHash;
  const results = await db.batch([
    prepareGooglePlayFamilySubscriptionWrite(db, args, { ...dependencies, now: () => now }),
    prepareGooglePlayProviderFinalization(db, {
      familyId: args.familyId,
      purchaseTokenHash: args.purchaseTokenHash,
      eventId,
      active: args.verified.status !== "expired",
      now,
    }),
    prepareGooglePlaySubscriptionConsistencyGuard(db, {
      familyId: args.familyId,
      purchaseTokenHash: args.purchaseTokenHash,
      eventId,
      active: args.verified.status !== "expired",
    }),
  ]);
  if (
    Number(results[0]?.meta?.changes ?? 0) !== 1
    || Number(results[1]?.meta?.changes ?? 0) !== 1
  ) {
    throw new Error("billing_provider_subscription_guard_failed");
  }
}
