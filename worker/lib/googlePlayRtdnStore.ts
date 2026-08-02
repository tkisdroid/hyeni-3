export type GooglePlayRtdnClaimEvent = {
  messageId: string;
  eventTimeMillis: string;
  kind: "test" | "subscription";
  notificationType?: number;
};

export type GooglePlayRtdnClaimResult =
  | { state: "claimed"; claimToken: string }
  | { state: "complete" }
  | { state: "busy" };
export type GooglePlayRtdnOwner = { family_id: string; parent_id: string };

const PACKAGE_NAME = "com.hyeni.calendar";
const LEASE_MILLIS = 5 * 60 * 1000;

function timestamp(date: Date): string {
  return date.toISOString().replace("T", " ").replace("Z", "+00");
}

function changes(result: D1Result<unknown>): number {
  return Number(result.meta?.changes ?? 0);
}

export async function claimGooglePlayRtdnEvent(
  db: D1Database,
  event: GooglePlayRtdnClaimEvent,
  purchaseTokenHash: string | null,
  now: Date,
): Promise<GooglePlayRtdnClaimResult> {
  const nowText = timestamp(now);
  const leaseUntil = timestamp(new Date(now.getTime() + LEASE_MILLIS));
  const claimToken = crypto.randomUUID();
  const inserted = await db.prepare(
    "INSERT INTO google_play_rtdn_events (message_id, package_name, event_kind, notification_type, purchase_token_hash, status, attempts, claim_token, lease_until, event_time_ms, received_at, updated_at) VALUES (?,?,?,?,?,'processing',1,?,?,?,?,?) ON CONFLICT(message_id) DO NOTHING",
  ).bind(
    event.messageId,
    PACKAGE_NAME,
    event.kind,
    event.kind === "subscription" ? event.notificationType ?? null : null,
    purchaseTokenHash,
    claimToken,
    leaseUntil,
    event.eventTimeMillis,
    nowText,
    nowText,
  ).run();
  if (changes(inserted) > 0) return { state: "claimed", claimToken };

  const existing = await db.prepare(
    "SELECT status, lease_until, attempts FROM google_play_rtdn_events WHERE message_id=? LIMIT 1",
  ).bind(event.messageId).first<{ status: string; lease_until: string | null; attempts: number }>();
  if (!existing) return { state: "busy" };
  if (existing.status === "processed" || existing.status === "ignored") return { state: "complete" };

  const reclaimed = await db.prepare(
    "UPDATE google_play_rtdn_events SET status='processing', attempts=attempts+1, claim_token=?, lease_until=?, last_error=NULL, updated_at=? WHERE message_id=? AND (status='retryable' OR (status='processing' AND lease_until<=?))",
  ).bind(claimToken, leaseUntil, nowText, event.messageId, nowText).run();
  return changes(reclaimed) > 0 ? { state: "claimed", claimToken } : { state: "busy" };
}

export async function claimGooglePlayVoidedEvent(
  db: D1Database,
  event: {
    messageId: string;
    eventTimeMillis: string;
    productType: number;
    refundType: number;
  },
  purchaseTokenHash: string,
  now: Date,
): Promise<GooglePlayRtdnClaimResult> {
  const nowText = timestamp(now);
  const leaseUntil = timestamp(new Date(now.getTime() + LEASE_MILLIS));
  const claimToken = crypto.randomUUID();
  const inserted = await db.prepare(
    `INSERT INTO google_play_voided_purchase_events
       (message_id,package_name,purchase_token_hash,product_type,refund_type,status,
        attempts,claim_token,lease_until,event_time_ms,received_at,updated_at)
     VALUES (?,?,?,?,?,'processing',1,?,?,?,?,?)
     ON CONFLICT(message_id) DO NOTHING`,
  ).bind(
    event.messageId,
    PACKAGE_NAME,
    purchaseTokenHash,
    event.productType,
    event.refundType,
    claimToken,
    leaseUntil,
    event.eventTimeMillis,
    nowText,
    nowText,
  ).run();
  if (changes(inserted) > 0) return { state: "claimed", claimToken };

  const existing = await db.prepare(
    "SELECT status,lease_until FROM google_play_voided_purchase_events WHERE message_id=? LIMIT 1",
  ).bind(event.messageId).first<{ status: string; lease_until: string | null }>();
  if (!existing) return { state: "busy" };
  if (existing.status === "processed" || existing.status === "ignored") {
    return { state: "complete" };
  }
  const reclaimed = await db.prepare(
    `UPDATE google_play_voided_purchase_events
        SET status='processing',attempts=attempts+1,claim_token=?,lease_until=?,
            last_error=NULL,updated_at=?
      WHERE message_id=?
        AND (status='retryable' OR (status='processing' AND lease_until<=?))`,
  ).bind(claimToken, leaseUntil, nowText, event.messageId, nowText).run();
  return changes(reclaimed) > 0 ? { state: "claimed", claimToken } : { state: "busy" };
}

async function findOwnerByTokenHash(db: D1Database, tokenHash: string): Promise<GooglePlayRtdnOwner | null> {
  return db.prepare(
    `SELECT family_id, parent_id
       FROM google_play_purchase_events
      WHERE purchase_token_hash=? AND product_type='subscription'
        AND family_id IS NOT NULL AND parent_id IS NOT NULL
      UNION ALL
     SELECT owners.family_id, owners.parent_id
       FROM family_subscription subscription
       JOIN google_play_billing_owners owners
         ON owners.family_id=subscription.family_id
        AND owners.last_purchase_token_hash=subscription.purchase_token_hash
      WHERE subscription.purchase_token_hash=? AND subscription.provider='google_play'
      LIMIT 1`,
  ).bind(tokenHash, tokenHash).first<GooglePlayRtdnOwner>();
}

export async function resolveGooglePlayRtdnOwner(
  db: D1Database,
  args: {
    purchaseTokenHash: string;
    linkedPurchaseTokenHash: string | null;
    obfuscatedAccountId: string;
    obfuscatedProfileId: string;
  },
): Promise<GooglePlayRtdnOwner | null> {
  const current = await findOwnerByTokenHash(db, args.purchaseTokenHash);
  if (current) return current;
  if (args.linkedPurchaseTokenHash) {
    const linked = await findOwnerByTokenHash(db, args.linkedPurchaseTokenHash);
    if (linked) return linked;
  }
  if (!args.obfuscatedAccountId || !args.obfuscatedProfileId) return null;
  return db.prepare(
    "SELECT family_id, parent_id FROM google_play_billing_owners WHERE obfuscated_account_id=? AND obfuscated_profile_id=? LIMIT 1",
  ).bind(args.obfuscatedAccountId, args.obfuscatedProfileId).first<GooglePlayRtdnOwner>();
}
