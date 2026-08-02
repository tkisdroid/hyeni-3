import type { PushEnv } from "./pushEnv.ts";
import { pgTs } from "./time.ts";
import type { AccountMutationLease } from "./accountMutationLease.ts";
import type { AccountMutationScope } from "./accountMutationScope.ts";

const OUTBOX_LEASE_MS = 2 * 60_000;
const OUTBOX_BATCH_LIMIT = 20;
const RETRY_DELAYS_MS = [60_000, 5 * 60_000, 15 * 60_000, 30 * 60_000, 60 * 60_000] as const;

export interface MemoReplyOutboxInput {
  id: string;
  familyId: string;
  dateKey: string;
  childMemberId: string;
  senderUserId: string;
  senderRole: "parent" | "child";
  content: string;
  origin: string;
  createdAt: string;
}

export interface MemoNotificationOutboxClaim {
  replyId: string;
  familyId: string;
  leaseToken: string;
  attemptCount: number;
}

interface MemoReplyDeliveryRow {
  id: string;
  family_id: string;
  child_id: string | null;
  user_id: string | null;
  content: string;
}

export function memoMutationLeasesCoverScopes(
  leases: ReadonlyArray<Pick<AccountMutationLease, "userId" | "familyId">>,
  scopes: ReadonlyArray<AccountMutationScope>,
): boolean {
  const leaseKeys = new Set(
    leases.map((lease) => `${String(lease.userId ?? "").trim()}\u0000${String(lease.familyId ?? "").trim()}`),
  );
  return scopes.every((scope) => {
    const userId = String(scope.userId ?? "").trim();
    const familyId = String(scope.familyId ?? "").trim();
    return userId.length > 0 && leaseKeys.has(`${userId}\u0000${familyId}`);
  });
}

async function memoMutationLeasesAreActive(
  db: D1Database,
  leases: ReadonlyArray<AccountMutationLease>,
  scopes: ReadonlyArray<AccountMutationScope>,
): Promise<boolean> {
  if (!memoMutationLeasesCoverScopes(leases, scopes)) return false;
  const now = new Date().toISOString();
  for (const scope of scopes) {
    const userId = String(scope.userId ?? "").trim();
    const familyId = String(scope.familyId ?? "").trim();
    const lease = leases.find(
      (candidate) => candidate.userId === userId && String(candidate.familyId ?? "").trim() === familyId,
    );
    if (!lease) return false;
    const active = await db.prepare(
      `SELECT 1 AS ok FROM account_mutation_leases
        WHERE id=? AND user_id=? AND COALESCE(family_id,'')=? AND expires_at>?
        LIMIT 1`,
    ).bind(lease.id, userId, familyId, now).first<{ ok: number }>();
    if (!active?.ok) return false;
  }
  return true;
}

function cleanError(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error ?? "unknown");
  return text.trim().slice(0, 300) || "unknown";
}

function memoPushPreview(content: string): string {
  const text = String(content ?? "").trim();
  if (text.startsWith("[[img:")) return "사진을 보냈어요";
  if (text.startsWith("[[loc:")) return "위치를 보냈어요";
  return text.length > 80 ? `${text.slice(0, 80)}…` : text;
}

export function memoNotificationRetryDelayMs(attemptCount: number): number {
  const index = Math.max(0, Math.min(RETRY_DELAYS_MS.length - 1, Math.trunc(attemptCount) - 1));
  return RETRY_DELAYS_MS[index];
}

export function buildMemoReplyOutboxStatements(
  db: D1Database,
  input: MemoReplyOutboxInput,
): D1PreparedStatement[] {
  return [
    db.prepare(
      `INSERT INTO memo_replies
         (id, family_id, date_key, child_id, user_id, user_role, content, origin, read_by, created_at)
       VALUES (?,?,?,?,?,?,?,?, '{}', ?)`,
    ).bind(
      input.id,
      input.familyId,
      input.dateKey,
      input.childMemberId,
      input.senderUserId,
      input.senderRole,
      input.content,
      input.origin,
      input.createdAt,
    ),
    db.prepare(
      `INSERT INTO memo_notification_outbox
         (reply_id, family_id, attempt_count, next_attempt_at, lease_token, lease_expires_at,
          last_error, created_at, updated_at)
       VALUES (?,?,0,?,NULL,NULL,NULL,?,?)`,
    ).bind(input.id, input.familyId, input.createdAt, input.createdAt, input.createdAt),
  ];
}

export async function claimMemoNotificationOutbox(
  db: D1Database,
  input: { replyId: string; nowMs?: number },
): Promise<MemoNotificationOutboxClaim | null> {
  const nowMs = input.nowMs ?? Date.now();
  const now = pgTs(new Date(nowMs));
  const leaseToken = crypto.randomUUID();
  const leaseExpiresAt = pgTs(new Date(nowMs + OUTBOX_LEASE_MS));
  const row = await db.prepare(
    `UPDATE memo_notification_outbox
        SET lease_token=?, lease_expires_at=?, attempt_count=attempt_count+1, updated_at=?
      WHERE reply_id=?
        AND substr(next_attempt_at,1,19) <= substr(?,1,19)
        AND (lease_token IS NULL OR lease_expires_at IS NULL OR substr(lease_expires_at,1,19) <= substr(?,1,19))
      RETURNING reply_id, family_id, lease_token, attempt_count`,
  ).bind(leaseToken, leaseExpiresAt, now, input.replyId, now, now).first<{
    reply_id: string;
    family_id: string;
    lease_token: string;
    attempt_count: number;
  }>();
  if (!row?.reply_id || row.lease_token !== leaseToken) return null;
  return {
    replyId: row.reply_id,
    familyId: row.family_id,
    leaseToken: row.lease_token,
    attemptCount: Number(row.attempt_count),
  };
}

export async function recordMemoNotificationOutboxFailure(
  db: D1Database,
  claim: MemoNotificationOutboxClaim,
  error: unknown,
  nowMs = Date.now(),
): Promise<boolean> {
  const now = pgTs(new Date(nowMs));
  const nextAttemptAt = pgTs(new Date(nowMs + memoNotificationRetryDelayMs(claim.attemptCount)));
  const result = await db.prepare(
    `UPDATE memo_notification_outbox
        SET next_attempt_at=?, lease_token=NULL, lease_expires_at=NULL, last_error=?, updated_at=?
      WHERE reply_id=? AND lease_token=?`,
  ).bind(nextAttemptAt, cleanError(error), now, claim.replyId, claim.leaseToken).run();
  return Number(result.meta?.changes ?? 0) === 1;
}

export async function completeMemoNotificationOutbox(
  db: D1Database,
  claim: MemoNotificationOutboxClaim,
): Promise<boolean> {
  const result = await db.prepare(
    "DELETE FROM memo_notification_outbox WHERE reply_id=? AND lease_token=?",
  ).bind(claim.replyId, claim.leaseToken).run();
  return Number(result.meta?.changes ?? 0) === 1;
}

async function listDueReplyIds(
  db: D1Database,
  nowMs: number,
  limit: number,
): Promise<string[]> {
  const now = pgTs(new Date(nowMs));
  const { results } = await db.prepare(
    `SELECT reply_id FROM memo_notification_outbox
      WHERE substr(next_attempt_at,1,19) <= substr(?,1,19)
        AND (lease_token IS NULL OR lease_expires_at IS NULL OR substr(lease_expires_at,1,19) <= substr(?,1,19))
      ORDER BY substr(next_attempt_at,1,19) ASC, substr(created_at,1,19) ASC
      LIMIT ?`,
  ).bind(now, now, limit).all<{ reply_id: string }>();
  return (results ?? []).map((row) => String(row.reply_id ?? "")).filter(Boolean);
}

async function pendingCountForReply(
  db: D1Database,
  familyId: string,
  replyId: string,
): Promise<number> {
  const pushId = `memo:${replyId}`;
  const row = await db.prepare(
    `SELECT COUNT(*) AS count FROM pending_notifications
      WHERE family_id=?
        AND json_extract(data,'$.type')='new_memo'
        AND json_extract(data,'$.pushId')=?
        AND COALESCE(json_extract(data,'$.targetUserId'),'')<>''`,
  ).bind(familyId, pushId).first<{ count: number }>();
  return Number(row?.count ?? 0);
}

async function deliverClaim(
  env: PushEnv,
  db: D1Database,
  claim: MemoNotificationOutboxClaim,
  heldLeases?: ReadonlyArray<AccountMutationLease>,
): Promise<"delivered" | "cancelled"> {
  const [authz, mutationScope] = await Promise.all([
    import("../db/authz.ts"),
    import("./accountMutationScope.ts"),
  ]);
  const { resolveVerifiedFamilyMembership } = authz;
  const {
    acquireAccountMutationLeases,
    isActiveChildMutationTarget,
    loadFamilyNotificationMutationScopes,
    releaseAccountMutationLeases,
  } = mutationScope;
  const reply = await db.prepare(
    `SELECT id, family_id, child_id, user_id, content
       FROM memo_replies WHERE id=? AND family_id=? LIMIT 1`,
  ).bind(claim.replyId, claim.familyId).first<MemoReplyDeliveryRow>();
  if (!reply?.id || !reply.child_id || !reply.user_id) return "cancelled";

  const child = await db.prepare(
    `SELECT user_id, name FROM family_members
      WHERE family_id=? AND id=? AND role='child' AND is_active=1 AND user_id IS NOT NULL
      LIMIT 1`,
  ).bind(reply.family_id, reply.child_id).first<{ user_id: string; name: string | null }>();
  if (!child?.user_id) return "cancelled";

  const senderMembership = await resolveVerifiedFamilyMembership(db, reply.user_id, reply.family_id);
  if (!senderMembership) return "cancelled";

  const mutationScopes = await loadFamilyNotificationMutationScopes(
    db,
    reply.family_id,
    [reply.user_id, child.user_id],
  );
  if (!mutationScopes) return "cancelled";
  let acquiredLeases: AccountMutationLease[] | null = null;
  if (heldLeases) {
    if (!(await memoMutationLeasesAreActive(db, heldLeases, mutationScopes))) {
      throw new Error("account_mutation_lease_scope_mismatch");
    }
  } else {
    const leases = await acquireAccountMutationLeases(db, mutationScopes);
    if (leases.status !== "acquired") throw new Error(`account_mutation_${leases.status}`);
    acquiredLeases = leases.leases;
  }

  try {
    if (!(await isActiveChildMutationTarget(db, reply.family_id, child.user_id))) return "cancelled";
    const currentSenderMembership = await resolveVerifiedFamilyMembership(db, reply.user_id, reply.family_id);
    if (!currentSenderMembership) return "cancelled";

    const sender = await db.prepare(
      `SELECT name FROM family_members
        WHERE family_id=? AND user_id=? AND is_active=1 AND role IN ('parent','child')
        ORDER BY rowid DESC LIMIT 1`,
    ).bind(reply.family_id, reply.user_id).first<{ name: string | null }>();
    const senderName = (sender?.name || (currentSenderMembership.role === "child" ? "아이" : "보호자")).trim();
    const title = currentSenderMembership.role === "child"
      ? `${senderName}님이 메시지를 보냈어요`
      : `${senderName}님의 메시지`;
    const pushId = `memo:${reply.id}`;
    const { handleInstantNotification } = await import("../routes/push-notify.ts");
    const response = await handleInstantNotification(
      env,
      db,
      {
        action: "new_memo",
        familyId: reply.family_id,
        title,
        message: memoPushPreview(reply.content),
        targetChildUserId: child.user_id,
        idempotency_key: pushId,
      },
      reply.user_id,
      "service_role",
      pushId,
    );
    const responseBody = await response.clone().json().catch(() => null) as Record<string, unknown> | null;
    if (!response.ok) {
      throw new Error(`memo_delivery_${response.status}:${cleanError(responseBody?.error)}`);
    }

    const total = typeof responseBody?.total === "number" ? responseBody.total : null;
    const pendingCount = await pendingCountForReply(db, reply.family_id, reply.id);
    if (total !== 0 && pendingCount === 0) {
      throw new Error("memo_recipient_pending_missing");
    }
    return "delivered";
  } finally {
    if (acquiredLeases) {
      await releaseAccountMutationLeases(db, acquiredLeases);
    }
  }
}

export async function processMemoNotificationOutboxReply(
  env: PushEnv,
  db: D1Database,
  replyId: string,
  nowMs = Date.now(),
  heldLeases?: ReadonlyArray<AccountMutationLease>,
): Promise<"delivered" | "cancelled" | "retry" | "skipped"> {
  const claim = await claimMemoNotificationOutbox(db, { replyId, nowMs });
  if (!claim) return "skipped";
  try {
    const outcome = await deliverClaim(env, db, claim, heldLeases);
    if (!(await completeMemoNotificationOutbox(db, claim))) {
      throw new Error("memo_outbox_lease_lost");
    }
    return outcome;
  } catch (error) {
    await recordMemoNotificationOutboxFailure(db, claim, error, nowMs);
    console.error("[memo-outbox] delivery failed");
    return "retry";
  }
}

export async function processMemoNotificationOutbox(
  env: PushEnv,
  options: { nowMs?: number; limit?: number } = {},
): Promise<{ delivered: number; cancelled: number; retry: number; skipped: number }> {
  const nowMs = options.nowMs ?? Date.now();
  const limit = Math.max(1, Math.min(OUTBOX_BATCH_LIMIT, Math.trunc(options.limit ?? OUTBOX_BATCH_LIMIT)));
  const replyIds = await listDueReplyIds(env.DB, nowMs, limit);
  const stats = { delivered: 0, cancelled: 0, retry: 0, skipped: 0 };
  for (const replyId of replyIds) {
    const outcome = await processMemoNotificationOutboxReply(env, env.DB, replyId, nowMs);
    stats[outcome] += 1;
  }
  return stats;
}
