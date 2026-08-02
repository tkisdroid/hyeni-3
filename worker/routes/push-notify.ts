// POST /api/push-notify  ← supabase/functions/push-notify/index.ts (직역, M5 핵심).
// FCM(네이티브) + VAPID(웹) 푸시 발송 + cron 일정알림 스캔. 2개 모드:
//   1. instant: POST body.action (parent_alert/new_event/new_memo/kkuk/sos/emergency/
//      remote_listen(_stop)/request_location/request_device_status/force_ring(_stop/_reminder)/
//      teacher_batch/teacher_notice/playdate_started(_ended))
//   2. cron: body 없음 → 60/30/15/10/5/0분 일정 리마인더 + 미도착 긴급.
//
// ── 인증(원본 보존, 권한 약화 금지) ──
//  · 내부(cron/edge): x-internal-secret == PUSH_INTERNAL_SECRET(상수시간 비교) → service_role.
//    (원본의 service_role JWT == SUPABASE_SERVICE_KEY 경로는 Worker 엔 해당 키가 없어 제거 —
//     내부 호출은 공유 시크릿으로만 인증. 위조 가능한 미검증 role 디코드는 원본에서 이미 제거됨.)
//  · 사용자: Bearer JWT → verifyAccessToken(서명검증). 사용자 토큰은 service_role 로 승격 안 함.
//    위험 원격제어 action 은 family_members/families 조회로 주보호자 게이트(canCallerSendAction).
//
// ── D1 변환 ──
//  · 복합 unique 미이관 → select-then-write: push_idempotency(멱등키), push_sent(이벤트 dedup),
//    force_ring one-active-per-family / client_request_hash. 멱등성(CRITICAL) 보존.
//  · RPC 직역: force_ring_check_quota / family_subscription_effective_tier / insert_parent_alert_v2.
//  · jsonb(location/notif_override/data/subscription/metadata/delivery_status) ↔ parseJson/JSON.stringify.
//  · boolean(is_family_event/parent_enabled/child_enabled/remote_listen_enabled) 0/1 ↔ toBool.
//  · uuid[]/int[](minutes_before/read_by) ↔ pgArray. write timestamp pgNow(), 범위비교 substr(col,1,19).
import { Hono } from "hono";
import type { Env, Vars } from "../types";
import type { PushEnv } from "../lib/pushEnv";
import { verifyAccessToken } from "../lib/jwt";
import { pgNow, tsNorm } from "../lib/time";
import { parseJson, toBool, pgArray } from "../lib/serialize";
import { notifyPg } from "../lib/realtime";
import { sendFcmNotification, sendFcmWithRetry, sendFcmDataOnly } from "../lib/fcm";
import { isWebPushConfigured, sendWebPush, sendWebPushWithRetry } from "../lib/webpush";
import { chunkSqlVariables } from "../lib/sqlChunk";
import {
  loadParentAlertRecipientIds,
  loadParentAlertRecipients,
} from "../lib/parentAlertRecipients";
import {
  canonicalParentAlertType,
  parentAlertDedupeKey,
  parentAlertDeliveryKey,
  parentAlertPendingId,
  parentAlertRecipientClaimKey,
  shouldRetryParentRecipientDelivery,
} from "../lib/parentAlertDedupe";
import {
  eventOccurrenceAlertId,
  eventReminderPushId,
  eventRevisionKey,
} from "../lib/eventOccurrence";
import {
  ARRIVAL_RADIUS_M,
  buildNotifSettingsMap,
  canCallerSendAction,
  eventBelongsToActiveChild,
  isEmergencyNotificationType,
  partitionNotArrivedByFreshness,
  isCronReminderDue,
  isNotArrivedAlertWindow,
  parentAlertPendingTtlMs,
  selectCronWindowRecipients,
  selectEventTargetChildren,
  selectParentRecipientsForAction,
  type EffectiveNotifSetting,
} from "../lib/notificationRouting";
import { resolveFamilyEntitlement } from "../shared/subscriptionEntitlement.js";
import {
  claimForceRingQuotaLease,
  claimLocationManualRequestUsage,
  readForceRingQuota,
  releaseFeatureUsageClaim,
} from "../lib/featureUsageQuota";
import { collectPlaydateNotificationParentIds } from "../lib/playdateNotificationRecipients";
import { childSafetyNotificationForAlert } from "../lib/childSafetyNotification";
import { resolveVerifiedFamilyMembership } from "../db/authz";
import { parentAlertTargetRoute } from "../lib/parentAlertRoute";
import { recordFamilyLifecycleEvent } from "../lib/familyLifecycleFunnel";
import {
  recordLocationAlertProvisionToParents,
  recordLocationConfirmationForSubjects,
} from "../lib/locationConfirmationAudit";
import {
  isServerDerivedParentAlertType,
  resolveParentAlertWriteScope,
} from "../lib/parentAlertAuthorization";
import { resolveParentAlertPushType } from "../lib/parentAlertPushPolicy";
import { loadActiveFamilyNotificationRecipientIds } from "../lib/pendingNotificationDelivery";
import { partitionNotificationRecipients } from "../lib/notificationQuietHours";
import {
  claimTeacherNoticeTerminalSuppression,
  loadTeacherNoticeAudience,
} from "../lib/teacherNoticeDelivery";
import {
  authorizeRemoteListenCommand,
  REMOTE_LISTEN_DURATION_SEC,
} from "../lib/remoteListenSecurity";
import { authorizeRemoteListenCaptureWindow } from "../lib/remoteListenConsent";
import {
  acquireMemoInteractionLeases,
  loadUnblockedMemoRecipientIds,
  MEMO_DELIVERY_NETWORK_DEADLINE_MS,
  releaseMemoInteractionLeases,
} from "../lib/memoInteractionLease";
import {
  createMemoDisplayPermit,
  isMemoDisplayPermitAllowed,
  verifyMemoDisplayPermit,
} from "../lib/memoDisplayPermit";
import {
  acquireAccountMutationLease,
  releaseAccountMutationLease,
  type AccountMutationLease,
} from "../lib/accountMutationLease";
import {
  acquireAccountMutationLeases,
  isActiveChildMutationTarget,
  loadFamilyNotificationMutationScopes,
  releaseAccountMutationLeases,
  type AccountMutationScope,
} from "../lib/accountMutationScope";

const push = new Hono<{ Bindings: Env; Variables: Vars }>();
const EVENT_CHILD_QUERY_CHUNK = 90;
const MEMO_DISPLAY_AUTH_MAX_BODY_BYTES = 4_096;
const SERVER_DERIVED_NOTIFICATION_ACTIONS = new Set([
  "child_safety",
]);

// ── helpers ────────────────────────────────────────────────────────────────
function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
    },
  });
}

function memoDisplayAuthorizationResponse(allowed: boolean, status = 200): Response {
  return new Response(JSON.stringify({ allowed }), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

async function readBoundedMemoAuthorizationBody(
  request: Request,
): Promise<{ ok: true; text: string } | { ok: false; status: 400 | 413 }> {
  if (!request.body) return { ok: true, text: "" };
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > MEMO_DISPLAY_AUTH_MAX_BODY_BYTES) {
        try {
          await reader.cancel();
        } catch {
          // 크기 초과 판정은 이미 끝났으므로 cancel 실패도 413으로 닫는다.
        }
        return { ok: false, status: 413 };
      }
      chunks.push(value);
    }
    const combined = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of chunks) {
      combined.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return {
      ok: true,
      text: new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(combined),
    };
  } catch {
    return { ok: false, status: 400 };
  } finally {
    reader.releaseLock();
  }
}

function timingSafeEqualStr(a: string, b: string): boolean {
  if (typeof a !== "string" || typeof b !== "string") return false;
  if (a.length === 0 || a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

function toStringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

// epoch ms → D1 호환 pg 형식.
function pgFromMs(ms: number): string {
  return new Date(ms).toISOString().replace("T", " ").replace("Z", "+00");
}

async function disableFcmTokensByIds(db: D1Database, ids: string[]): Promise<void> {
  if (!ids.length) return;
  const ph = ids.map(() => "?").join(",");
  try {
    await db.prepare(
      `UPDATE fcm_tokens
          SET disabled_at = ?, disabled_reason = 'invalid_fcm_token'
        WHERE id IN (${ph}) AND disabled_at IS NULL`,
    ).bind(pgNow(), ...ids).run();
  } catch (e) {
    console.error("fcm_tokens disable failed:");
  }
}

async function disablePushSubsByIds(db: D1Database, ids: string[]): Promise<void> {
  if (!ids.length) return;
  const ph = ids.map(() => "?").join(",");
  try {
    await db.prepare(
      `UPDATE push_subscriptions
          SET disabled_at = ?, disabled_reason = 'invalid_web_push_subscription'
        WHERE id IN (${ph}) AND disabled_at IS NULL`,
    ).bind(pgNow(), ...ids).run();
  } catch (e) {
    console.error("push_subscriptions disable failed:");
  }
}

// ── DB helpers (원본 supabase 호출 직역) ─────────────────────────────────────
async function fetchFcmTokensForUsers(
  db: D1Database,
  userIds: string[],
): Promise<{ id: string; fcm_token: string }[]> {
  const uniqueIds = Array.from(new Set(userIds.filter((id) => typeof id === "string" && id.length > 0)));
  if (uniqueIds.length === 0) return [];
  const ph = uniqueIds.map(() => "?").join(",");
  try {
    const { results } = await db
      .prepare(`SELECT id, fcm_token FROM fcm_tokens WHERE user_id IN (${ph}) AND disabled_at IS NULL`)
      .bind(...uniqueIds)
      .all<{ id: string; fcm_token: string }>();
    const seen = new Set<string>();
    return (results ?? []).filter((row) => {
      if (!row.fcm_token || seen.has(row.fcm_token)) return false;
      seen.add(row.fcm_token);
      return true;
    });
  } catch (e) {
    console.error("playdate: fcm_tokens lookup failed:");
    return [];
  }
}

async function getNativeRecipientIds(db: D1Database, familyId: string): Promise<Set<string>> {
  if (!familyId) return new Set<string>();
  try {
    const { results } = await db
      .prepare("SELECT user_id FROM fcm_tokens WHERE family_id = ? AND disabled_at IS NULL")
      .bind(familyId)
      .all<{ user_id: string }>();
    return new Set((results ?? []).map((r) => r.user_id).filter((u): u is string => typeof u === "string" && u.length > 0));
  } catch (e) {
    console.error("Failed to load native recipients:");
    return new Set<string>();
  }
}

async function getFamilyMemberIdsByRole(db: D1Database, familyId: string, role: string): Promise<Set<string>> {
  if (!familyId || !role) return new Set<string>();
  try {
    const { results } = await db
      .prepare(
        `SELECT user_id FROM family_members
          WHERE family_id = ? AND role = ?
            AND (role <> 'child' OR is_active = 1)`,
      )
      .bind(familyId, role)
      .all<{ user_id: string }>();
    return new Set((results ?? []).map((r) => r.user_id).filter((u): u is string => typeof u === "string" && u.length > 0));
  } catch (e) {
    console.error("Failed to load role recipients");
    return new Set<string>();
  }
}

function routeForRecipient(
  type: string,
  recipientUserId: string,
  data: Record<string, string>,
): string {
  if (data.route) return data.route;
  if (type === "new_memo") {
    return data.targetChildUserId === recipientUserId
      ? "/child/memo"
      : `/parent/memo?child=${encodeURIComponent(data.targetChildUserId || "")}`;
  }
  if (type === "child_safety") return "/child/home";
  if (type === "parent_alert") return "/notifications";
  if (type === "sos" || type === "emergency" || type === "kkuk") return "/sos-receive";
  return "";
}

function roleForRecipient(type: string, recipientUserId: string, data: Record<string, string>): string {
  if (data.targetRole) return data.targetRole;
  if (type === "new_memo" && data.targetChildUserId) {
    return data.targetChildUserId === recipientUserId ? "child" : "parent";
  }
  if (type === "child_safety") return "child";
  if (type === "parent_alert" || type === "sos" || type === "emergency" || type === "kkuk") return "parent";
  return "";
}

// 가족 전 기기에 FCM 발송(sender 제외). recipientUserIds 로 수신자 한정.
// (lib/arrivalDetect 의 미등록 장소 도착 알림이 재사용 — export)
export async function sendFcmToFamily(
  env: PushEnv,
  db: D1Database,
  familyId: string,
  senderUserId: string | null,
  title: string,
  body: string,
  type: string,
  extraData: Record<string, string> = {},
  recipientUserIds: Set<string> | null = null,
  signal?: AbortSignal,
): Promise<number> {
  let tokens: Array<{ id: string; user_id: string; fcm_token: string }> = [];
  try {
    const { results } = await db
      .prepare("SELECT id, user_id, fcm_token FROM fcm_tokens WHERE family_id = ? AND disabled_at IS NULL")
      .bind(familyId)
      .all<{ id: string; user_id: string; fcm_token: string }>();
    tokens = results ?? [];
  } catch (e) {
    console.error("Failed to load fcm_tokens:");
    return 0;
  }
  if (!tokens.length) return 0;

  let sent = 0;
  const expiredIds: string[] = [];
  const processedTokens = new Set<string>();

  for (const t of tokens) {
    if (t.user_id === senderUserId) continue;
    if (recipientUserIds && !recipientUserIds.has(t.user_id)) continue;
    if (processedTokens.has(t.fcm_token)) continue;
    processedTokens.add(t.fcm_token);

    const pushData: Record<string, string> = {
      type,
      familyId,
      senderUserId: senderUserId || "",
      ...extraData,
      targetUserId: t.user_id,
    };
    const targetRole = roleForRecipient(type, t.user_id, pushData);
    const route = routeForRecipient(type, t.user_id, pushData);
    if (targetRole) pushData.targetRole = targetRole;
    if (route) pushData.route = route;
    pushData.urgent = isEmergencyNotificationType(type, pushData) ? "true" : "false";
    const result = await sendFcmWithRetry(env, t.fcm_token, title, body, pushData, 3, signal);
    if (result === "sent") sent++;
    else if (result === "expired") expiredIds.push(t.id);
  }

  await disableFcmTokensByIds(db, expiredIds);
  return sent;
}

// family_subscription_effective_tier RPC 직역.
async function effectiveTier(db: D1Database, familyId: string): Promise<"premium" | "free"> {
  return (await resolveFamilyEntitlement(db, familyId)).isPremium ? "premium" : "free";
}

// force_ring_check_quota RPC 직역(10분 zombie 제외 포함).
// P3 force_ring read 라우트(routes/force-ring.ts)가 quota read 에 재사용한다(export).
export async function forceRingCheckQuota(
  db: D1Database,
  familyId: string,
): Promise<{ allowed: boolean; quota: number; used: number; tier: string }> {
  return readForceRingQuota(db, familyId);
}

let parentAlertClaimReady: Promise<void> | null = null;
const PARENT_ALERT_CLAIM_LEASE_MS = 2 * 60_000;

function ensureParentAlertClaimTable(db: D1Database): Promise<void> {
  if (!parentAlertClaimReady) {
    parentAlertClaimReady = db
      .prepare(
        `CREATE TABLE IF NOT EXISTS parent_alert_idempotency (
          dedupe_key TEXT NOT NULL PRIMARY KEY,
          family_id TEXT NOT NULL,
          alert_id TEXT NOT NULL,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
        )`,
      )
      .run()
      .then(() => undefined)
      .catch((error) => {
        parentAlertClaimReady = null;
        throw error;
      });
  }
  return parentAlertClaimReady;
}

async function findClaimedParentAlert(
  db: D1Database,
  dedupeKey: string,
  familyId: string,
  eventId: string,
  canonicalAlertType: string,
): Promise<string | null> {
  const row = await db
    .prepare(
      `SELECT pa.id AS alert_id
         FROM parent_alert_idempotency pai
         JOIN parent_alerts pa ON pa.id = pai.alert_id
        WHERE pai.dedupe_key = ? AND pai.family_id = ?
          AND pa.family_id = ? AND pa.event_id = ?
          AND CASE
                WHEN pa.alert_type IN ('arrived','late_arrived','place_arrived') THEN 'arrived'
                ELSE pa.alert_type
              END = ?
        LIMIT 1`,
    )
    .bind(dedupeKey, familyId, familyId, eventId, canonicalAlertType)
    .first<{ alert_id: string | null }>();
  return row?.alert_id ?? null;
}

// insert_parent_alert_v2 RPC 직역 — (event_id, alert_type) 멱등 insert. 반환 uuid|null.
// 기존 select-then-insert 는 자녀 네이티브 geofence 와 서버 cron 이 동시에 들어올 때
// 둘 다 "없음"으로 판단해 같은 parent_alert 를 2~3개 만들 수 있었다. 별도 PK claim
// 테이블로 같은 event_id+alert_type 은 한 caller 만 생성 경로에 들어오게 한다.
export async function insertParentAlertV2(
  env: PushEnv,
  db: D1Database,
  args: {
    familyId: string;
    alertType: string;
    title: string;
    message: string;
    severity?: string;
    eventId?: string | null;
    childUserId?: string | null;
    metadata?: Record<string, unknown> | null;
  },
): Promise<string | null> {
  const evId = args.eventId ? String(args.eventId) : null;
  const id = crypto.randomUUID();
  const now = pgNow();
  const metadata = args.metadata ? JSON.stringify(args.metadata) : null;
  const returnRecordedAlert = async (alertId: string): Promise<string> => {
    if (canonicalParentAlertType(args.alertType) === "arrived") {
      await recordFamilyLifecycleEvent(env, {
        familyId: args.familyId,
        event: "first_arrival",
        occurredAt: now,
      });
    }
    return alertId;
  };
  try {
    if (evId) {
      await ensureParentAlertClaimTable(db);
      const canonicalAlertType = canonicalParentAlertType(args.alertType);
      const dedupeKey = parentAlertDedupeKey(args.familyId, args.alertType, evId);
      const claim = await db
        .prepare(
          `INSERT OR IGNORE INTO parent_alert_idempotency (dedupe_key, family_id, alert_id, created_at)
           VALUES (?,?,?,?)`,
        )
        .bind(dedupeKey, args.familyId, id, now)
        .run();
      let ownsClaim = Number(claim.meta?.changes ?? 0) > 0;
      if (!ownsClaim) {
        const completedAlertId = await findClaimedParentAlert(
          db,
          dedupeKey,
          args.familyId,
          evId,
          canonicalAlertType,
        );
        if (completedAlertId) return returnRecordedAlert(completedAlertId);

        // claim 저장 직후 Worker가 중단되면 alert 행 없이 claim만 남는다. 신선한 claim은
        // 다른 실행의 진행 중 작업일 수 있으므로 건드리지 않고, lease가 지난 orphan만 회수한다.
        const release = await db
          .prepare(
            `DELETE FROM parent_alert_idempotency
              WHERE dedupe_key = ? AND family_id = ? AND created_at < ?
                AND NOT EXISTS (
                  SELECT 1 FROM parent_alerts pa
                   WHERE pa.id = parent_alert_idempotency.alert_id
                     AND pa.family_id = ? AND pa.event_id = ?
                     AND CASE
                           WHEN pa.alert_type IN ('arrived','late_arrived','place_arrived') THEN 'arrived'
                           ELSE pa.alert_type
                         END = ?
                )`,
          )
          .bind(
            dedupeKey,
            args.familyId,
            pgFromMs(Date.now() - PARENT_ALERT_CLAIM_LEASE_MS),
            args.familyId,
            evId,
            canonicalAlertType,
          )
          .run();
        if (Number(release.meta?.changes ?? 0) > 0) {
          const reclaimed = await db
            .prepare(
              `INSERT OR IGNORE INTO parent_alert_idempotency (dedupe_key, family_id, alert_id, created_at)
               VALUES (?,?,?,?)`,
            )
            .bind(dedupeKey, args.familyId, id, now)
            .run();
          ownsClaim = Number(reclaimed.meta?.changes ?? 0) > 0;
        }
        if (!ownsClaim) {
          const racedAlertId = await findClaimedParentAlert(
            db,
            dedupeKey,
            args.familyId,
            evId,
            canonicalAlertType,
          );
          if (racedAlertId) return returnRecordedAlert(racedAlertId);
          return null;
        }
      }

      const res = await db
        .prepare(
          `INSERT INTO parent_alerts (id, family_id, alert_type, title, message, severity, event_id, child_user_id, metadata, read, read_by, created_at)
           SELECT ?,?,?,?,?,?,?,?,?, 0, '{}', ?
            WHERE NOT EXISTS (
              SELECT 1 FROM parent_alerts
               WHERE family_id = ? AND event_id = ?
                 AND CASE
                       WHEN alert_type IN ('arrived','late_arrived','place_arrived') THEN 'arrived'
                       ELSE alert_type
                     END = ?
               LIMIT 1
            )`,
        )
        .bind(
          id,
          args.familyId,
          args.alertType,
          args.title,
          args.message,
          args.severity || "info",
          evId,
          args.childUserId ?? null,
          metadata,
          now,
          args.familyId,
          evId,
          canonicalAlertType,
        )
        .run();
      if (Number(res.meta?.changes ?? 0) === 0) {
        const ex = await db
          .prepare(
            `SELECT id FROM parent_alerts
              WHERE family_id = ? AND event_id = ?
                AND CASE
                      WHEN alert_type IN ('arrived','late_arrived','place_arrived') THEN 'arrived'
                      ELSE alert_type
                    END = ?
              ORDER BY created_at ASC, id ASC
              LIMIT 1`,
          )
          .bind(args.familyId, evId, canonicalAlertType)
          .first<{ id: string }>();
        if (ex?.id) {
          await db
            .prepare("UPDATE parent_alert_idempotency SET alert_id = ? WHERE dedupe_key = ? AND family_id = ?")
            .bind(ex.id, dedupeKey, args.familyId)
            .run();
        }
        return ex?.id ? returnRecordedAlert(ex.id) : null;
      }
    } else {
      await db
        .prepare(
          `INSERT INTO parent_alerts (id, family_id, alert_type, title, message, severity, event_id, child_user_id, metadata, read, read_by, created_at)
           VALUES (?,?,?,?,?,?,?,?,?, 0, '{}', ?)`,
        )
        .bind(id, args.familyId, args.alertType, args.title, args.message, args.severity || "info", null, args.childUserId ?? null, metadata, now)
        .run();
    }
  } catch (e) {
    console.error("insert_parent_alert_v2 insert failed:");
    if (evId) {
      await db
        .prepare("DELETE FROM parent_alert_idempotency WHERE dedupe_key = ? AND family_id = ? AND alert_id = ?")
        .bind(parentAlertDedupeKey(args.familyId, args.alertType, evId), args.familyId, id)
        .run()
        .catch(() => undefined);
    }
    return null;
  }
  await notifyPg(env, args.familyId, "parent_alerts", "INSERT", {
    id, family_id: args.familyId, alert_type: args.alertType, title: args.title, message: args.message,
    severity: args.severity || "info", event_id: evId, child_user_id: args.childUserId ?? null,
    metadata: args.metadata ?? null,
    read: false, created_at: now,
  }, null);
  return returnRecordedAlert(id);
}

// pending_notifications insert(공통). delivered/expires_at 기본값을 PG 기본과 맞춘다.
async function insertPending(
  db: D1Database,
  row: {
    id?: string;
    family_id: string;
    title: string;
    body?: string;
    data?: Record<string, unknown>;
    delivery_status?: Record<string, unknown> | null;
    idempotency_key?: string | null;
    delivered?: boolean;
    expires_at?: string | null;
  },
): Promise<boolean> {
  try {
    await db
      .prepare(
        `INSERT OR IGNORE INTO pending_notifications (id, family_id, title, body, data, delivered, delivery_status, idempotency_key, expires_at, created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?)`,
      )
      .bind(
        row.id ?? crypto.randomUUID(),
        row.family_id,
        row.title,
        row.body ?? "",
        JSON.stringify(row.data ?? {}),
        row.delivered ? 1 : 0,
        row.delivery_status != null ? JSON.stringify(row.delivery_status) : null,
        row.idempotency_key ?? null,
        row.expires_at ?? pgFromMs(Date.now() + 24 * 60 * 60 * 1000),
        pgNow(),
      )
      .run();
    // 동일 deterministic id가 이미 있으면 이전 시도에서 pending 보관까지 끝난 상태다.
    return true;
  } catch (e) {
    console.error("Failed to queue pending notification:");
    return false;
  }
}

async function isPendingDelivered(db: D1Database, id: string): Promise<boolean> {
  try {
    const row = await db
      .prepare("SELECT delivered FROM pending_notifications WHERE id = ? LIMIT 1")
      .bind(id)
      .first<{ delivered: number | boolean | null }>();
    return row?.delivered === 1 || row?.delivered === true;
  } catch (e) {
    console.error("Failed to read pending delivery state:");
    // 읽기 실패를 delivered로 추정하면 실제 알림이 유실되므로 미확인 상태로 둔다.
    return false;
  }
}

async function prequeueGenericRecipientPending(
  db: D1Database,
  args: {
    action: string;
    familyId: string;
    senderUserId: string | null;
    title: string;
    message: string;
    pushId: string;
    urgent: boolean;
    recipientUserIds: Array<string | null>;
    extraData: Record<string, string>;
    memoDisplayPermits?: ReadonlyMap<string, string>;
    expiresAt: string | null;
  },
): Promise<boolean> {
  for (const recipientUserId of args.recipientUserIds) {
    const targetRole = recipientUserId
      ? roleForRecipient(args.action, recipientUserId, args.extraData)
      : (args.extraData.targetRole || "");
    const route = recipientUserId
      ? routeForRecipient(args.action, recipientUserId, args.extraData)
      : (args.extraData.route || "");
    const id = `instant-${args.familyId}-${args.action}-${args.pushId}-${recipientUserId || "family"}`;
    const memoDisplayPermit = recipientUserId
      ? args.memoDisplayPermits?.get(recipientUserId)
      : undefined;
    const queued = await insertPending(db, {
      id,
      family_id: args.familyId,
      title: args.title,
      body: args.message,
      data: {
        ...args.extraData,
        senderUserId: args.senderUserId || "",
        familyId: args.familyId,
        type: args.action,
        action: args.action,
        pushId: args.pushId,
        urgent: args.urgent,
        ...(memoDisplayPermit ? { memoDisplayPermit } : {}),
        ...(recipientUserId ? { targetUserId: recipientUserId } : {}),
        ...(targetRole ? { targetRole } : {}),
        ...(route ? { route } : {}),
      },
      delivery_status: {
        queued: true,
        ...(recipientUserId ? { targetUserId: recipientUserId } : {}),
      },
      idempotency_key: id,
      delivered: false,
      expires_at: args.expiresAt,
    });
    if (!queued) return false;
  }
  return true;
}

// push_idempotency claim. 반환: 중복이면 true.
export async function claimIdempotencyKey(
  db: D1Database,
  key: string,
  action: string,
  familyId: string | null,
): Promise<boolean> {
  try {
    const now = pgNow();
    const res = await db
      .prepare("INSERT OR IGNORE INTO push_idempotency (key, family_id, action, first_sent_at, created_at) VALUES (?,?,?,?,?)")
      .bind(key, familyId, action, now, now)
      .run();
    return Number(res.meta?.changes ?? 0) === 0;
  } catch (e) {
    // PK 충돌/일시 오류에서 "계속 발송"하면 같은 FCM 이 중복으로 울린다.
    // 알림 유실보다 중복 발사가 더 자주 체감되는 경로라, claim 실패는 중복으로 간주한다.
    console.warn("push_idempotency claim failed (suppressing duplicate-prone push):");
    return true;
  }
}

const PARENT_RECIPIENT_DELIVERY_CLAIM_LEASE_MS = 60_000;
type ParentRecipientDeliveryClaim =
  | { status: "acquired"; leaseCreatedAt: string }
  | { status: "completed" }
  | { status: "in_flight" };

async function claimParentRecipientDelivery(
  db: D1Database,
  key: string,
  action: string,
  familyId: string,
): Promise<ParentRecipientDeliveryClaim> {
  const now = pgNow();
  const inserted = await db
    .prepare(
      "INSERT OR IGNORE INTO push_idempotency (key, family_id, action, first_sent_at, created_at) VALUES (?,?,?,NULL,?)",
    )
    .bind(key, familyId, action, now)
    .run();
  if (Number(inserted.meta?.changes ?? 0) > 0) return { status: "acquired", leaseCreatedAt: now };

  const existing = await db
    .prepare("SELECT first_sent_at FROM push_idempotency WHERE key = ? AND family_id = ? AND action = ? LIMIT 1")
    .bind(key, familyId, action)
    .first<{ first_sent_at: string | null }>();
  if (existing?.first_sent_at) return { status: "completed" };

  const reclaimed = await db
    .prepare(
      `UPDATE push_idempotency
          SET created_at = ?
        WHERE key = ? AND family_id = ? AND action = ?
          AND first_sent_at IS NULL AND created_at < ?`,
    )
    .bind(
      now,
      key,
      familyId,
      action,
      pgFromMs(Date.now() - PARENT_RECIPIENT_DELIVERY_CLAIM_LEASE_MS),
    )
    .run();
  return Number(reclaimed.meta?.changes ?? 0) > 0
    ? { status: "acquired", leaseCreatedAt: now }
    : { status: "in_flight" };
}

async function markParentRecipientDeliveryComplete(
  db: D1Database,
  key: string,
  action: string,
  familyId: string,
  leaseCreatedAt: string,
): Promise<boolean> {
  const now = pgNow();
  const result = await db
    .prepare(
      `UPDATE push_idempotency
          SET first_sent_at=?, created_at=?
        WHERE key=? AND family_id=? AND action=?
          AND first_sent_at IS NULL AND created_at=?`,
    )
    .bind(now, now, key, familyId, action, leaseCreatedAt)
    .run();
  return Number(result.meta?.changes ?? 0) > 0;
}

async function releaseParentRecipientDelivery(
  db: D1Database,
  key: string,
  action: string,
  familyId: string,
  leaseCreatedAt: string,
): Promise<boolean> {
  const result = await db
    .prepare(
      `DELETE FROM push_idempotency
        WHERE key=? AND family_id=? AND action=?
          AND first_sent_at IS NULL AND created_at=?`,
    )
    .bind(key, familyId, action, leaseCreatedAt)
    .run();
  return Number(result.meta?.changes ?? 0) > 0;
}

async function claimGenericDelivery(
  db: D1Database,
  key: string,
  action: string,
  familyId: string,
): Promise<ParentRecipientDeliveryClaim> {
  return claimParentRecipientDelivery(db, key, action, familyId);
}

async function markGenericDeliveryComplete(
  db: D1Database,
  key: string,
  action: string,
  familyId: string,
  leaseCreatedAt: string,
): Promise<boolean> {
  return markParentRecipientDeliveryComplete(db, key, action, familyId, leaseCreatedAt);
}

async function releaseGenericDelivery(
  db: D1Database,
  key: string,
  action: string,
  familyId: string,
  leaseCreatedAt: string,
): Promise<boolean> {
  return releaseParentRecipientDelivery(db, key, action, familyId, leaseCreatedAt);
}

function genericRecipientDeliveryKey(familyId: string, pushId: string, recipientUserId: string): string {
  return `${familyId}:${pushId}:recipient:${recipientUserId}`;
}

const SCHEDULE_QUIET_SUPPRESSION_ACTION = "schedule_quiet_suppression";

interface ScheduleQuietSuppressionScope {
  familyId: string;
  eventId: string;
  dateKey: string;
  revision: string;
  windowKey: string;
}

export function scheduleQuietSuppressionKey(
  scope: ScheduleQuietSuppressionScope,
  recipientUserId: string,
): string {
  return `quiet:schedule:v1:${JSON.stringify([
    scope.familyId,
    scope.eventId,
    scope.dateKey,
    scope.revision,
    scope.windowKey,
    recipientUserId,
  ])}`;
}

async function loadScheduleQuietSuppressionRecipients(
  db: D1Database,
  scope: ScheduleQuietSuppressionScope,
  recipientUserIds: Iterable<string>,
): Promise<Set<string>> {
  const userIds = [...new Set(recipientUserIds)];
  if (userIds.length === 0) return new Set();
  const userIdByKey = new Map(
    userIds.map((userId) => [scheduleQuietSuppressionKey(scope, userId), userId]),
  );
  const keys = [...userIdByKey.keys()];
  const markers = keys.map(() => "?").join(",");
  const { results } = await db
    .prepare(
      `SELECT key FROM push_idempotency
        WHERE action=? AND family_id=? AND first_sent_at IS NOT NULL
          AND key IN (${markers})`,
    )
    .bind(SCHEDULE_QUIET_SUPPRESSION_ACTION, scope.familyId, ...keys)
    .all<{ key: string }>();
  return new Set(
    (results ?? [])
      .map((row) => userIdByKey.get(String(row.key)))
      .filter((userId): userId is string => typeof userId === "string"),
  );
}

async function recordScheduleQuietSuppressions(
  db: D1Database,
  scope: ScheduleQuietSuppressionScope,
  recipientUserIds: Iterable<string>,
): Promise<void> {
  const userIds = [...new Set(recipientUserIds)];
  if (userIds.length === 0) return;
  const now = pgNow();
  const values = userIds.map(() => "(?,?,?,?,?)").join(",");
  const bindings = userIds.flatMap((userId) => [
    scheduleQuietSuppressionKey(scope, userId),
    scope.familyId,
    SCHEDULE_QUIET_SUPPRESSION_ACTION,
    now,
    now,
  ]);
  await db
    .prepare(
      `INSERT OR IGNORE INTO push_idempotency
         (key, family_id, action, first_sent_at, created_at)
       VALUES ${values}`,
    )
    .bind(...bindings)
    .run();
  const persisted = await loadScheduleQuietSuppressionRecipients(db, scope, userIds);
  if (persisted.size !== userIds.length) {
    throw new Error("schedule_quiet_suppression_receipt_incomplete");
  }
}

// 외부 전송이 성공한 뒤에만 push_sent 완료 기록을 남긴다. 동시 실행 억제는
// push_idempotency의 만료 가능한 lease가 담당하므로 Worker 중단이 영구 누락을 만들지 않는다.
async function recordPushSentComplete(db: D1Database, eventId: string, notifKey: string): Promise<boolean> {
  try {
    const result = await db
      .prepare("INSERT OR IGNORE INTO push_sent (id, event_id, notif_key, sent_at) VALUES (?,?,?,?)")
      .bind(crypto.randomUUID(), eventId, notifKey, pgNow())
      .run();
    if (Number(result.meta?.changes ?? 0) > 0) return true;
    const existing = await db
      .prepare("SELECT id FROM push_sent WHERE event_id = ? AND notif_key = ? LIMIT 1")
      .bind(eventId, notifKey)
      .first<{ id: string }>();
    return !!existing?.id;
  } catch (e) {
    console.error("push_sent completion failed:");
    return false;
  }
}

// ── teacher_batch (P5) — cron 자가호출(service_role) 전용 ─────────────────────
export async function handleTeacherBatch(env: PushEnv, db: D1Database, body: Record<string, any>, callerRole: string): Promise<Response> {
  if (callerRole !== "service_role") return jsonResponse({ error: "teacher_batch_requires_service_role" }, 403);

  const teacherId = typeof body.teacherId === "string" ? body.teacherId : "";
  if (!teacherId) return jsonResponse({ error: "missing_teacherId" }, 400);

  const idempotencyKey = typeof body.idempotency_key === "string" ? body.idempotency_key : null;
  if (idempotencyKey) {
    if (await claimIdempotencyKey(db, idempotencyKey, "teacher_batch", null)) {
      return jsonResponse({ duplicate: true, key: idempotencyKey }, 200);
    }
  }

  const tp = await db
    .prepare("SELECT user_id FROM teacher_profiles WHERE id = ? LIMIT 1")
    .bind(teacherId)
    .first<{ user_id: string }>();
  if (!tp?.user_id) return jsonResponse({ error: "teacher_not_found" }, 404);
  const teacherUserId = String(tp.user_id);

  const tokens = await fetchFcmTokensForUsers(db, [teacherUserId]);
  if (!tokens.length) return jsonResponse({ sent: 0, reason: "no_tokens" }, 200);

  const title = typeof body.title === "string" && body.title.trim() ? body.title : "오늘 반 알림";
  const message = typeof body.message === "string" ? body.message : "";
  const pushId = idempotencyKey || crypto.randomUUID();
  const data: Record<string, string> = { type: "teacher_batch", batchType: String(body.batchType || ""), pushId };

  let sent = 0;
  const expiredIds: string[] = [];
  for (const t of tokens) {
    const result = await sendFcmNotification(env, t.fcm_token, title, message, data);
    if (result === "sent") sent++;
    else if (result === "expired") expiredIds.push(t.id);
  }
  await disableFcmTokensByIds(db, expiredIds);
  return jsonResponse({ sent, tokens: tokens.length });
}

// ── teacher_notice (P6) — 작성 선생님 publish 직후 자가호출 ───────────────────
export async function handleTeacherNotice(
  env: PushEnv,
  db: D1Database,
  body: Record<string, any>,
  callerUserId: string,
  callerRole: string,
): Promise<Response> {
  const noticeId = typeof body.notice_id === "string" ? body.notice_id : "";
  if (!noticeId) return jsonResponse({ error: "missing_notice_id" }, 400);

  const notice = await db
    .prepare("SELECT id, title, has_schedule, teacher_id, class_id FROM teacher_notices WHERE id = ? LIMIT 1")
    .bind(noticeId)
    .first<Record<string, any>>();
  if (!notice) return jsonResponse({ error: "notice_not_found" }, 404);

  const teacherRow = await db
    .prepare("SELECT user_id, display_name FROM teacher_profiles WHERE id = ? LIMIT 1")
    .bind(String(notice.teacher_id))
    .first<{ user_id: string; display_name: string }>();
  if (!teacherRow) return jsonResponse({ error: "teacher_lookup_failed" }, 500);
  if (callerRole !== "service_role" && String(teacherRow.user_id) !== callerUserId) {
    return jsonResponse({ error: "not_notice_owner" }, 403);
  }

  const className = await db
    .prepare("SELECT class_name FROM teacher_classes WHERE id = ? LIMIT 1")
    .bind(String(notice.class_id))
    .first<{ class_name: string }>();

  const { results: recipients } = await db
    .prepare("SELECT child_member_id, family_id FROM teacher_notice_recipients WHERE notice_id = ?")
    .bind(noticeId)
    .all<{ child_member_id: string; family_id: string }>();
  const recipientRows = recipients ?? [];
  if (recipientRows.length === 0) return jsonResponse({ sent: 0, alerts: 0, reason: "no_recipients" }, 200);

  let audience;
  try {
    audience = await loadTeacherNoticeAudience(
      db,
      recipientRows.map((recipient) => ({
        familyId: String(recipient.family_id),
        childMemberId: String(recipient.child_member_id),
      })),
    );
  } catch (error) {
    console.error("push-notify teacher-notice audience lookup failed:");
    return jsonResponse({ error: "teacher_notice_audience_unavailable" }, 503);
  }
  const targetUserIds = audience.map((member) => member.userId);
  const childUserByFamily = new Map<string, string>();
  for (const member of audience) {
    if (member.role === "child" && !childUserByFamily.has(member.familyId)) {
      childUserByFamily.set(member.familyId, member.userId);
    }
  }

  let quietPartition: QuietHoursRecipientPartition;
  try {
    quietPartition = await partitionNotificationRecipients(db, {
      userIds: targetUserIds,
      identity: { action: "teacher_notice" },
      atMs: Date.now(),
    });
  } catch (error) {
    console.error("push-notify teacher-notice quiet-hours routing failed:");
    return jsonResponse({ error: "quiet_hours_routing_failed" }, 503);
  }
  const allowedTargetUserIds = [...quietPartition.allowed];
  const allowedTargetUserIdSet = new Set(allowedTargetUserIds);
  const allowedParentFamilyIds = new Set(
    audience
      .filter((member) => (
        member.role === "parent"
        && allowedTargetUserIdSet.has(member.userId)
      ))
      .map((member) => member.familyId),
  );
  const suppressedQuietHours = [...quietPartition.suppressed].sort();
  let terminalClaim;
  try {
    terminalClaim = await claimTeacherNoticeTerminalSuppression(db, noticeId);
  } catch (error) {
    console.error("push-notify teacher-notice terminal claim failed:");
    return jsonResponse({ error: "teacher_notice_terminal_claim_failed" }, 503);
  }
  if (terminalClaim === "duplicate") {
    return jsonResponse({ duplicate: true, key: noticeId, suppressedQuietHours }, 200);
  }
  if (allowedTargetUserIds.length === 0 && suppressedQuietHours.length > 0) {
    return jsonResponse({
      sent: 0,
      alerts: 0,
      tokens: 0,
      webSent: 0,
      fcmSent: 0,
      total: 0,
      suppressedQuietHours,
    });
  }

  const teacherName = String(teacherRow.display_name || "선생님");
  const classLabel = String(className?.class_name || "");
  const alertTitle = `📒 알림장: ${String(notice.title)}`;
  const alertMessage = `${teacherName} 선생님${classLabel ? `(${classLabel})` : ""}이 알림장을 보냈어요.${toBool(notice.has_schedule) ? " 일정이 가족 달력에 자동 등록됐어요." : ""}`;

  let alerts = 0;
  for (const familyId of allowedParentFamilyIds) {
    const id = await insertParentAlertV2(env, db, {
      familyId,
      alertType: "teacher_notice",
      title: alertTitle,
      message: alertMessage,
      severity: "info",
      eventId: `teacher-notice:${noticeId}:${familyId}`,
      childUserId: childUserByFamily.get(familyId) ?? null,
    });
    if (id) alerts++;
  }

  const tokens = await fetchFcmTokensForUsers(db, allowedTargetUserIds);
  let sent = 0;
  const expiredIds: string[] = [];
  for (const t of tokens) {
    const result = await sendFcmNotification(env, t.fcm_token, alertTitle, alertMessage, {
      type: "teacher_notice",
      pushId: `teacher-notice:${noticeId}`,
    });
    if (result === "sent") sent++;
    else if (result === "expired") expiredIds.push(t.id);
  }
  await disableFcmTokensByIds(db, expiredIds);
  return jsonResponse({
    sent,
    alerts,
    tokens: tokens.length,
    webSent: 0,
    fcmSent: sent,
    total: allowedTargetUserIds.length,
    suppressedQuietHours,
  });
}

// ── force_ring (부모→아이 응급 알람) ─────────────────────────────────────────
async function handleForceRing(env: PushEnv, db: D1Database, body: Record<string, any>, callerUserId: string): Promise<Response> {
  const familyId = body.family_id as string | undefined;
  if (!familyId) return jsonResponse({ error: "missing_family_id" }, 400);

  const membership = await db
    .prepare(
      `SELECT fm.role AS role, fm.name AS name, f.parent_id AS parent_id
         FROM family_members fm JOIN families f ON f.id = fm.family_id
        WHERE fm.user_id = ? AND fm.family_id = ? LIMIT 1`,
    )
    .bind(callerUserId, familyId)
    .first<{ role: string; name: string; parent_id: string | null }>();
  if (!membership || membership.role !== "parent") {
    return jsonResponse({ error: "force_ring_requires_parent" }, 403);
  }
  if (membership.parent_id !== callerUserId) {
    return jsonResponse({ error: "primary_parent_required" }, 403);
  }

  // client_request_hash dedup(race 1차 방어).
  const clientHash = (body.client_request_hash as string) || null;
  if (clientHash) {
    const existing = await db
      .prepare("SELECT id, delivered_at FROM force_ring_events WHERE client_request_hash = ? LIMIT 1")
      .bind(clientHash)
      .first<{ id: string; delivered_at: string | null }>();
    if (existing) {
      return jsonResponse({ event_id: existing.id, delivered: !!existing.delivered_at, deduplicated: true });
    }
  }

  // target child 결정 — target_user_id 우선(동일 family child 검증), 없으면 최초 가입 child.
  const requestedTargetUserId = (body.target_user_id as string | undefined) || null;
  let targetUserId: string;
  let childName: string;
  if (requestedTargetUserId) {
    const requestedChild = await db
      .prepare("SELECT user_id, name FROM family_members WHERE family_id = ? AND role = 'child' AND is_active = 1 AND user_id = ? LIMIT 1")
      .bind(familyId, requestedTargetUserId)
      .first<{ user_id: string; name: string }>();
    if (!requestedChild) return jsonResponse({ error: "target_child_not_in_family" }, 404);
    targetUserId = requestedChild.user_id;
    childName = requestedChild.name || "우리 아이";
  } else {
    const child = await db
      .prepare("SELECT user_id, name FROM family_members WHERE family_id = ? AND role = 'child' AND is_active = 1 ORDER BY substr(created_at,1,19) ASC LIMIT 1")
      .bind(familyId)
      .first<{ user_id: string; name: string }>();
    if (!child) return jsonResponse({ error: "no_child_in_family" }, 404);
    targetUserId = child.user_id;
    childName = child.name || "우리 아이";
  }

  const profile = await db
    .prepare("SELECT gender FROM user_profiles WHERE user_id = ? LIMIT 1")
    .bind(callerUserId)
    .first<{ gender: string }>();
  const parentRole = profile?.gender === "mom" ? "엄마" : profile?.gender === "dad" ? "아빠" : "부모님";

  // one-active-per-family(복합 unique 미이관 → select-then-insert 가드).
  // 10분 초과 미정지(zombie) 행은 active 로 안 침 — 좀비 1건이 발사를 영구 차단하던 버그 방지
  // (quota 체크의 zombie 컷과 동일 기준; 최대 울림 60초라 10분이면 확실히 종료 상태).
  const cutZombie = tsNorm(new Date(Date.now() - 10 * 60 * 1000).toISOString());
  const active = await db
    .prepare(
      "SELECT id FROM force_ring_events WHERE family_id = ? AND stopped_at IS NULL AND substr(triggered_at,1,19) > ? LIMIT 1",
    )
    .bind(familyId, cutZombie)
    .first<{ id: string }>();
  if (active) {
    return jsonResponse({ error: "force_ring_already_active", active_event_id: active.id }, 423);
  }

  const message = ((body.message as string) || "").slice(0, 80);
  const eventId = crypto.randomUUID();
  let quotaClaim: Awaited<ReturnType<typeof claimForceRingQuotaLease>>;
  try {
    quotaClaim = await claimForceRingQuotaLease(db, {
      familyId,
      requestId: clientHash || eventId,
    });
  } catch (error) {
    console.error("force-ring quota claim failed:");
    return jsonResponse({ error: "feature_usage_unavailable" }, 503);
  }
  if (quotaClaim.status === "exhausted") {
    return jsonResponse({
      error: "force_ring_quota_exceeded",
      quota: quotaClaim.quota,
      used: quotaClaim.used,
      tier: quotaClaim.tier,
    }, 429);
  }
  if (quotaClaim.status === "duplicate") {
    return jsonResponse({ error: "force_ring_delivery_in_flight" }, 503);
  }

  try {
    await db
      .prepare(
        `INSERT INTO force_ring_events (id, family_id, initiator_user_id, target_user_id, message, client_request_hash, triggered_at, delivery_status, created_at)
         VALUES (?,?,?,?,?,?,?,?,?)`,
      )
      .bind(eventId, familyId, callerUserId, targetUserId, message || null, clientHash, pgNow(), "{}", pgNow())
      .run();
  } catch (e) {
    try {
      await releaseFeatureUsageClaim(db, quotaClaim.claimKey);
    } catch (releaseError) {
      console.error("force-ring quota lease release failed after insert failure:");
    }
    console.error("force-ring event insert failed:");
    return jsonResponse({ error: "insert_failed" }, 500);
  }
  // 이벤트 행이 rolling 24시간 사용량의 정본을 이어받았으므로 provisional lease만 제거한다.
  // 제거 실패는 2분 동안 보수적으로 이중 계산될 뿐 추가 발사를 허용하지 않는다.
  try {
    await releaseFeatureUsageClaim(db, quotaClaim.claimKey);
  } catch (error) {
    console.error("force-ring quota lease release failed after event insert:");
  }

  const { results: tokens } = await db
    .prepare("SELECT fcm_token, platform FROM fcm_tokens WHERE user_id = ? AND platform = 'android' AND disabled_at IS NULL")
    .bind(targetUserId)
    .all<{ fcm_token: string; platform: string }>();

  if (!tokens || tokens.length === 0) {
    const stoppedAt = pgNow();
    await db
      .prepare("UPDATE force_ring_events SET stopped_at = ?, stop_reason = 'delivery_failed', delivery_status = ? WHERE id = ?")
      .bind(stoppedAt, JSON.stringify({ reason: "no_fcm_tokens" }), eventId)
      .run();
    // 부모 UI(전달 실패) 실시간 반영.
    await notifyPg(env, familyId, "force_ring_events", "UPDATE", {
      id: eventId, family_id: familyId, stopped_at: stoppedAt, stop_reason: "delivery_failed",
    });
    return jsonResponse({ event_id: eventId, delivered: false, error: "no_fcm_tokens" });
  }

  const initiatorName = membership.name || "부모님";
  const fcmPayload = {
    data: {
      action: "force_ring",
      event_id: eventId,
      familyId,
      targetUserId,
      targetRole: "child",
      message,
      initiator_name: initiatorName,
      parent_role: parentRole,
      child_name: childName,
    } as Record<string, string>,
    android: { ttl: "600s" },
  };

  const fcmResults = await Promise.all(tokens.map((t) => sendFcmDataOnly(env, t.fcm_token, fcmPayload)));
  const anySuccess = fcmResults.some((r) => r.success);

  if (anySuccess) {
    const deliveredAt = pgNow();
    await db
      .prepare("UPDATE force_ring_events SET delivered_at = ?, delivery_status = ? WHERE id = ?")
      .bind(deliveredAt, JSON.stringify({ fcm: fcmResults }), eventId)
      .run();
    // 부모 UI(전달됨 · 응답 대기) 실시간 반영.
    await notifyPg(env, familyId, "force_ring_events", "UPDATE", {
      id: eventId, family_id: familyId, delivered_at: deliveredAt,
    });
  } else {
    const stoppedAt = pgNow();
    await db
      .prepare("UPDATE force_ring_events SET stopped_at = ?, stop_reason = 'delivery_failed', delivery_status = ? WHERE id = ?")
      .bind(stoppedAt, JSON.stringify({ fcm: fcmResults }), eventId)
      .run();
    // 부모 UI(전달 실패) 실시간 반영.
    await notifyPg(env, familyId, "force_ring_events", "UPDATE", {
      id: eventId, family_id: familyId, stopped_at: stoppedAt, stop_reason: "delivery_failed",
    });
  }

  return jsonResponse({
    event_id: eventId,
    delivered: anySuccess,
    quota_remaining: Math.max(0, quotaClaim.quota - quotaClaim.used - (anySuccess ? 1 : 0)),
  });
}

// ── force_ring_stop — 부모 직접 정지 ─────────────────────────────────────────
async function handleForceRingStop(env: PushEnv, db: D1Database, body: Record<string, any>, callerUserId: string): Promise<Response> {
  const eventId = body.event_id as string | undefined;
  if (!eventId) return jsonResponse({ error: "missing_event_id" }, 400);

  const event = await db
    .prepare("SELECT id, initiator_user_id, target_user_id, family_id, stopped_at FROM force_ring_events WHERE id = ? LIMIT 1")
    .bind(eventId)
    .first<Record<string, any>>();
  if (!event) return jsonResponse({ error: "event_not_found" }, 404);
  if (event.initiator_user_id !== callerUserId) return jsonResponse({ error: "not_initiator" }, 403);
  if (event.stopped_at) return jsonResponse({ stopped: true, already: true });

  const stoppedAt = pgNow();
  try {
    await db
      .prepare("UPDATE force_ring_events SET stopped_at = ?, stop_reason = 'parent_stop' WHERE id = ? AND stopped_at IS NULL")
      .bind(stoppedAt, eventId)
      .run();
  } catch (e) {
    return jsonResponse({ error: "update_failed" }, 500);
  }
  // 부모 UI(알람 정지됨) 실시간 반영 — 다른 부모 기기 동기화.
  await notifyPg(env, String(event.family_id), "force_ring_events", "UPDATE", {
    id: eventId, family_id: event.family_id, stopped_at: stoppedAt, stop_reason: "parent_stop",
  });

  const { results: tokens } = await db
    .prepare("SELECT fcm_token FROM fcm_tokens WHERE user_id = ? AND platform = 'android' AND disabled_at IS NULL")
    .bind(String(event.target_user_id))
    .all<{ fcm_token: string }>();
  if (tokens?.length) {
    await Promise.all(
      tokens.map((t) =>
        sendFcmDataOnly(env, t.fcm_token, {
          data: {
            action: "force_ring_stop",
            event_id: eventId,
            eventId,
            familyId: String(event.family_id),
            targetUserId: String(event.target_user_id),
            targetRole: "child",
          },
          android: { ttl: "60s" },
        }),
      ),
    );
  }

  return jsonResponse({ stopped: true });
}

// ── force_ring_reminder — cron 1분 단위 5분-경과 알림 ─────────────────────────
export async function handleForceRingReminder(env: PushEnv, db: D1Database, callerRole: string): Promise<Response> {
  if (callerRole !== "service_role") return jsonResponse({ error: "service_role_required" }, 401);

  const fiveMinAgo = tsNorm(new Date(Date.now() - 5 * 60 * 1000).toISOString());
  const fifteenMinAgo = tsNorm(new Date(Date.now() - 15 * 60 * 1000).toISOString());

  const { results: candidates } = await db
    .prepare(
      `SELECT id, family_id, initiator_user_id, target_user_id FROM force_ring_events
        WHERE delivered_at IS NOT NULL
          AND acknowledged_at IS NULL
          AND stopped_at IS NULL
          AND reminder_sent_at IS NULL
          AND substr(triggered_at,1,19) < ?
          AND substr(triggered_at,1,19) > ?
        LIMIT 50`,
    )
    .bind(fiveMinAgo, fifteenMinAgo)
    .all<Record<string, any>>();
  if (!candidates?.length) return jsonResponse({ reminded_count: 0 });

  const webConfigured = isWebPushConfigured(env);
  let remindedCount = 0;
  for (const event of candidates) {
    const initiatorId = String(event.initiator_user_id);
    const targetUserId = String(event.target_user_id);
    const familyId = String(event.family_id);
    const eventId = String(event.id);

    const reminderMutationLeases = await acquireAccountMutationLeases(db, [
      { userId: initiatorId, familyId },
      { userId: targetUserId, familyId },
    ]);
    if (reminderMutationLeases.status !== "acquired") continue;
    try {
    if (!(await isActiveChildMutationTarget(db, familyId, targetUserId))) continue;

    const { results: tokens } = await db
      .prepare("SELECT fcm_token, platform FROM fcm_tokens WHERE user_id = ? AND disabled_at IS NULL")
      .bind(initiatorId)
      .all<{ fcm_token: string; platform: string }>();
    const { results: webSubs } = await db
      .prepare("SELECT id, subscription FROM push_subscriptions WHERE user_id = ? AND disabled_at IS NULL")
      .bind(initiatorId)
      .all<{ id: string; subscription: string }>();

    const reminderTitle = "응급 신호 5분 경과";
    const reminderBody = "아이 응답이 없습니다. 직접 통화나 119를 고려하세요";
    const reminderData = {
      action: "force_ring_reminder",
      event_id: eventId,
      familyId,
      targetUserId: initiatorId,
      targetRole: "parent",
    };
    const webPayload = { title: reminderTitle, body: reminderBody, icon: "/icon.png", badge: "/icon.png", data: reminderData };

    if (tokens?.length) {
      await Promise.all(
        tokens.filter((t) => t.platform === "android").map((t) => sendFcmNotification(env, t.fcm_token, reminderTitle, reminderBody, reminderData)),
      );
    }
    if (webConfigured && webSubs?.length) {
      const reminderPayload = JSON.stringify(webPayload);
      const outcomes = await Promise.all(
        webSubs.map((sub) =>
          sendWebPushWithRetry(env, parseJson(sub.subscription), reminderPayload).then((outcome) => ({ outcome, id: sub.id })),
        ),
      );
      const expiredSubIds = outcomes.filter(({ outcome }) => outcome === "expired").map(({ id }) => id);
      await disablePushSubsByIds(db, expiredSubIds);
    }

    await db.prepare("UPDATE force_ring_events SET reminder_sent_at = ? WHERE id = ?").bind(pgNow(), eventId).run();
    remindedCount++;
    } finally {
      await releaseAccountMutationLeases(db, reminderMutationLeases.leases);
    }
  }

  return jsonResponse({ reminded_count: remindedCount });
}

// ── remote_listen entitlement gate ──────────────────────────────────────────
export async function validateRemoteListenEntitlement(db: D1Database, familyId: string): Promise<Response | null> {
  try {
    const entitlement = await resolveFamilyEntitlement(db, familyId);
    if (!entitlement.isPremium) {
      return jsonResponse({ error: "remote_listen_requires_premium" }, 402);
    }
    // 원본: remote_listen_enabled === false 일 때만 차단(null/미설정은 허용). D1 0 = false.
    if (!entitlement.remoteListenEnabled) {
      return jsonResponse({ error: "remote_listen_disabled_by_family" }, 403);
    }
    return null;
  } catch (error) {
    console.warn("[push-notify] remote listen entitlement failed:");
    return jsonResponse({ error: "family_entitlement_unavailable" }, 503);
  }
}

// ── instant notification ─────────────────────────────────────────────────────
interface MemoDeliveryContext {
  recipientUserIds: Set<string>;
  targetChildUserId: string;
  signal: AbortSignal;
}

interface QuietHoursRecipientPartition {
  allowed: Set<string>;
  suppressed: Set<string>;
}

interface InstantNotificationOptions {
  atMs?: number;
  quietHoursPartition?: QuietHoursRecipientPartition;
}

type RawMemoRecipientsResult =
  | { status: "ok"; recipientUserIds: string[] }
  | { status: "invalid_sender" }
  | { status: "invalid_target" };

async function loadRawMemoRecipientIds(
  db: D1Database,
  familyId: string,
  senderUserId: string,
  targetChildUserId: string,
): Promise<RawMemoRecipientsResult> {
  const senderMembership = await resolveVerifiedFamilyMembership(db, senderUserId, familyId);
  if (!senderMembership) return { status: "invalid_sender" };
  if (senderMembership.role === "child" && senderUserId !== targetChildUserId) {
    return { status: "invalid_target" };
  }
  const child = await db
    .prepare(
      `SELECT user_id FROM family_members
        WHERE family_id=? AND user_id=? AND role='child' AND is_active=1
        LIMIT 1`,
    )
    .bind(familyId, targetChildUserId)
    .first<{ user_id: string }>();
  if (!child?.user_id) return { status: "invalid_target" };
  const { results } = await db
    .prepare(
      `SELECT user_id FROM family_members
        WHERE family_id=?1 AND role='parent' AND is_active=1 AND user_id IS NOT NULL
       UNION
       SELECT parent_id AS user_id FROM families WHERE id=?1`,
    )
    .bind(familyId)
    .all<{ user_id: string | null }>();
  const recipientUserIds = new Set<string>([child.user_id]);
  for (const row of results ?? []) {
    if (row.user_id) recipientUserIds.add(row.user_id);
  }
  recipientUserIds.delete(senderUserId);
  return { status: "ok", recipientUserIds: [...recipientUserIds].sort() };
}

async function handleNotificationQuietHoursUpdatedCommand(
  env: PushEnv,
  db: D1Database,
  body: Record<string, any>,
  callerUserId: string,
  callerRole: string,
): Promise<Response> {
  const familyId = toStringValue(body.familyId);
  const targetUserId = toStringValue(body.targetUserId);
  const updatedAt = toStringValue(body.updatedAt);
  const enabled = body.enabled;
  const startMinute = body.startMinute;
  const endMinute = body.endMinute;
  if (!familyId || !targetUserId) {
    return jsonResponse({ error: "quiet_hours_command_target_required" }, 400);
  }
  if (
    typeof enabled !== "boolean"
    || !Number.isInteger(startMinute)
    || startMinute < 0
    || startMinute > 1439
    || !Number.isInteger(endMinute)
    || endMinute < 0
    || endMinute > 1439
    || startMinute === endMinute
    || !updatedAt
  ) {
    return jsonResponse({ error: "invalid_quiet_hours_command" }, 400);
  }

  if (callerRole !== "service_role") {
    const caller = await resolveVerifiedFamilyMembership(db, callerUserId, familyId);
    if (!caller || caller.role !== "parent") {
      return jsonResponse({ error: "quiet_hours_command_forbidden" }, 403);
    }
  }
  const target = await resolveVerifiedFamilyMembership(db, targetUserId, familyId);
  if (!target) {
    return jsonResponse({ error: "quiet_hours_command_target_not_found" }, 403);
  }

  const { results } = await db
    .prepare(
      `SELECT fcm_token
         FROM fcm_tokens WHERE disabled_at IS NULL
          AND family_id = ?
          AND user_id = ?
      `,
    )
    .bind(familyId, targetUserId)
    .all<{ fcm_token: string }>();
  const tokens = [...new Set(
    (results ?? []).map((row) => String(row.fcm_token ?? "").trim()).filter(Boolean),
  )];
  const payload = {
    action: "notification_quiet_hours_updated",
    type: "notification_quiet_hours_updated",
    familyId,
    targetUserId,
    enabled: enabled ? "true" : "false",
    startMinute: String(startMinute),
    endMinute: String(endMinute),
    timeZoneId: "Asia/Seoul",
    updatedAt,
  };

  let fcmSent = 0;
  let failed = 0;
  for (const token of tokens) {
    const result = await sendFcmDataOnly(env, token, {
      data: payload,
      android: { ttl: "120s" },
    });
    if (result.success) fcmSent++;
    else failed++;
  }
  if (failed > 0) {
    return jsonResponse({ error: "quiet_hours_command_delivery_failed", fcmSent, total: tokens.length }, 503);
  }
  return jsonResponse({ fcmSent, total: tokens.length });
}

/**
 * 모든 new_memo 진입점(outbox, 검증된 legacy, service-role)을 이 단일 경계로
 * 통과시킨다. 차단 상태 재조회부터 pending/외부 전송 완료까지 pair lease를 유지해
 * 차단 완료 뒤 알림이 도착하는 TOCTOU를 닫는다.
 */
export async function handleInstantNotification(
  env: PushEnv,
  db: D1Database,
  body: Record<string, any>,
  callerUserId: string,
  callerRole: string,
  headerIdemKey: string | null,
  options?: InstantNotificationOptions,
): Promise<Response> {
  if (body.action === "notification_quiet_hours_updated") {
    return handleNotificationQuietHoursUpdatedCommand(
      env,
      db,
      body,
      callerUserId,
      callerRole,
    );
  }
  if (body.action !== "new_memo") {
    return handleInstantNotificationCore(
      env,
      db,
      body,
      callerUserId,
      callerRole,
      headerIdemKey,
      undefined,
      options,
    );
  }
  const familyId = toStringValue(body.familyId);
  const senderUserId = callerRole === "service_role"
    ? (toStringValue(body.senderUserId) || toStringValue(callerUserId))
    : toStringValue(callerUserId);
  const targetChildUserId = toStringValue(body.targetChildUserId);
  if (!familyId) return jsonResponse({ error: "familyId required" }, 400);
  if (!senderUserId) return jsonResponse({ error: "invalid_memo_sender" }, 403);
  if (!targetChildUserId) return jsonResponse({ error: "memo_target_required" }, 400);

  try {
    const rawRecipients = await loadRawMemoRecipientIds(db, familyId, senderUserId, targetChildUserId);
    if (rawRecipients.status === "invalid_sender") {
      return jsonResponse({ error: "invalid_memo_sender" }, 403);
    }
    if (rawRecipients.status === "invalid_target") {
      return jsonResponse({ error: "invalid_memo_target" }, 403);
    }
    const leaseResult = await acquireMemoInteractionLeases(db, {
      familyId,
      senderUserId,
      recipientUserIds: rawRecipients.recipientUserIds,
    });
    if (leaseResult.status !== "acquired") {
      return jsonResponse(
        { error: leaseResult.status === "busy" ? "memo_interaction_busy" : "memo_interaction_unavailable" },
        503,
      );
    }

    const abortController = new AbortController();
    const deadlineTimer = setTimeout(
      () => abortController.abort("memo_delivery_deadline"),
      MEMO_DELIVERY_NETWORK_DEADLINE_MS,
    );
    try {
      // lease 획득 뒤 membership과 차단을 다시 읽는다. 새 공동부모는 다음 outbox
      // 재시도에서 포함하고, 이번에 lease를 잡지 않은 수신자에게는 보내지 않는다.
      const refreshed = await loadRawMemoRecipientIds(db, familyId, senderUserId, targetChildUserId);
      if (refreshed.status !== "ok") {
        return jsonResponse({ error: "memo_routing_changed" }, 409);
      }
      const stillActive = new Set(refreshed.recipientUserIds);
      const leasedCandidates = rawRecipients.recipientUserIds.filter((userId) => stillActive.has(userId));
      const unblockedRecipientIds = await loadUnblockedMemoRecipientIds(db, {
        familyId,
        senderUserId,
        recipientUserIds: leasedCandidates,
      });
      if (unblockedRecipientIds.length === 0) {
        return jsonResponse({
          webSent: 0,
          fcmSent: 0,
          total: 0,
          key: headerIdemKey || toStringValue(body.idempotency_key) || null,
          suppressedQuietHours: [],
        });
      }
      return await handleInstantNotificationCore(
        env,
        db,
        body,
        callerUserId,
        callerRole,
        headerIdemKey,
          {
            recipientUserIds: new Set(unblockedRecipientIds),
            targetChildUserId,
            signal: abortController.signal,
          },
          options,
        );
    } finally {
      clearTimeout(deadlineTimer);
      abortController.abort("memo_delivery_finished");
      await releaseMemoInteractionLeases(db, leaseResult.leases);
    }
  } catch (error) {
    console.error("push-notify memo interaction boundary failed:");
    return jsonResponse({ error: "memo_interaction_unavailable" }, 503);
  }
}

async function handleInstantNotificationCore(
  env: PushEnv,
  db: D1Database,
  body: Record<string, any>,
  callerUserId: string,
  callerRole: string,
  headerIdemKey: string | null,
  memoDeliveryContext?: MemoDeliveryContext,
  options?: InstantNotificationOptions,
): Promise<Response> {
  const familyId = body.familyId as string;
  const senderUserId: string = callerRole === "service_role"
    ? ((body.senderUserId as string) || callerUserId)
    : callerUserId;
  const action = body.action as string;
  const title = (body.title as string) || "새 알림";
  const message = (body.message as string) || "";
  const isRemoteListen = action === "remote_listen";
  const isRemoteListenStop = action === "remote_listen_stop";
  const isLocationRefresh = action === "request_location";
  const isDeviceStatusRefresh = action === "request_device_status";
  const isChildSafety = action === "child_safety";
  const isChildNativeCommand = isRemoteListen || isRemoteListenStop || isLocationRefresh || isDeviceStatusRefresh;
  const targetUserId = toStringValue(body.targetUserId) || null;
  let remoteListenRequestId: string | null = null;

  if (!familyId) return jsonResponse({ error: "familyId required" }, 400);

  // sender-family membership (SEC-01) — service_role cron 은 우회. 레거시 가족은
  // 주보호자 family_members 행이 없을 수 있으므로 canonical owner fallback을 공유한다.
  let verifiedCallerRole: "parent" | "child" | null = null;
  if (callerRole !== "service_role") {
    const membership = await resolveVerifiedFamilyMembership(db, callerUserId, familyId);
    if (!membership) return jsonResponse({ error: "not a family member" }, 403);
    verifiedCallerRole = membership.role;
  }

  // co-parent control-action gate.
  if (callerRole !== "service_role") {
    const family = await db
      .prepare("SELECT parent_id FROM families WHERE id = ? LIMIT 1")
      .bind(familyId)
      .first<{ parent_id: string | null }>();
    const callerIsPrimaryParent = verifiedCallerRole === "parent" && family?.parent_id === callerUserId;
    const resolvedCallerRole = verifiedCallerRole || callerRole;
    if (!canCallerSendAction(action, { role: resolvedCallerRole, isPrimaryParent: callerIsPrimaryParent })) {
      return jsonResponse({ error: "primary_parent_required" }, 403);
    }
  }

  if (isRemoteListen || isRemoteListenStop) {
    remoteListenRequestId = toStringValue(body.requestId);
    if (!targetUserId || !remoteListenRequestId) {
      return jsonResponse({ error: "remote_listen_request_required" }, 400);
    }
    if (
      isRemoteListen
      && body.durationSec != null
      && body.durationSec !== REMOTE_LISTEN_DURATION_SEC
    ) {
      return jsonResponse({ error: "invalid_remote_listen_duration" }, 400);
    }
    const authorization = await authorizeRemoteListenCommand(db, {
      action: isRemoteListen ? "remote_listen" : "remote_listen_stop",
      familyId,
      callerUserId,
      targetUserId,
      requestId: remoteListenRequestId,
    });
    if (!authorization.ok) {
      return jsonResponse({ error: authorization.error }, 403);
    }
  }

  if (isRemoteListen) {
    const gate = await validateRemoteListenEntitlement(db, familyId);
    if (gate) return gate;
    // 위급 청취(아이 동의 불요): 명령이 주보호자·프리미엄·킬스위치·세션 검증을 통과한 시각부터
    // 60초 캡처 창을 연다. 아이의 별도 탭/허용 없이 오디오 게이트가 통과하도록 서버가 창을 확정한다.
    if (remoteListenRequestId && targetUserId) {
      await authorizeRemoteListenCaptureWindow(db, {
        requestId: remoteListenRequestId,
        childUserId: targetUserId,
      });
    }
  }

  // ── Idempotency ──
  const bodyKey = typeof body.idempotency_key === "string" ? body.idempotency_key : null;
  const idempotencyKey = (headerIdemKey && headerIdemKey.trim()) || bodyKey;

  const pushId = idempotencyKey || crypto.randomUUID();
  const severity = toStringValue(body.severity);
  const alertType = toStringValue(body.alertType || body.alert_type);
  const urgent = isEmergencyNotificationType(action, { severity, alertType, urgent: body.urgent });
  const quietHoursAtMs = options?.atMs ?? Date.now();
  const suppressedQuietHours = new Set<string>();

  const nativeRecipientIds = await getNativeRecipientIds(db, familyId);
  let childNativeRecipientIds = isChildNativeCommand ? await getFamilyMemberIdsByRole(db, familyId, "child") : null;
  if (childNativeRecipientIds && targetUserId) {
    childNativeRecipientIds = new Set([...childNativeRecipientIds].filter((u) => u === targetUserId));
  }

  let childSafetyRecipientIds: Set<string> | null = null;
  if (isChildSafety) {
    if (!targetUserId) return jsonResponse({ error: "child_safety_target_required" }, 400);
    const activeChildIds = await getFamilyMemberIdsByRole(db, familyId, "child");
    if (!activeChildIds.has(targetUserId)) {
      return jsonResponse({ error: "invalid_child_safety_target" }, 403);
    }
    let quietPartition: QuietHoursRecipientPartition;
    try {
      quietPartition = await partitionNotificationRecipients(db, {
        userIds: [targetUserId],
        identity: { action: "child_safety", alertType },
        atMs: quietHoursAtMs,
      });
    } catch (error) {
      console.error("push-notify child quiet-hours routing failed:");
      return jsonResponse({ error: "quiet_hours_routing_failed" }, 503);
    }
    childSafetyRecipientIds = quietPartition.allowed;
    for (const userId of quietPartition.suppressed) suppressedQuietHours.add(userId);
    if (childSafetyRecipientIds.size === 0 && suppressedQuietHours.size > 0) {
      return jsonResponse({
        webSent: 0,
        fcmSent: 0,
        total: 0,
        key: idempotencyKey || null,
        suppressedQuietHours: [...suppressedQuietHours].sort(),
      });
    }
  }

  const fcmExtraData: Record<string, string> = { pushId, urgent: urgent ? "true" : "false" };
  if (severity) fcmExtraData.severity = severity;
  if (alertType) fcmExtraData.alertType = alertType;
  if (body.eventId != null) fcmExtraData.eventId = String(body.eventId);
  if (body.alertId != null) fcmExtraData.alertId = String(body.alertId);
  if (isChildNativeCommand || isChildSafety) {
    fcmExtraData.targetRole = "child";
    if (remoteListenRequestId) fcmExtraData.requestId = remoteListenRequestId;
    else if (body.requestId != null) fcmExtraData.requestId = String(body.requestId);
    if (body.reason != null) fcmExtraData.reason = String(body.reason);
    if (body.requestedAt != null) fcmExtraData.requestedAt = String(body.requestedAt);
    if (targetUserId) fcmExtraData.targetUserId = targetUserId;
    if (body.requesterUserId != null) fcmExtraData.requesterUserId = String(body.requesterUserId);
  }
  if (typeof body.route === "string" && body.route) fcmExtraData.route = body.route;
  if (isRemoteListen) fcmExtraData.durationSec = String(REMOTE_LISTEN_DURATION_SEC);

  // memo multichild isolation.
  let memoRecipientIds: Set<string> | null = null;
  if (!isChildNativeCommand && action === "new_memo") {
    const targetChildUserId = typeof body.targetChildUserId === "string" && body.targetChildUserId ? body.targetChildUserId : null;
    if (!targetChildUserId) {
      return jsonResponse({ error: "memo_target_required" }, 400);
    }
    try {
      const child = await db
        .prepare(
          `SELECT user_id FROM family_members
            WHERE family_id = ? AND user_id = ? AND role = 'child' AND is_active = 1
            LIMIT 1`,
        )
        .bind(familyId, targetChildUserId)
        .first<{ user_id: string }>();
      if (!child?.user_id) return jsonResponse({ error: "invalid_memo_target" }, 403);

      if (!memoDeliveryContext || memoDeliveryContext.targetChildUserId !== child.user_id) {
        return jsonResponse({ error: "memo_interaction_boundary_required" }, 503);
      }
      memoRecipientIds = new Set(memoDeliveryContext.recipientUserIds);
      fcmExtraData.targetChildUserId = child.user_id;
    } catch (e) {
      console.error("push-notify memo-routing query failed:");
      return jsonResponse({ error: "memo_routing_unavailable" }, 503);
    }
  }

  // 전송 시점의 lease만으로는 push service에 보관된 메모가 차단 완료 뒤 표시되는
  // 것을 막을 수 없다. 각 수신자에 짧은 HMAC permit을 결합하고 표시 직전에 서버가
  // 현재 membership·양방향 차단을 다시 확인한다. 생성 실패는 외부 전송 전에 닫는다.
  const memoDisplayPermits = new Map<string, string>();
  if (action === "new_memo") {
    const targetChildUserId = fcmExtraData.targetChildUserId;
    if (!memoRecipientIds || !targetChildUserId) {
      return jsonResponse({ error: "memo_display_permit_scope_unavailable" }, 503);
    }
    for (const recipientUserId of memoRecipientIds) {
      const permit = await createMemoDisplayPermit(env.PUSH_INTERNAL_SECRET || "", {
        familyId,
        senderUserId,
        recipientUserId,
        pushId,
        targetChildUserId,
      });
      if (!permit) {
        return jsonResponse({ error: "memo_display_permit_unavailable" }, 503);
      }
      memoDisplayPermits.set(recipientUserId, permit);
    }
  }

  // 부모 안전 알림은 네이티브뿐 아니라 웹 구독도 부모에게만 보낸다.
  let parentRecipientIds: Set<string> | null = null;
  let parentRoutingFailed = false;
  if (!isChildNativeCommand && (action === "sos" || action === "emergency" || action === "kkuk" || action === "parent_alert")) {
    try {
      if (options?.quietHoursPartition) {
        parentRecipientIds = new Set(options.quietHoursPartition.allowed);
        for (const userId of options.quietHoursPartition.suppressed) {
          if (userId !== senderUserId) suppressedQuietHours.add(userId);
        }
      } else if (action === "parent_alert") {
        const partition = await loadParentAlertRecipients(
          db,
          familyId,
          alertType,
          quietHoursAtMs,
        );
        parentRecipientIds = partition.allowed;
        for (const userId of partition.suppressed) {
          if (userId !== senderUserId) suppressedQuietHours.add(userId);
        }
      } else {
        const { results: parentMembers } = await db
          .prepare(
            `WITH parent_users AS (
               SELECT user_id FROM family_members
                WHERE family_id = ?1 AND role = 'parent' AND is_active = 1 AND user_id IS NOT NULL
               UNION
               SELECT parent_id AS user_id FROM families WHERE id = ?1
             )
             SELECT pu.user_id AS user_id, 'parent' AS role, f.parent_id AS parent_id
               FROM parent_users pu JOIN families f ON f.id = ?1`,
          )
          .bind(familyId)
          .all<{ user_id: string | null; role: string | null; parent_id: string | null }>();
        const eligibleParentIds = selectParentRecipientsForAction(
          action,
          (parentMembers ?? []).map((row) => ({
            user_id: row.user_id,
            role: row.role,
            is_primary_parent: row.parent_id === row.user_id,
          })),
        );
        const partition = await partitionNotificationRecipients(db, {
          userIds: eligibleParentIds,
          identity: { action, alertType },
          atMs: quietHoursAtMs,
        });
        parentRecipientIds = partition.allowed;
        for (const userId of partition.suppressed) {
          if (userId !== senderUserId) suppressedQuietHours.add(userId);
        }
      }
    } catch (e) {
      console.error("push-notify parent-routing query failed:");
      // 수신자를 확정하지 못하면 자녀에게 누수시키지 않도록 빈 집합으로 닫는다.
      parentRecipientIds = new Set<string>();
      parentRoutingFailed = true;
    }
  }

  if (parentRoutingFailed) {
    return jsonResponse({ error: "parent_routing_failed" }, 503);
  }

  let effectiveParentRecipientIds = parentRecipientIds == null
    ? null
    : new Set([...parentRecipientIds].filter((parentUserId) => parentUserId !== senderUserId));
  if (
    effectiveParentRecipientIds
    && effectiveParentRecipientIds.size === 0
    && suppressedQuietHours.size > 0
  ) {
    return jsonResponse({
      webSent: 0,
      fcmSent: 0,
      total: 0,
      key: idempotencyKey || null,
      suppressedQuietHours: [...suppressedQuietHours].sort(),
    });
  }

  let genericPendingExpiresAt: string | null = null;
  if (typeof body.expiresAt === "string" && body.expiresAt.trim()) {
    genericPendingExpiresAt = body.expiresAt.trim();
  } else if (action === "new_memo") {
    genericPendingExpiresAt = pgFromMs(Date.now() + 2 * 60_000);
  } else if (isRemoteListen) genericPendingExpiresAt = pgFromMs(Date.now() + 5 * 60_000);
  else if (isLocationRefresh || isDeviceStatusRefresh) {
    genericPendingExpiresAt = pgFromMs(Date.now() + 2 * 60_000);
  }
  const parentPendingExpiresAt = effectiveParentRecipientIds
    ? pgFromMs(Date.now() + parentAlertPendingTtlMs(alertType, action))
    : null;
  const webPushExpiresAt = parentPendingExpiresAt ?? genericPendingExpiresAt;
  if (webPushExpiresAt) fcmExtraData.expiresAt = webPushExpiresAt;
  let genericRecipientIds: Array<string | null> = action === "new_memo" && memoRecipientIds
    ? [...memoRecipientIds].filter((recipientUserId) => recipientUserId !== senderUserId)
    : (isChildSafety
      ? (targetUserId ? [targetUserId] : [])
      : (isChildNativeCommand && childNativeRecipientIds
        ? [...childNativeRecipientIds].filter((recipientUserId) => recipientUserId !== senderUserId)
        : [null]));
  const needsFamilyRecipientExpansion = genericRecipientIds.some((recipientUserId) => !recipientUserId);
  if (effectiveParentRecipientIds == null && needsFamilyRecipientExpansion) {
    try {
      genericRecipientIds = await loadActiveFamilyNotificationRecipientIds(db, {
        familyId,
        senderUserId,
      });
    } catch (e) {
      console.error("push-notify active family recipient query failed:");
      return jsonResponse({ error: "recipient_routing_failed" }, 503);
    }
    if (genericRecipientIds.length === 0) {
      return jsonResponse({
        webSent: 0,
        fcmSent: 0,
        total: 0,
        key: idempotencyKey || null,
        suppressedQuietHours: [...suppressedQuietHours].sort(),
      });
    }
  }
  let hadExplicitGenericRecipients = genericRecipientIds.some((recipientUserId) => !!recipientUserId);
  if (effectiveParentRecipientIds == null && !isChildSafety) {
    let quietPartition: QuietHoursRecipientPartition;
    try {
      quietPartition = await partitionNotificationRecipients(db, {
        userIds: genericRecipientIds.filter((recipientUserId): recipientUserId is string => !!recipientUserId),
        identity: { action, alertType },
        atMs: quietHoursAtMs,
      });
    } catch (error) {
      console.error("push-notify quiet-hours routing failed:");
      return jsonResponse({ error: "quiet_hours_routing_failed" }, 503);
    }
    genericRecipientIds = [...quietPartition.allowed];
    hadExplicitGenericRecipients = genericRecipientIds.length > 0;
    for (const userId of quietPartition.suppressed) {
      if (userId !== senderUserId) suppressedQuietHours.add(userId);
      memoDisplayPermits.delete(userId);
    }
    if (action === "new_memo") memoRecipientIds = new Set(quietPartition.allowed);
    if (genericRecipientIds.length === 0 && suppressedQuietHours.size > 0) {
      return jsonResponse({
        webSent: 0,
        fcmSent: 0,
        total: 0,
        key: idempotencyKey || null,
        suppressedQuietHours: [...suppressedQuietHours].sort(),
      });
    }
  }

  let locationUsageClaimKey: string | null = null;
  if (isLocationRefresh && callerRole !== "service_role") {
    const locationRecipients = genericRecipientIds.filter(
      (recipientUserId): recipientUserId is string => Boolean(recipientUserId),
    );
    if (locationRecipients.length === 0) {
      return jsonResponse({ error: "location_target_unavailable" }, 404);
    }
    try {
      const usageClaim = await claimLocationManualRequestUsage(db, {
        familyId,
        targetUserId,
        requestId: pushId,
      });
      if (usageClaim.status === "exhausted") {
        return jsonResponse({
          error: "location_request_quota_exceeded",
          quota: usageClaim.quota,
          used: usageClaim.used,
          tier: usageClaim.tier,
        }, 429);
      }
      if (usageClaim.status === "claimed") locationUsageClaimKey = usageClaim.claimKey;
    } catch (error) {
      console.error("location request usage claim failed:");
      return jsonResponse({ error: "feature_usage_unavailable" }, 503);
    }
  }

  // 메모·아이 안전 알림을 포함한 일반 instant도 외부 네트워크/claim 전에
  // deterministic pending을 저장한다. Worker가 중단돼도 foreground 회수 경로가 남는다.
  let prequeuedGenericPending = false;
  if (effectiveParentRecipientIds == null) {
    prequeuedGenericPending = await prequeueGenericRecipientPending(db, {
      action,
      familyId,
      senderUserId,
      title,
      message,
      pushId,
      urgent,
      recipientUserIds: genericRecipientIds,
      extraData: fcmExtraData,
      memoDisplayPermits,
      expiresAt: genericPendingExpiresAt,
    });
    if (!prequeuedGenericPending) {
      // 대상 1명 요청에서는 외부 네트워크 발송 전 실패이므로 사용량을 되돌린다.
      // 다중 대상은 일부 pending이 생겼을 수 있어 초과 실행을 막기 위해 보수적으로 claim을 유지한다.
      if (locationUsageClaimKey && genericRecipientIds.length === 1) {
        try {
          await releaseFeatureUsageClaim(db, locationUsageClaimKey);
        } catch (error) {
          console.error("location request usage release failed:");
        }
      }
      return jsonResponse({ error: "pending_queue_failed" }, 503);
    }
    if (hadExplicitGenericRecipients) {
      const undeliveredRecipientIds: Array<string | null> = [];
      for (const recipientUserId of genericRecipientIds) {
        if (!recipientUserId) continue;
        const pendingId = `instant-${familyId}-${action}-${pushId}-${recipientUserId}`;
        if (!(await isPendingDelivered(db, pendingId))) undeliveredRecipientIds.push(recipientUserId);
      }
      genericRecipientIds = undeliveredRecipientIds;
      if (genericRecipientIds.length === 0) {
        return jsonResponse({
          duplicate: true,
          key: idempotencyKey || pushId,
          suppressedQuietHours: [...suppressedQuietHours].sort(),
        }, 200);
      }
    }
  }

  // 부모 알림은 실제 네트워크 발송보다 deterministic pending을 먼저 보장한다.
  // FCM/Web Push가 0건이어도 부모 foreground 소비자가 회수할 수 있다.
  let prequeuedParentPending = false;
  if (effectiveParentRecipientIds) {
    prequeuedParentPending = true;
    let pendingOk = true;
    const alreadyDeliveredParentIds = new Set<string>();
    for (const parentUserId of effectiveParentRecipientIds) {
      const pendingId = parentAlertPendingId(pushId, parentUserId);
      const parentRoute = routeForRecipient(action, parentUserId, fcmExtraData);
      const queued = await insertPending(db, {
        id: pendingId,
        family_id: familyId,
        title,
        body: message,
        data: {
          senderUserId: senderUserId || "",
          familyId,
          type: action,
          action,
          pushId,
          urgent,
          targetRole: "parent",
          targetUserId: parentUserId,
          ...(parentRoute ? { route: parentRoute } : {}),
          ...(severity ? { severity } : {}),
          ...(alertType ? { alertType } : {}),
          ...(parentPendingExpiresAt ? { expiresAt: parentPendingExpiresAt } : {}),
          ...(body.eventId != null ? { eventId: String(body.eventId) } : {}),
          ...(body.alertId != null ? { alertId: String(body.alertId) } : {}),
        },
        delivery_status: { queued: true, targetUserId: parentUserId },
        idempotency_key: pendingId,
        delivered: false,
        expires_at: parentPendingExpiresAt,
      });
      if (!queued) pendingOk = false;
      else if (await isPendingDelivered(db, pendingId)) alreadyDeliveredParentIds.add(parentUserId);
    }
    if (!pendingOk) {
      // claim 전에 pending부터 보장하므로 실패 시 되돌릴 delivery claim이 없다.
      return jsonResponse({ error: "pending_queue_failed" }, 503);
    }
    effectiveParentRecipientIds = new Set(
      [...effectiveParentRecipientIds].filter((userId) => !alreadyDeliveredParentIds.has(userId)),
    );
  }

  // 부모 알림은 알림 종류별 설정이 공동부모마다 다를 수 있다. occurrence 전역 claim을
  // 쓰면 먼저 허용된 한 부모가 나중에 다른 종류를 허용한 부모의 전달까지 막으므로,
  // pending을 먼저 보장한 뒤 수신자별 canonical claim을 잡는다.
  let deliveryParentRecipientIds = effectiveParentRecipientIds;
  let parentRecipientClaimInFlight = false;
  const parentRecipientClaimLeases = new Map<string, string>();
  let deliveryGenericRecipientIds: Set<string> | null = hadExplicitGenericRecipients
    ? new Set(genericRecipientIds.filter((recipientUserId): recipientUserId is string => !!recipientUserId))
    : null;
  let genericRecipientClaimInFlight = false;
  const genericRecipientClaimLeases = new Map<string, string>();
  let genericClaimLease: string | null = null;
  if (idempotencyKey) {
    if (effectiveParentRecipientIds) {
      const newlyClaimed = new Set<string>();
      for (const parentUserId of effectiveParentRecipientIds) {
        const recipientKey = parentAlertRecipientClaimKey(pushId, parentUserId);
        const claim = await claimParentRecipientDelivery(db, recipientKey, action, familyId);
        if (claim.status === "acquired") {
          newlyClaimed.add(parentUserId);
          parentRecipientClaimLeases.set(parentUserId, claim.leaseCreatedAt);
        } else if (claim.status === "in_flight") parentRecipientClaimInFlight = true;
      }
      deliveryParentRecipientIds = newlyClaimed;
      if (newlyClaimed.size === 0) {
        if (parentRecipientClaimInFlight) {
          return jsonResponse({ error: "parent_delivery_in_flight", key: idempotencyKey }, 503);
        }
        return jsonResponse({
          duplicate: true,
          key: idempotencyKey,
          suppressedQuietHours: [...suppressedQuietHours].sort(),
        }, 200);
      }
    } else {
      const explicitRecipients = new Set(
        genericRecipientIds.filter((recipientUserId): recipientUserId is string => !!recipientUserId),
      );
      if (explicitRecipients.size > 0) {
        const newlyClaimed = new Set<string>();
        for (const recipientUserId of explicitRecipients) {
          const recipientKey = genericRecipientDeliveryKey(familyId, pushId, recipientUserId);
          const claim = await claimGenericDelivery(db, recipientKey, action, familyId);
          if (claim.status === "acquired") {
            newlyClaimed.add(recipientUserId);
            genericRecipientClaimLeases.set(recipientUserId, claim.leaseCreatedAt);
          } else if (claim.status === "in_flight") {
            genericRecipientClaimInFlight = true;
          }
        }
        deliveryGenericRecipientIds = newlyClaimed;
        if (newlyClaimed.size === 0) {
          if (genericRecipientClaimInFlight) {
            return jsonResponse({ error: "delivery_in_flight", key: idempotencyKey }, 503);
          }
          return jsonResponse({
            duplicate: true,
            key: idempotencyKey,
            suppressedQuietHours: [...suppressedQuietHours].sort(),
          }, 200);
        }
      } else {
        const familyScopedKey = `${familyId}:${idempotencyKey}`;
        const genericClaim = await claimGenericDelivery(db, familyScopedKey, action, familyId);
        if (genericClaim.status === "completed") {
          return jsonResponse({
            duplicate: true,
            key: idempotencyKey,
            suppressedQuietHours: [...suppressedQuietHours].sort(),
          }, 200);
        }
        if (genericClaim.status === "in_flight") {
          return jsonResponse({ error: "delivery_in_flight", key: idempotencyKey }, 503);
        }
        genericClaimLease = genericClaim.leaseCreatedAt;
      }
    }
  }

  // ── Web Push (VAPID) ──
  let subs: Array<{ id: string; endpoint: string; subscription: unknown; user_id: string }> = [];
  if (!isChildNativeCommand) {
    const { results } = await db
      .prepare("SELECT id, endpoint, subscription, user_id FROM push_subscriptions WHERE family_id = ? AND disabled_at IS NULL")
      .bind(familyId)
      .all<{ id: string; endpoint: string; subscription: string; user_id: string }>();
    subs = (results ?? []).map((r) => ({ ...r, subscription: parseJson(r.subscription) }));
  }

  const payload = {
    title,
    body: message,
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    data: {
      type: action,
      familyId,
      pushId,
      urgent,
      ...(severity ? { severity } : {}),
      ...(alertType ? { alertType } : {}),
      ...(webPushExpiresAt ? { expiresAt: webPushExpiresAt } : {}),
    },
  };

  let webSent = 0;
  const expiredIds: string[] = [];
  const parentWebChannelRecipientIds = new Set<string>();
  const parentWebSentRecipientIds = new Set<string>();
  const genericWebChannelRecipientIds = new Set<string>();
  const genericWebSentRecipientIds = new Set<string>();
  if (isWebPushConfigured(env) && subs.length) {
    for (const sub of subs) {
      if (sub.user_id === senderUserId) continue;
      if (memoRecipientIds && (!sub.user_id || !memoRecipientIds.has(sub.user_id))) continue;
      if (childSafetyRecipientIds && (!sub.user_id || !childSafetyRecipientIds.has(sub.user_id))) continue;
      if (deliveryParentRecipientIds && (!sub.user_id || !deliveryParentRecipientIds.has(sub.user_id))) continue;
      if (deliveryGenericRecipientIds && (!sub.user_id || !deliveryGenericRecipientIds.has(sub.user_id))) continue;
      const memoDisplayPermit = action === "new_memo"
        ? memoDisplayPermits.get(sub.user_id)
        : undefined;
      if (action === "new_memo" && !memoDisplayPermit) continue;
      if (deliveryParentRecipientIds && sub.user_id) parentWebChannelRecipientIds.add(sub.user_id);
      if (deliveryGenericRecipientIds && sub.user_id) genericWebChannelRecipientIds.add(sub.user_id);
      const targetRole = roleForRecipient(action, sub.user_id, fcmExtraData);
      const route = routeForRecipient(action, sub.user_id, fcmExtraData);
      const payloadJson = JSON.stringify({
        ...payload,
        data: {
          ...payload.data,
          targetUserId: sub.user_id,
          ...(memoDisplayPermit ? { memoDisplayPermit } : {}),
          ...(targetRole ? { targetRole } : {}),
          ...(route ? { route } : {}),
        },
      });
      const outcome = await sendWebPush(env, sub.subscription, payloadJson, memoDeliveryContext?.signal);
      if (outcome === "sent") {
        webSent++;
        if (deliveryParentRecipientIds && sub.user_id) parentWebSentRecipientIds.add(sub.user_id);
        if (deliveryGenericRecipientIds && sub.user_id) genericWebSentRecipientIds.add(sub.user_id);
      }
      else if (outcome === "expired") expiredIds.push(sub.id);
    }
    await disablePushSubsByIds(db, expiredIds);
  }

  // ── FCM ──
  let fcmSent = 0;
  const parentFcmSentRecipientIds = new Set<string>();
  const genericFcmSentRecipientIds = new Set<string>();
  if (deliveryParentRecipientIds) {
    for (const parentUserId of deliveryParentRecipientIds) {
      const sentForParent = await sendFcmToFamily(
        env,
        db,
        familyId,
        senderUserId,
        title,
        message,
        action,
        fcmExtraData,
        new Set([parentUserId]),
        memoDeliveryContext?.signal,
      );
      fcmSent += sentForParent;
      if (sentForParent > 0) parentFcmSentRecipientIds.add(parentUserId);
    }
  } else if (deliveryGenericRecipientIds) {
    for (const recipientUserId of deliveryGenericRecipientIds) {
      const memoDisplayPermit = action === "new_memo"
        ? memoDisplayPermits.get(recipientUserId)
        : undefined;
      if (action === "new_memo" && !memoDisplayPermit) continue;
      const sentForRecipient = await sendFcmToFamily(
        env,
        db,
        familyId,
        senderUserId,
        title,
        message,
        action,
        memoDisplayPermit
          ? { ...fcmExtraData, memoDisplayPermit }
          : fcmExtraData,
        new Set([recipientUserId]),
        memoDeliveryContext?.signal,
      );
      fcmSent += sentForRecipient;
      if (sentForRecipient > 0) genericFcmSentRecipientIds.add(recipientUserId);
    }
  } else {
    if (action === "new_memo") {
      return jsonResponse({ error: "memo_display_permit_recipient_required" }, 503);
    }
    fcmSent = await sendFcmToFamily(
      env,
      db,
      familyId,
      senderUserId,
      title,
      message,
      action,
      fcmExtraData,
      childNativeRecipientIds ?? childSafetyRecipientIds ?? memoRecipientIds,
      memoDeliveryContext?.signal,
    );
  }

  let parentDeliveryRetryable = parentRecipientClaimInFlight;
  if (deliveryParentRecipientIds && idempotencyKey) {
    for (const parentUserId of deliveryParentRecipientIds) {
      const delivered = parentFcmSentRecipientIds.has(parentUserId)
        || parentWebSentRecipientIds.has(parentUserId);
      const shouldRetry = shouldRetryParentRecipientDelivery({
        hasNativeChannel: nativeRecipientIds.has(parentUserId),
        hasWebChannel: parentWebChannelRecipientIds.has(parentUserId),
        delivered,
      });
      const recipientKey = parentAlertRecipientClaimKey(pushId, parentUserId);
      const leaseCreatedAt = parentRecipientClaimLeases.get(parentUserId);
      if (!leaseCreatedAt) {
        parentDeliveryRetryable = true;
        continue;
      }
      if (shouldRetry) {
        parentDeliveryRetryable = true;
        await releaseParentRecipientDelivery(db, recipientKey, action, familyId, leaseCreatedAt);
      } else {
        // 실제 채널 성공 또는 채널 없음(pending-only 복구)일 때만 완료 시각을 찍는다.
        const completed = await markParentRecipientDeliveryComplete(
          db,
          recipientKey,
          action,
          familyId,
          leaseCreatedAt,
        );
        if (!completed) parentDeliveryRetryable = true;
      }
    }
  }

  if (parentDeliveryRetryable) {
    return jsonResponse({
      error: "parent_delivery_retryable",
      webSent,
      fcmSent,
      key: idempotencyKey,
    }, 503);
  }

  let genericRecipientDeliveryRetryable = genericRecipientClaimInFlight;
  if (deliveryGenericRecipientIds && idempotencyKey) {
    for (const recipientUserId of deliveryGenericRecipientIds) {
      const delivered = genericFcmSentRecipientIds.has(recipientUserId)
        || genericWebSentRecipientIds.has(recipientUserId);
      const hasNativeChannel = nativeRecipientIds.has(recipientUserId);
      const hasWebChannel = genericWebChannelRecipientIds.has(recipientUserId);
      const recipientKey = genericRecipientDeliveryKey(familyId, pushId, recipientUserId);
      const leaseCreatedAt = genericRecipientClaimLeases.get(recipientUserId);
      if (!leaseCreatedAt) {
        genericRecipientDeliveryRetryable = true;
        continue;
      }
      if ((hasNativeChannel || hasWebChannel) && !delivered) {
        genericRecipientDeliveryRetryable = true;
        await releaseGenericDelivery(db, recipientKey, action, familyId, leaseCreatedAt);
      } else {
        const completed = await markGenericDeliveryComplete(
          db,
          recipientKey,
          action,
          familyId,
          leaseCreatedAt,
        );
        if (!completed) genericRecipientDeliveryRetryable = true;
      }
    }
  }

  if (genericRecipientDeliveryRetryable) {
    return jsonResponse({
      error: "delivery_retryable",
      webSent,
      fcmSent,
      key: idempotencyKey,
    }, 503);
  }

  if (idempotencyKey && genericClaimLease) {
    const explicitRecipients = new Set(
      genericRecipientIds.filter((recipientUserId): recipientUserId is string => !!recipientUserId),
    );
    const targetsRecipient = (recipientUserId: string) =>
      recipientUserId !== senderUserId
      && (explicitRecipients.size === 0 || explicitRecipients.has(recipientUserId));
    const hasNativeChannel = [...nativeRecipientIds].some(targetsRecipient);
    const hasWebChannel = !isChildNativeCommand && subs.some((sub) => targetsRecipient(sub.user_id));
    const delivered = webSent > 0 || fcmSent > 0;
    if ((hasNativeChannel || hasWebChannel) && !delivered) {
      await releaseGenericDelivery(db, `${familyId}:${idempotencyKey}`, action, familyId, genericClaimLease);
      return jsonResponse({ error: "delivery_retryable", webSent, fcmSent, key: idempotencyKey }, 503);
    }
    const completed = await markGenericDeliveryComplete(
      db,
      `${familyId}:${idempotencyKey}`,
      action,
      familyId,
      genericClaimLease,
    );
    if (!completed) {
      return jsonResponse({ error: "delivery_claim_lost", webSent, fcmSent, key: idempotencyKey }, 503);
    }
  }

  const totalRecipients = isChildNativeCommand || isChildSafety
    ? (childNativeRecipientIds?.size ?? childSafetyRecipientIds?.size ?? 0)
    : (deliveryParentRecipientIds?.size ?? deliveryGenericRecipientIds?.size ?? subs.length);
  const deliveryStatus: Record<string, unknown> = { webSent, fcmSent, recipients: totalRecipients };
  if (webSent === 0 && fcmSent === 0) deliveryStatus.note = "no subscribers";

  const basePendingData: Record<string, unknown> = {
    senderUserId: senderUserId || "",
    familyId,
    type: action,
    action,
    pushId,
    urgent,
    ...(isRemoteListen || isRemoteListenStop || isLocationRefresh || isDeviceStatusRefresh ? { targetRole: "child" } : {}),
    ...(isChildSafety ? { targetRole: "child" } : {}),
    ...(action === "kkuk" || action === "sos" || action === "emergency" || action === "parent_alert" ? { targetRole: "parent" } : {}),
    ...(targetUserId ? { targetUserId } : {}),
    ...(remoteListenRequestId
      ? { requestId: remoteListenRequestId }
      : (isChildNativeCommand && body.requestId != null ? { requestId: String(body.requestId) } : {})),
    ...(isChildNativeCommand && body.reason != null ? { reason: String(body.reason) } : {}),
    ...(isChildNativeCommand && body.requestedAt != null ? { requestedAt: String(body.requestedAt) } : {}),
    ...(isChildNativeCommand && body.requesterUserId != null ? { requesterUserId: String(body.requesterUserId) } : {}),
    ...(isRemoteListen ? { durationSec: String(REMOTE_LISTEN_DURATION_SEC) } : {}),
    ...(severity ? { severity } : {}),
    ...(alertType ? { alertType } : {}),
    ...(body.eventId != null ? { eventId: String(body.eventId) } : {}),
    ...(typeof body.route === "string" && body.route ? { route: body.route } : {}),
  };

  const memoPendingRecipientIds = !isChildNativeCommand && action === "new_memo" && memoRecipientIds
    ? [...memoRecipientIds].filter((r) => r && r !== senderUserId)
    : [];
  const parentPendingRecipientIds = parentRecipientIds
    ? [...parentRecipientIds].filter((r) => r && r !== senderUserId)
    : [];
  const pendingRecipientIds: Array<string | null> = action === "new_memo"
    ? memoPendingRecipientIds
    : (action === "child_safety"
      ? (targetUserId ? [targetUserId] : [])
      : (parentRecipientIds ? parentPendingRecipientIds : [null]));

  // FCM API 200은 기기 표시 확인이 아니다. 네이티브 ACK 또는 foreground 표시가
  // 확인되기 전까지 pending을 유지해야 일반 도착/경고 알림도 복구할 수 있다.
  const deliveredFlag = false;
  let expiresAt: string | null = null;
  if (isRemoteListen) expiresAt = pgFromMs(Date.now() + 5 * 60_000);
  else if (isLocationRefresh) expiresAt = pgFromMs(Date.now() + 2 * 60_000);
  else if (isDeviceStatusRefresh) expiresAt = pgFromMs(Date.now() + 2 * 60_000);

  for (const recipientUserId of prequeuedParentPending || prequeuedGenericPending ? [] : pendingRecipientIds) {
    await insertPending(db, {
      family_id: familyId,
      title,
      body: message,
      data: { ...basePendingData, ...(recipientUserId ? { targetUserId: recipientUserId } : {}) },
      delivery_status: { ...deliveryStatus, ...(recipientUserId ? { targetUserId: recipientUserId } : {}) },
      idempotency_key: idempotencyKey || null,
      delivered: deliveredFlag,
      expires_at: expiresAt,
    });
  }

  return jsonResponse({
    webSent,
    fcmSent,
    total: totalRecipients,
    key: idempotencyKey || null,
    suppressedQuietHours: [...suppressedQuietHours].sort(),
  });
}

function memoPushPreview(content: string): string {
  const text = String(content ?? "").trim();
  if (text.startsWith("[[img:")) return "사진을 보냈어요";
  if (text.startsWith("[[loc:")) return "위치를 보냈어요";
  return text.length > 80 ? `${text.slice(0, 80)}…` : text;
}

type StoredParentAlertForPush = {
  id: string;
  alert_type: string;
  title: string;
  message: string;
  severity: string;
  event_id: string | null;
  child_user_id: string | null;
};

// 구 hyeni-1 클라이언트는 parent_alert 저장과 별도로 직접 푸시를 호출한다.
// 클라이언트 본문을 그대로 보내면 저장 경로와 멱등키가 달라 중복되거나, 가족 구성원이
// 임의 제목으로 안전 알림을 만들 수 있다. 실제 행을 찾거나 서버 권한 검증으로 먼저
// 저장한 뒤, 그 행의 정본 필드만 사용해 기존 전송 경로와 같은 pushId로 합친다.
async function handleVerifiedLegacyParentAlertNotification(
  env: PushEnv,
  db: D1Database,
  body: Record<string, any>,
  callerUserId: string,
): Promise<Response> {
  const familyId = toStringValue(body.familyId);
  const alertType = toStringValue(body.alertType || body.alert_type);
  const requestedTitle = toStringValue(body.title);
  const requestedMessage = toStringValue(body.message);
  if (!familyId || !alertType || (!requestedTitle && !requestedMessage) || !callerUserId) {
    return jsonResponse({ error: "parent_alert_record_required" }, 400);
  }

  const membership = await resolveVerifiedFamilyMembership(db, callerUserId, familyId);
  if (!membership) return jsonResponse({ error: "not a family member" }, 403);

  const recentCutoff = pgFromMs(Date.now() - 10 * 60_000);
  const childConstraint = membership.role === "child" ? " AND child_user_id = ?" : "";
  const query = db.prepare(
    `SELECT id, alert_type, title, message, severity, event_id, child_user_id
       FROM parent_alerts
      WHERE family_id = ? AND alert_type = ? AND title = ? AND message = ?
        AND substr(created_at,1,19) >= substr(?,1,19)${childConstraint}
      ORDER BY substr(created_at,1,23) DESC, rowid DESC
      LIMIT 1`,
  );
  let alert = membership.role === "child"
    ? await query.bind(
      familyId,
      alertType,
      requestedTitle || requestedMessage,
      requestedMessage || requestedTitle,
      recentCutoff,
      callerUserId,
    ).first<StoredParentAlertForPush>()
    : await query.bind(
      familyId,
      alertType,
      requestedTitle || requestedMessage,
      requestedMessage || requestedTitle,
      recentCutoff,
    ).first<StoredParentAlertForPush>();

  if (!alert?.id) {
    if (membership.role === "child" && isServerDerivedParentAlertType(alertType)) {
      return jsonResponse({ accepted: true, server_derived: true }, 202);
    }
    const requestedChildUserId = toStringValue(body.childUserId || body.child_user_id) || null;
    const scope = await resolveParentAlertWriteScope(db, {
      callerUserId,
      familyId,
      alertType,
      requestedChildUserId,
    });
    if (!scope) return jsonResponse({ error: "parent_alert_write_forbidden" }, 403);

    const insertedId = await insertParentAlertV2(env, db, {
      familyId,
      alertType,
      title: requestedTitle || requestedMessage,
      message: requestedMessage || requestedTitle,
      severity: toStringValue(body.severity) || "info",
      eventId: toStringValue(body.eventId || body.event_id) || null,
      childUserId: scope.childUserId,
    });
    if (!insertedId) return jsonResponse({ error: "parent_alert_insert_failed" }, 503);
    alert = await db
      .prepare(
        `SELECT id, alert_type, title, message, severity, event_id, child_user_id
           FROM parent_alerts WHERE id = ? AND family_id = ? LIMIT 1`,
      )
      .bind(insertedId, familyId)
      .first<StoredParentAlertForPush>();
  }

  if (!alert?.id) return jsonResponse({ error: "parent_alert_record_unavailable" }, 503);
  const policy = resolveParentAlertPushType(alert.alert_type, alert.severity) ?? {
    type: "parent_alert" as const,
    urgent: false,
    route: "/notifications" as const,
  };
  const pushId = parentAlertDeliveryKey(alert.alert_type, alert.event_id || alert.id);
  const route = parentAlertTargetRoute(policy.route, alert.id, alert.child_user_id);
  const delivery = await handleInstantNotification(
    env,
    db,
    {
      action: policy.type,
      familyId,
      senderUserId: callerUserId,
      title: alert.title,
      message: alert.message,
      alertType: alert.alert_type,
      severity: alert.severity,
      urgent: policy.urgent,
      route,
      alertId: alert.id,
      ...(alert.event_id ? { eventId: alert.event_id } : {}),
      idempotency_key: pushId,
    },
    callerUserId,
    "service_role",
    pushId,
  );
  if (!delivery.ok) return delivery;

  if (alert.child_user_id) {
    const childDeliveryOk = await sendChildSafetyNotification(env, db, {
      familyId,
      childUserId: alert.child_user_id,
      alertType: alert.alert_type,
      idempotencyKey: pushId,
    });
    if (!childDeliveryOk) return jsonResponse({ error: "child_safety_delivery_failed" }, 503);
  }
  return delivery;
}

// 구 hyeni-1 클라이언트는 memo 저장 직후 별도 new_memo action을 보낸다. 공개
// action을 그대로 신뢰하지 않고, 실제로 방금 저장된 호출자 본인의 memo row를 찾아
// 제목·본문·멱등키를 서버가 재구성해 호환성과 위조 방지를 함께 보장한다.
async function handleVerifiedLegacyMemoNotification(
  env: PushEnv,
  db: D1Database,
  body: Record<string, any>,
  callerUserId: string,
): Promise<Response> {
  const familyId = toStringValue(body.familyId);
  const targetChildUserId = toStringValue(body.targetChildUserId);
  if (!familyId || !targetChildUserId || !callerUserId) {
    return jsonResponse({ error: "memo_target_required" }, 400);
  }
  const membership = await resolveVerifiedFamilyMembership(db, callerUserId, familyId);
  if (!membership) return jsonResponse({ error: "not a family member" }, 403);

  const child = await db
    .prepare(
      `SELECT id, user_id FROM family_members
        WHERE family_id = ? AND user_id = ? AND role = 'child' AND is_active = 1
        LIMIT 1`,
    )
    .bind(familyId, targetChildUserId)
    .first<{ id: string; user_id: string }>();
  if (!child?.id) return jsonResponse({ error: "invalid_memo_target" }, 403);

  const recentCutoff = pgFromMs(Date.now() - 5 * 60_000);
  const reply = await db
    .prepare(
      `SELECT id, content FROM memo_replies
        WHERE family_id = ? AND child_id = ? AND user_id = ?
          AND substr(created_at,1,19) >= substr(?,1,19)
        ORDER BY substr(created_at,1,23) DESC, rowid DESC
        LIMIT 1`,
    )
    .bind(familyId, child.id, callerUserId, recentCutoff)
    .first<{ id: string; content: string }>();
  if (!reply?.id) return jsonResponse({ error: "memo_record_required" }, 409);

  const sender = await db
    .prepare("SELECT name, role FROM family_members WHERE family_id = ? AND user_id = ? LIMIT 1")
    .bind(familyId, callerUserId)
    .first<{ name: string | null; role: string | null }>();
  const senderName = (sender?.name || (membership.role === "child" ? "아이" : "보호자")).trim();
  const title = membership.role === "child"
    ? `${senderName}님이 메시지를 보냈어요`
    : `${senderName}님의 메시지`;
  const idempotencyKey = `memo:${reply.id}`;
  return handleInstantNotification(
    env,
    db,
    {
      action: "new_memo",
      familyId,
      senderUserId: callerUserId,
      title,
      message: memoPushPreview(reply.content),
      targetChildUserId,
      idempotency_key: idempotencyKey,
    },
    callerUserId,
    "service_role",
    idempotencyKey,
  );
}

export async function sendChildSafetyNotification(
  env: PushEnv,
  db: D1Database,
  args: {
    familyId: string;
    childUserId: string;
    alertType: string;
    idempotencyKey: string;
  },
): Promise<boolean> {
  const copy = childSafetyNotificationForAlert(args.alertType);
  if (!copy) return true;

  const response = await handleInstantNotification(
    env,
    db,
    {
      action: "child_safety",
      familyId: args.familyId,
      targetUserId: args.childUserId,
      title: copy.title,
      message: copy.message,
      alertType: args.alertType,
      urgent: copy.urgent,
      route: "/child/home",
      expiresAt: pgFromMs(Date.now() + copy.ttlMs),
      idempotency_key: `${args.idempotencyKey}:child:${args.childUserId}`,
    },
    "",
    "service_role",
    null,
  );
  return response.ok;
}

// ── cron notification (60/30/15/10/5/0분 일정 리마인더 + 미도착 긴급) ──────────────────
interface CronEvent {
  id: string;
  family_id: string;
  title: string;
  time: string;
  emoji: string | null;
  category: string | null;
  location: unknown;
  date_key: string;
  is_family_event: boolean;
  notif_override: unknown;
  updated_at: string;
  events_children: Array<{ child_id: string }>;
  _minutesOffset: number;
}

function reminderPendingExpiresAt(
  event: Pick<CronEvent, "date_key" | "time">,
  minsBefore: number,
): string {
  const [year, zeroBasedMonth, day] = event.date_key.split("-").map(Number);
  const [hour, minute] = event.time.split(":").map(Number);
  if (![year, zeroBasedMonth, day, hour, minute].every(Number.isFinite)) {
    return pgFromMs(Date.now() + 10 * 60_000);
  }
  // date_key 월은 앱 계약상 0-indexed다. 각 리마인더는 목표시각 뒤 cron 지연
  // 복구창(2분)+여유(1분)까지만 pending으로 남겨, 오프라인 복귀 때 60·30·15분
  // 알림이 한꺼번에 재생되지 않게 한다.
  const startAtMs = Date.UTC(year, zeroBasedMonth, day, hour - 9, minute);
  return pgFromMs(startAtMs - minsBefore * 60_000 + 3 * 60_000);
}

async function loadCronEvents(db: D1Database, dateSpecs: Array<{ key: string; offset: number }>): Promise<CronEvent[]> {
  const all: CronEvent[] = [];
  for (const spec of dateSpecs) {
    const { results } = await db
      .prepare(
        "SELECT id, family_id, title, time, emoji, category, location, date_key, is_family_event, notif_override, updated_at FROM events WHERE date_key = ?",
      )
      .bind(spec.key)
      .all<Record<string, any>>();
    for (const r of results ?? []) {
      all.push({
        id: String(r.id),
        family_id: String(r.family_id),
        title: r.title,
        time: r.time,
        emoji: r.emoji ?? null,
        category: r.category ?? null,
        location: parseJson(r.location),
        date_key: String(r.date_key),
        is_family_event: toBool(r.is_family_event),
        notif_override: parseJson(r.notif_override),
        updated_at: String(r.updated_at ?? ""),
        events_children: [],
        _minutesOffset: spec.offset,
      });
    }
  }
  if (all.length) {
    const ids = all.map((e) => e.id);
    const byEvent: Record<string, Array<{ child_id: string }>> = {};
    for (const chunk of chunkSqlVariables(ids, EVENT_CHILD_QUERY_CHUNK)) {
      const ph = chunk.map(() => "?").join(",");
      const { results } = await db
        .prepare(`SELECT event_id, child_id FROM events_children WHERE event_id IN (${ph})`)
        .bind(...chunk)
        .all<{ event_id: string; child_id: string }>();
      for (const k of results ?? []) (byEvent[k.event_id] ||= []).push({ child_id: k.child_id });
    }
    for (const e of all) e.events_children = byEvent[e.id] ?? [];
  }
  return all;
}

async function acquireCronFamilyMutationLease(db: D1Database, familyId: string) {
  const family = await db
    .prepare("SELECT parent_id FROM families WHERE id=?")
    .bind(familyId)
    .first<{ parent_id: string }>();
  if (!family?.parent_id) return null;
  return acquireAccountMutationLease(db, {
    userId: family.parent_id,
    familyId,
  });
}

async function acquirePushDispatchMutationLeases(
  db: D1Database,
  body: Record<string, any> | null,
  callerUserId: string,
  callerRole: string,
) {
  const scopes: AccountMutationScope[] = [];
  if (callerRole !== "service_role" && callerUserId) scopes.push({ userId: callerUserId });

  const targetFamilyIds = new Set<string>();
  for (const value of [body?.familyId, body?.family_id]) {
    if (typeof value === "string" && value.trim()) targetFamilyIds.add(value.trim());
  }
  const action = String(body?.action ?? "");
  if ((action === "playdate_started" || action === "playdate_ended") && body?.session_id) {
    const session = await db
      .prepare("SELECT family_a_id, family_b_id FROM playdate_sessions WHERE id=? LIMIT 1")
      .bind(String(body.session_id))
      .first<{ family_a_id: string; family_b_id: string }>();
    if (session?.family_a_id) targetFamilyIds.add(String(session.family_a_id));
    if (session?.family_b_id) targetFamilyIds.add(String(session.family_b_id));
  }
  if ((action === "force_ring_stop" || action === "force_ring") && body?.event_id) {
    const event = await db
      .prepare("SELECT family_id FROM force_ring_events WHERE id=? LIMIT 1")
      .bind(String(body.event_id))
      .first<{ family_id: string }>();
    if (event?.family_id) targetFamilyIds.add(String(event.family_id));
  }
  if (action === "teacher_notice" && body?.notice_id) {
    const { results } = await db
      .prepare("SELECT DISTINCT family_id FROM teacher_notice_recipients WHERE notice_id=?")
      .bind(String(body.notice_id))
      .all<{ family_id: string }>();
    for (const row of results ?? []) if (row.family_id) targetFamilyIds.add(String(row.family_id));
  }

  for (const familyId of targetFamilyIds) {
    const family = await db
      .prepare("SELECT parent_id FROM families WHERE id=? LIMIT 1")
      .bind(familyId)
      .first<{ parent_id: string }>();
    if (!family?.parent_id) return { status: "blocked" as const, leases: [] };
    scopes.push({ userId: family.parent_id, familyId });
    const { results: members } = await db
      .prepare(
        `SELECT user_id FROM family_members
          WHERE family_id=? AND is_active=1 AND user_id IS NOT NULL AND role IN ('parent','child')`,
      )
      .bind(familyId)
      .all<{ user_id: string }>();
    for (const member of members ?? []) {
      if (member.user_id) scopes.push({ userId: String(member.user_id), familyId });
    }
  }

  return acquireAccountMutationLeases(db, scopes);
}

export async function handleCronNotification(env: PushEnv, db: D1Database): Promise<Response> {
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const year = kst.getUTCFullYear();
  const month = kst.getUTCMonth();
  const day = kst.getUTCDate();
  const dateKey = `${year}-${month}-${day}`;
  const nowMinutes = kst.getUTCHours() * 60 + kst.getUTCMinutes();

  // 자정 넘김 lookahead: 최대 리드타임(60분) 안에 있는 내일 새벽 이벤트를 오늘 밤에 미리 스캔.
  // (예: 내일 00:30 이벤트의 1시간 전 알림은 오늘 23:30 에 발송돼야 함)
  const dateSpecs: Array<{ key: string; offset: number }> = [{ key: dateKey, offset: 0 }];
  if (nowMinutes >= 1440 - 60) {
    const tomorrowKst = new Date(kst.getTime() + 24 * 60 * 60 * 1000);
    const tomorrowKey = `${tomorrowKst.getUTCFullYear()}-${tomorrowKst.getUTCMonth()}-${tomorrowKst.getUTCDate()}`;
    dateSpecs.push({ key: tomorrowKey, offset: 1440 });
  }

  let events: CronEvent[];
  try {
    events = await loadCronEvents(db, dateSpecs);
  } catch (e) {
    console.error("Failed to fetch events:");
    return jsonResponse({ error: "Failed to fetch events" }, 500);
  }
  if (!events.length) return jsonResponse({ sent: 0, checked: 0, message: "No events today" });

  let totalWebSent = 0;
  let totalFcmSent = 0;
  let totalNotArrivedSent = 0;
  const webConfigured = isWebPushConfigured(env);

  const parentRecipientCache = new Map<string, Set<string>>();
  const childMembersCache = new Map<string, Array<{ id: string; user_id: string; name: string }>>();
  const childLocationsCache = new Map<string, {
    locations: Array<{ user_id: string; lat: number; lng: number; updated_at?: string; accuracy_m?: number }>;
    error: boolean;
  }>();
  type CronFamilyMember = { user_id: string; role: string };
  const familyMembersCache = new Map<string, { members: CronFamilyMember[]; error: boolean }>();
  const familySettingsCache = new Map<string, { settingsByUser: Map<string, EffectiveNotifSetting>; error: boolean }>();

  const loadFamilyMembers = async (familyId: string): Promise<{ members: CronFamilyMember[]; error: boolean }> => {
    let cached = familyMembersCache.get(familyId);
    if (!cached) {
      try {
        // 활성 자녀 격리: superseded/unpair 옛 자녀(role='child' AND is_active=0)는
        // 리마인더 수신자 풀에서 제외한다(부모는 supersede 대상이 아니라 항상 유지).
        const { results } = await db
          .prepare(
            `SELECT user_id, role FROM family_members
              WHERE family_id = ?1 AND (role = 'parent' OR is_active = 1)
             UNION
             SELECT parent_id AS user_id, 'parent' AS role FROM families WHERE id = ?1`,
          )
          .bind(familyId)
          .all<{ user_id: string | null; role: string }>();
        const members = (results ?? [])
          .filter((row) => typeof row.user_id === "string" && row.user_id.length > 0 && (row.role === "parent" || row.role === "child"))
          .map((row) => ({ user_id: String(row.user_id), role: String(row.role) }));
        cached = { members, error: false };
      } catch (e) {
        console.error("Cron: failed to load family members:");
        cached = { members: [], error: true };
      }
      familyMembersCache.set(familyId, cached);
    }
    return cached;
  };

  const loadFamilySettings = async (familyId: string) => {
    let cached = familySettingsCache.get(familyId);
    if (!cached) {
      const { members } = await loadFamilyMembers(familyId);
      const userIds = members.map((m) => m.user_id);
      if (userIds.length === 0) {
        cached = { settingsByUser: new Map<string, EffectiveNotifSetting>(), error: false };
      } else {
        try {
          const ph = userIds.map(() => "?").join(",");
          const { results } = await db
            .prepare(`SELECT user_id, parent_enabled, child_enabled, minutes_before FROM notification_settings WHERE user_id IN (${ph})`)
            .bind(...userIds)
            .all<Record<string, any>>();
          // D1 boolean(0/1)·int[] TEXT 를 buildNotifSettingsMap 이 기대하는 JS boolean·배열로 정규화.
          const normalized = (results ?? []).map((row) => ({
            user_id: row.user_id,
            parent_enabled: toBool(row.parent_enabled),
            child_enabled: toBool(row.child_enabled),
            minutes_before: pgArray(row.minutes_before).map((v) => Number(v)),
          }));
          cached = { settingsByUser: buildNotifSettingsMap(normalized), error: false };
        } catch (e) {
          // 설정을 읽지 못한 상태에서 기본값으로 전원 발송하면 사용자가 명시적으로 끈
          // 알림까지 울린다. 해당 가족은 이번 tick을 건너뛰고 다음 cron에서 재시도한다.
          console.error("Cron: failed to load notification_settings; skipping family for this tick:");
          cached = { settingsByUser: new Map<string, EffectiveNotifSetting>(), error: true };
        }
      }
      familySettingsCache.set(familyId, cached);
    }
    return cached;
  };

  // 리드타임 윈도우 — 클라가 노출하는 사전알림 옵션(60/30/15/10/5분 + 시작0)을 모두 지원한다.
  // 각 윈도우는 selectCronWindowRecipients 에서 사용자의 minutes_before(또는 event notif_override)에
  // 그 리드타임이 포함될 때만 발송된다. 기본값 [15,5] 사용자는 15·5 만 받는다(과잉 알림 없음).
  const notifWindows = [
    {
      key: "60min", minsBefore: 60, parentTitle: "📅 일정 알림", childTitle: "🐰 준비하자!",
      parentBody: (e: string, t: string, tm: string) => `${e} ${t} 1시간 전 알림 — ${tm} 시작`,
      childBody: (e: string, t: string, tm: string) => `${e} ${t} 1시간 뒤야! 미리 준비하자 🎒 (${tm})`,
    },
    {
      key: "30min", minsBefore: 30, parentTitle: "📅 일정 알림", childTitle: "🐰 곧 준비!",
      parentBody: (e: string, t: string, tm: string) => `${e} ${t} 30분 전 알림 — ${tm} 시작`,
      childBody: (e: string, t: string, tm: string) => `${e} ${t} 30분 뒤야! 슬슬 준비하자 🎒 (${tm})`,
    },
    {
      key: "15min", minsBefore: 15, parentTitle: "📅 일정 알림", childTitle: "🐰 준비 시간!",
      parentBody: (e: string, t: string, tm: string) => `${e} ${t} 15분 전 알림 — ${tm} 시작`,
      childBody: (e: string, t: string, tm: string) => `${e} ${t} 가기 15분 전이야! 준비물 챙겼니? 🎒 (${tm})`,
    },
    {
      key: "10min", minsBefore: 10, parentTitle: "📅 일정 알림", childTitle: "🐰 준비 시간!",
      parentBody: (e: string, t: string, tm: string) => `${e} ${t} 10분 전 알림 — ${tm} 시작`,
      childBody: (e: string, t: string, tm: string) => `${e} ${t} 가기 10분 전이야! 준비물 챙겼니? 🎒 (${tm})`,
    },
    {
      key: "5min", minsBefore: 5, parentTitle: "📅 일정 알림", childTitle: "🏃 출발!",
      parentBody: (e: string, t: string, tm: string) => `${e} ${t} 5분 전 알림 — ${tm} 시작`,
      childBody: (e: string, t: string, tm: string) => `${e} ${t} 곧 시작이야! 출발~ 🏃 (${tm})`,
    },
    {
      key: "start", minsBefore: 0, parentTitle: "📅 일정 시작", childTitle: "⏰ 시작!",
      parentBody: (e: string, t: string, tm: string) => `${e} ${t} 지금 시작 — ${tm}`,
      childBody: (e: string, t: string, tm: string) => `${e} ${t} 시작 시간이야! 화이팅! 💪 (${tm})`,
    },
  ];

  const loadParentRecipients = async (familyId: string) => {
    let recipients = parentRecipientCache.get(familyId);
    if (!recipients) {
      recipients = await loadParentAlertRecipientIds(db, familyId, "not_arrived");
      parentRecipientCache.set(familyId, recipients);
    }
    return recipients;
  };

  const loadChildMembers = async (familyId: string) => {
    let members = childMembersCache.get(familyId);
    if (!members) {
      try {
        const { results } = await db
          .prepare("SELECT id, user_id, name FROM family_members WHERE family_id = ? AND role = 'child' AND is_active = 1")
          .bind(familyId)
          .all<{ id: string; user_id: string | null; name: string | null }>();
        members = (results ?? [])
          .filter((row) => typeof row.user_id === "string" && row.user_id.length > 0)
          .map((row) => ({
            id: String(row.id),
            user_id: String(row.user_id),
            name: typeof row.name === "string" && row.name.trim() ? row.name.trim() : "아이",
          }));
      } catch (e) {
        console.error("Failed to load child members for not-arrived check:");
        members = [];
      }
      childMembersCache.set(familyId, members);
    }
    return members;
  };

  const loadChildLocations = async (familyId: string) => {
    let cached = childLocationsCache.get(familyId);
    if (!cached) {
      try {
        const members = await loadChildMembers(familyId);
        await recordLocationConfirmationForSubjects(
          db,
          members.map((member) => ({
            familyId,
            subjectUserId: member.user_id,
          })),
          {
            action: "use",
            requesterKind: "system",
            requesterUserId: null,
            recipientKind: "none",
            recipientUserId: null,
            collectionMethod: "not_applicable",
            acquisitionPath: "current_location_store",
            serviceCode: "schedule_not_arrived_monitor",
            deliveryMethod: "worker_internal",
            purposeCode: "schedule_arrival_alert",
          },
        );
        const { results } = await db
          .prepare("SELECT user_id, lat, lng, updated_at, accuracy_m FROM child_locations WHERE family_id = ?")
          .bind(familyId)
          .all<{ user_id: string; lat: number; lng: number; updated_at: string; accuracy_m: number | null }>();
        const locations = (results ?? [])
          .filter((row) => typeof row.user_id === "string")
          .map((row) => ({
            user_id: String(row.user_id),
            lat: Number(row.lat),
            lng: Number(row.lng),
            updated_at: typeof row.updated_at === "string" ? row.updated_at : undefined,
            accuracy_m: row.accuracy_m == null ? undefined : Number(row.accuracy_m),
          }))
          .filter((row) => Number.isFinite(row.lat) && Number.isFinite(row.lng));
        cached = { locations, error: false };
      } catch (e) {
        console.error("Failed to load child locations for not-arrived check:");
        cached = { locations: [], error: true };
      }
      childLocationsCache.set(familyId, cached);
    }
    return cached;
  };

  const normalizeEventLocation = (location: unknown) => {
    if (!location || typeof location !== "object") return null;
    const loc = location as { lat?: unknown; lng?: unknown };
    const lat = Number(loc.lat);
    const lng = Number(loc.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return { lat, lng };
  };

  for (const event of events) {
    const cronMutationLease = await acquireCronFamilyMutationLease(db, event.family_id);
    if (!cronMutationLease || cronMutationLease.status !== "acquired") continue;
    const cronChildMutationLeases: AccountMutationLease[] = [];
    try {
      if (typeof event.time !== "string") continue;
      const [h, m] = event.time.split(":").map(Number);
      if (!Number.isFinite(h) || !Number.isFinite(m)) continue;
      const eventMinutes = h * 60 + m;

    // ── 활성 자녀 소유권 게이트(원칙: parent UI filterEventsForChild 와 동일) ──
    // 활성 자녀 목록(is_active=1 게이트, loadChildMembers). 소유권 판정에 재사용한다.
    // 이 이벤트가 어떤 활성 자녀에게도 속하지 않으면(가족 일정도 아니고 활성 자녀 링크도
    // 없음) 리마인더·미도착 어느 쪽도 발송하지 않는다 → superseded/unpair 옛 자녀의
    // 고아 이벤트가 부모(및 자녀)에게 새는 모든 경로를 상류에서 차단. 클라이언트가 모든
    // 정상 이벤트를 가족/자녀-링크로 강제하므로 정상 케이스 회귀 없음.
    const activeChildMembers = await loadChildMembers(event.family_id);
    const eventOwnership = {
      isFamilyEvent: event.is_family_event,
      linkedChildIds: (event.events_children ?? []).map((row) => row.child_id),
    };
    const eventTargetChildren = selectEventTargetChildren(eventOwnership, activeChildMembers);
    if (!eventBelongsToActiveChild(eventOwnership, activeChildMembers)) continue;
    const targetScopes = await loadFamilyNotificationMutationScopes(
      db,
      event.family_id,
      eventTargetChildren.map((targetChild) => targetChild.user_id),
    );
    if (!targetScopes) continue;
    const targetMutationLeases = await acquireAccountMutationLeases(db, targetScopes);
    if (targetMutationLeases.status !== "acquired") continue;
    cronChildMutationLeases.push(...targetMutationLeases.leases);
    let targetsStillActive = true;
    for (const targetChild of eventTargetChildren) {
      if (!(await isActiveChildMutationTarget(db, event.family_id, targetChild.user_id))) {
        targetsStillActive = false;
        break;
      }
    }
    if (!targetsStillActive) continue;
    const eventTargetChildUserIdSet = new Set(eventTargetChildren.map((member) => member.user_id));

    for (const window of notifWindows) {
      const targetMinutes = eventMinutes - window.minsBefore + event._minutesOffset;
      if (!isCronReminderDue(nowMinutes, targetMinutes)) continue;

      const familySettings = await loadFamilySettings(event.family_id);
      const { members: familyMembers, error: membersError } = await loadFamilyMembers(event.family_id);
      // 대상 또는 설정을 확정할 수 없을 때 가족 전체로 추정 발송하지 않는다.
      // 다음 1분 cron이 2분 지연 복구창 안에서 다시 시도한다.
      if (membersError) continue;
      if (familySettings.error) continue;

      const { parents: parentRecipients, children: childRecipientsRaw } = selectCronWindowRecipients({
        minsBefore: window.minsBefore,
        members: familyMembers,
        settingsByUser: familySettings.settingsByUser,
        eventOverride: event.notif_override,
      });
      // 자녀 리마인더는 이벤트를 실제 소유한 활성 자녀에게만 보낸다(가족 일정은 전원).
      // familyMembers 는 이미 활성 자녀로 게이팅돼 있으나(loadFamilyMembers), 다자녀
      // 가정에서 A 의 일정이 B 에게 새지 않도록 대상 자녀 집합으로 한 번 더 좁힌다.
      const childRecipients = event.is_family_event
        ? childRecipientsRaw
        : new Set([...childRecipientsRaw].filter((uid) => eventTargetChildUserIdSet.has(uid)));
      if (parentRecipients.size === 0 && childRecipients.size === 0) continue;

      const sentKey = `${window.key}-${event.date_key}`;
      const occurrenceIdentity = {
        eventId: event.id,
        dateKey: event.date_key,
        updatedAt: event.updated_at,
      };
      const pushId = eventReminderPushId(occurrenceIdentity, window.key);
      const revision = eventRevisionKey(event.updated_at);
      const quietSuppressionScope: ScheduleQuietSuppressionScope = {
        familyId: event.family_id,
        eventId: event.id,
        dateKey: event.date_key,
        revision,
        windowKey: window.key,
      };

      const emoji = event.emoji || "📅";
      const sendGroups = [
        {
          recipients: parentRecipients,
          targetRole: "parent",
          route: "/parent/calendar",
          title: window.parentTitle,
          body: window.parentBody(emoji, event.title, event.time),
        },
        {
          recipients: childRecipients,
          targetRole: "child",
          route: "/child/home",
          title: window.childTitle,
          body: window.childBody(emoji, event.title, event.time),
        },
      ];
      try {
        const terminalSuppressedRecipients = await loadScheduleQuietSuppressionRecipients(
          db,
          quietSuppressionScope,
          [...parentRecipients, ...childRecipients],
        );
        const pendingParentRecipients = new Set(
          [...parentRecipients].filter((userId) => !terminalSuppressedRecipients.has(userId)),
        );
        const pendingChildRecipients = new Set(
          [...childRecipients].filter((userId) => !terminalSuppressedRecipients.has(userId)),
        );
        const parentQuietPartition = await partitionNotificationRecipients(db, {
          userIds: pendingParentRecipients,
          identity: { action: "schedule_reminder" },
          atMs: now.getTime(),
        });
        sendGroups[0].recipients = parentQuietPartition.allowed;
        const childQuietPartition = await partitionNotificationRecipients(db, {
          userIds: pendingChildRecipients,
          identity: { action: "schedule_reminder" },
          atMs: now.getTime(),
        });
        sendGroups[1].recipients = childQuietPartition.allowed;
        await recordScheduleQuietSuppressions(db, quietSuppressionScope, [
          ...parentQuietPartition.suppressed,
          ...childQuietPartition.suppressed,
        ]);
      } catch (error) {
        console.error("Cron: failed to partition schedule quiet-hours recipients:");
        continue;
      }
      const deliveryGroups = sendGroups.filter((group) => group.recipients.size > 0);
      if (deliveryGroups.length === 0) continue;

      const { results: subRows } = await db
        .prepare("SELECT id, endpoint, subscription, user_id FROM push_subscriptions WHERE family_id = ? AND disabled_at IS NULL")
        .bind(event.family_id)
        .all<{ id: string; endpoint: string; subscription: string; user_id: string }>();
      const subs = (subRows ?? []).map((r) => ({ ...r, subscription: parseJson(r.subscription) }));
      const expiredIds: string[] = [];

      for (const group of deliveryGroups) {
        const reminderExpiresAt = reminderPendingExpiresAt(event, window.minsBefore);
        const groupPayload = {
          title: group.title,
          body: group.body,
          icon: "/icon-192.png",
          badge: "/icon-192.png",
          data: {
            eventId: event.id,
            type: window.key,
            pushId,
            urgent: false,
            familyId: event.family_id,
            targetRole: group.targetRole,
            route: group.route,
            expiresAt: reminderExpiresAt,
          },
        };

        for (const recipientUserId of group.recipients) {
          const claimKey = `${sentKey}-${revision}-${recipientUserId}`;
          // Worker가 claim 직후 중단돼도 다음 cron이 복구할 수 있도록 deterministic
          // pending을 먼저 보장한다. 사용자별 claim은 그 뒤에 잡아 동시 발송만 막는다.
          const schedulePendingId = `schedule-${event.id}-${window.key}-${event.date_key}-${revision}-${recipientUserId}`;
          const pendingOk = await insertPending(db, {
            id: schedulePendingId,
            family_id: event.family_id,
            title: groupPayload.title,
            body: groupPayload.body,
            data: { ...groupPayload.data, targetUserId: recipientUserId },
            delivery_status: { queued: true, targetUserId: recipientUserId },
            idempotency_key: claimKey,
            expires_at: reminderExpiresAt,
          });
          if (!pendingOk) continue;
          if (await isPendingDelivered(db, schedulePendingId)) {
            await recordPushSentComplete(db, event.id, claimKey);
            continue;
          }
          // 만료 가능한 사용자별 lease로 한 부모의 실패가 다른 부모의 전달 상태를
          // 삼키지 않으며, claim 직후 Worker가 중단돼도 다음 cron에서 복구한다.
          const scheduleLeaseKey = `cron:schedule:${event.family_id}:${event.id}:${claimKey}`;
          const scheduleLeaseAction = "schedule_reminder";
          const scheduleClaim = await claimGenericDelivery(
            db,
            scheduleLeaseKey,
            scheduleLeaseAction,
            event.family_id,
          );
          if (scheduleClaim.status !== "acquired") continue;

          let webSentForRecipient = 0;
          if (webConfigured && subs.length) {
            for (const sub of subs) {
              if (sub.user_id !== recipientUserId) continue;
              const cronPayload = JSON.stringify({
                ...groupPayload,
                data: { ...groupPayload.data, targetUserId: recipientUserId },
              });
              const outcome = await sendWebPushWithRetry(env, sub.subscription, cronPayload);
              if (outcome === "sent") {
                totalWebSent++;
                webSentForRecipient++;
              }
              else if (outcome === "expired") expiredIds.push(sub.id);
            }
          }

          const fcmSent = await sendFcmToFamily(
            env,
            db,
            event.family_id,
            null,
            groupPayload.title,
            groupPayload.body,
            window.key,
            {
              eventId: String(event.id),
              pushId,
              urgent: "false",
              targetRole: group.targetRole,
              route: group.route,
            },
            new Set([recipientUserId]),
          );
          totalFcmSent += fcmSent;
          // deterministic pending은 유지하되 Web Push와 FCM이 모두 실패하면 native
          // 여부와 무관하게 claim을 풀어 2분 grace tick이 같은 pushId로 재시도한다.
          // 아이 local fallback과 서버 push는 같은 reminder key라 재시도돼도 중복 표시되지 않는다.
          if (webSentForRecipient === 0
              && fcmSent === 0) {
            await releaseGenericDelivery(
              db,
              scheduleLeaseKey,
              scheduleLeaseAction,
              event.family_id,
              scheduleClaim.leaseCreatedAt,
            );
            continue;
          }
          const recorded = await recordPushSentComplete(db, event.id, claimKey);
          if (!recorded) {
            await releaseGenericDelivery(
              db,
              scheduleLeaseKey,
              scheduleLeaseAction,
              event.family_id,
              scheduleClaim.leaseCreatedAt,
            );
            continue;
          }
          await markGenericDeliveryComplete(
            db,
            scheduleLeaseKey,
            scheduleLeaseAction,
            event.family_id,
            scheduleClaim.leaseCreatedAt,
          );
        }
      }

      await disablePushSubsByIds(db, expiredIds);
    }

    // ── 미도착 긴급 ──
    const projectedEventMinutes = eventMinutes + event._minutesOffset;
    if (!isNotArrivedAlertWindow(nowMinutes, projectedEventMinutes)) continue;

    const eventLocation = normalizeEventLocation(event.location);
    if (!eventLocation) continue;

    // 미도착 대상 = 이벤트를 소유한 활성 자녀(루프 상단 eventTargetChildren 재사용).
    // 옛 `childMembers.length === 1` / 단독 `is_family_event` 폴백을 제거해 parent UI
    // filterEventsForChild(is_family_event OR child_ids.includes(활성 member.id)) 와
    // 완전히 동일하게 만든다 → 부모 화면에 안 보이는 이벤트는 미도착도 낼 수 없다.
    if (activeChildMembers.length === 0) continue;
    const targetChildren = eventTargetChildren;
    const targetChildUserIds = targetChildren.map((member) => member.user_id);
    if (targetChildUserIds.length === 0) continue;

    const childLocationResult = await loadChildLocations(event.family_id);
    if (childLocationResult.error) continue;
    const childLocations = childLocationResult.locations;
    // 위치 신선도 이분: 신선한 좌표로 "미도착"을 단정할 수 있는 아이 vs
    // 위치가 없거나 오래돼 도착 여부를 알 수 없는 아이(동결 좌표 오탐 방지 — 문구·심각도 분리).
    const arrivalPartition = partitionNotArrivedByFreshness(
      targetChildUserIds, childLocations, eventLocation, ARRIVAL_RADIUS_M,
    );
    const notArrivedChildUserIds = [...arrivalPartition.notArrived, ...arrivalPartition.unknown];
    if (notArrivedChildUserIds.length === 0) continue;
    const arrivalUnknownOnly = arrivalPartition.notArrived.length === 0;

    const sentKey = `not_arrived-${event.date_key}`;
    // 자녀 네이티브 /api/parent-alerts 경로와 같은 stable ID를 사용해 두 판정기가
    // 동시에 확정해도 OS 표시와 foreground pending이 한 알림으로 합쳐진다.
    const occurrenceIdentity = {
      eventId: event.id,
      dateKey: event.date_key,
      updatedAt: event.updated_at,
    };
    const occurrenceAlertId = eventOccurrenceAlertId(occurrenceIdentity);
    const pushId = parentAlertDeliveryKey("not_arrived", occurrenceAlertId);

    const missingNames = targetChildren
      .filter((member) => notArrivedChildUserIds.includes(member.user_id))
      .map((member) => member.name || "아이");
    const childLabel = missingNames.length === 1
      ? `${missingNames[0]}님이`
      : (missingNames.length > 1 ? `${missingNames.join(", ")} 중 일부가` : "아이가");
    const emoji = event.emoji || "📍";
    // 위치를 단정할 수 없으면(전원 stale/미보고) "미도착"이라 단정하지 않고 확인을 요청한다.
    const title = arrivalUnknownOnly ? "📍 도착 확인 필요" : "🚨 미도착 긴급 알림";
    const naSeverity = arrivalUnknownOnly ? "warning" : "emergency";
    const naBody = arrivalUnknownOnly
      ? `${childLabel} ${emoji} ${event.title} 시작 시간인데 위치가 최근에 갱신되지 않아 도착 여부를 확인하지 못했어요. 위치 화면에서 새로고침해 주세요 (${event.time})`
      : `${childLabel} ${emoji} ${event.title} 시작 시간인데 아직 도착하지 않았어요! (${event.time})`;
    const parentRecipients = await loadParentRecipients(event.family_id);
    if (parentRecipients.size === 0) continue;

    const notArrivedClaimKey = `${sentKey}-${eventRevisionKey(event.updated_at)}`;
    const notArrivedLeaseKey = `cron:not-arrived:${event.family_id}:${event.id}:${notArrivedClaimKey}`;
    const notArrivedLeaseAction = "cron_not_arrived";

    const alertData: Record<string, unknown> = {
      eventId: String(event.id),
      occurrenceId: occurrenceAlertId,
      type: "parent_alert",
      action: "parent_alert",
      pushId,
      urgent: !arrivalUnknownOnly,
      severity: naSeverity,
      alertType: "not_arrived",
      targetRole: "parent",
      targetChildUserIds: JSON.stringify(notArrivedChildUserIds),
    };

    // child_user_id 귀속: 대상은 이미 활성 자녀로 한정됐으므로 단일 자녀면 그 user_id 를
    // 기록한다(클라이언트의 "활성 자녀 알림만 표시" 필터가 동작하도록 — 방어 심층화).
    const alertChildUserId = notArrivedChildUserIds.length === 1 ? notArrivedChildUserIds[0] : null;
    const alertId = await insertParentAlertV2(env, db, {
      familyId: event.family_id,
      alertType: "not_arrived",
      title,
      message: naBody,
      severity: naSeverity,
      eventId: occurrenceAlertId,
      childUserId: alertChildUserId,
      metadata: { pushId, targetChildUserIds: notArrivedChildUserIds, radiusM: ARRIVAL_RADIUS_M, staleOnly: arrivalUnknownOnly },
    });
    if (!alertId) {
      continue;
    }
    try {
      await recordLocationAlertProvisionToParents(db, {
        familyId: event.family_id,
        childUserIds: notArrivedChildUserIds,
        alertType: "not_arrived",
      });
    } catch (error) {
      console.error("[push-notify cron] location confirmation failed");
      continue;
    }
    const targetRoute = parentAlertTargetRoute("/notifications", alertId, alertChildUserId);
    alertData.alertId = alertId;
    alertData.route = targetRoute;

    // FCM/웹이 일시 실패해도 각 부모 앱이 foreground 복귀 시 회수할 수 있도록
    // 실제 발송보다 pending을 먼저, 부모별 targetUserId로 보장한다.
    let pendingReady = true;
    for (const parentUserId of parentRecipients) {
      const pendingId = parentAlertPendingId(pushId, parentUserId);
      const inserted = await insertPending(db, {
        id: pendingId,
        family_id: event.family_id,
        title,
        body: naBody,
        data: { ...alertData, targetUserId: parentUserId },
        delivery_status: { queued: true, targetUserId: parentUserId },
        idempotency_key: pendingId,
        delivered: false,
        expires_at: pgFromMs(Date.now() + 30 * 60_000),
      });
      if (!inserted) pendingReady = false;
    }
    if (!pendingReady) {
      continue;
    }

    const notArrivedClaim = await claimGenericDelivery(
      db,
      notArrivedLeaseKey,
      notArrivedLeaseAction,
      event.family_id,
    );
    if (notArrivedClaim.status !== "acquired") continue;

    // native 판정과 cron이 같은 occurrence를 경합해도 공통 수신자별 claim/재시도
    // 경로가 부모마다 한 번만 전달한다. 채널이 있는데 전송이 실패하면 503으로 claim을
    // 풀고 push_sent도 해제해 다음 grace tick이 같은 pushId를 재시도한다.
    const delivery = await handleInstantNotification(
      env,
      db,
      {
        action: "parent_alert",
        familyId: event.family_id,
        senderUserId: alertChildUserId ?? "",
        title,
        message: naBody,
        alertType: "not_arrived",
        severity: naSeverity,
        urgent: !arrivalUnknownOnly,
        eventId: String(event.id),
        alertId,
        route: targetRoute,
        targetChildUserIds: JSON.stringify(notArrivedChildUserIds),
        idempotency_key: pushId,
      },
      "",
      "service_role",
      null,
    );
    if (!delivery.ok) {
      await releaseGenericDelivery(
        db,
        notArrivedLeaseKey,
        notArrivedLeaseAction,
        event.family_id,
        notArrivedClaim.leaseCreatedAt,
      );
      continue;
    }
    const recorded = await recordPushSentComplete(db, event.id, notArrivedClaimKey);
    if (!recorded) {
      await releaseGenericDelivery(
        db,
        notArrivedLeaseKey,
        notArrivedLeaseAction,
        event.family_id,
        notArrivedClaim.leaseCreatedAt,
      );
      continue;
    }
    await markGenericDeliveryComplete(
      db,
      notArrivedLeaseKey,
      notArrivedLeaseAction,
      event.family_id,
      notArrivedClaim.leaseCreatedAt,
    );
    const deliveryStats = await delivery.json().catch(() => ({})) as { webSent?: number; fcmSent?: number };
    totalWebSent += Number(deliveryStats.webSent ?? 0);
    totalFcmSent += Number(deliveryStats.fcmSent ?? 0);
      totalNotArrivedSent += Number(deliveryStats.fcmSent ?? 0);
    } finally {
      await releaseAccountMutationLeases(db, cronChildMutationLeases);
      try {
        await releaseAccountMutationLease(db, cronMutationLease.lease.id);
      } catch (error) {
        console.error("[push-notify cron] mutation lease release failed");
      }
    }

  }

  return jsonResponse({
    webSent: totalWebSent,
    fcmSent: totalFcmSent,
    notArrivedSent: totalNotArrivedSent,
    checked: events.length,
    dateKey,
    time: `${String(kst.getUTCHours()).padStart(2, "0")}:${String(kst.getUTCMinutes()).padStart(2, "0")}`,
  });
}

// ── friend playdate ──────────────────────────────────────────────────────────
function collectParentPhones(
  rows: Array<{ user_id?: unknown; phone?: unknown; gender?: unknown; name?: unknown }> | null | undefined,
): string[] {
  const order = (g: unknown) => (g === "mom" ? 0 : g === "dad" ? 1 : 2);
  return (rows ?? [])
    .map((r) => ({ phone: typeof r.phone === "string" ? r.phone.trim() : "", gender: r.gender, name: typeof r.name === "string" ? r.name : "" }))
    .filter((r) => r.phone !== "")
    .sort((a, b) => order(a.gender) - order(b.gender) || a.name.localeCompare(b.name))
    .map((r) => r.phone);
}

async function loadPlaydateParentRows(db: D1Database, familyId: string): Promise<Array<Record<string, unknown>>> {
  const { results } = await db
    .prepare(
      `WITH parent_users AS (
         SELECT user_id FROM family_members
          WHERE family_id = ?1 AND role = 'parent' AND is_active = 1 AND user_id IS NOT NULL
         UNION
         SELECT parent_id AS user_id FROM families WHERE id = ?1
       )
       SELECT p.user_id, fm.phone, fm.gender, fm.name, ns.playdate_enabled
         FROM parent_users p
         LEFT JOIN family_members fm
           ON fm.family_id = ?1 AND fm.user_id = p.user_id AND fm.role = 'parent'
         LEFT JOIN notification_settings ns ON ns.user_id = p.user_id`,
    )
    .bind(familyId)
    .all<Record<string, unknown>>();
  return results ?? [];
}

export async function handlePlaydateStarted(env: PushEnv, db: D1Database, body: Record<string, any>, callerUserId: string, callerRole: string): Promise<Response> {
  const sessionId = typeof body.session_id === "string" ? body.session_id : "";
  if (!sessionId) return jsonResponse({ error: "session_id_required" }, 400);

  const session = await db
    .prepare("SELECT id, public_place_id, family_a_id, family_b_id, child_a_id, child_b_id, initiator_user_id, started_at, stopped_at FROM friend_playdate_sessions WHERE id = ? LIMIT 1")
    .bind(sessionId)
    .first<Record<string, any>>();
  if (!session) return jsonResponse({ error: "session_not_found" }, 404);

  const isService = callerRole === "service_role";
  if (!isService && callerUserId !== session.child_a_id && callerUserId !== session.child_b_id) {
    return jsonResponse({ error: "forbidden" }, 403);
  }

  const place = await db.prepare("SELECT name FROM public_places WHERE id = ? LIMIT 1").bind(session.public_place_id).first<{ name: string }>();
  const parentsA = await loadPlaydateParentRows(db, String(session.family_a_id));
  const parentsB = await loadPlaydateParentRows(db, String(session.family_b_id));
  const childA = await db.prepare("SELECT name FROM family_members WHERE user_id = ? LIMIT 1").bind(session.child_a_id).first<{ name: string }>();
  const childB = await db.prepare("SELECT name FROM family_members WHERE user_id = ? LIMIT 1").bind(session.child_b_id).first<{ name: string }>();
  const tierA = await effectiveTier(db, String(session.family_a_id));
  const tierB = await effectiveTier(db, String(session.family_b_id));

  const placeName = place?.name ?? "현재 장소";
  const childAName = childA?.name ?? "아이";
  const childBName = childB?.name ?? "친구";
  const familyAPhones = collectParentPhones(parentsA);
  const familyBPhones = collectParentPhones(parentsB);
  const familyAParentIds = collectPlaydateNotificationParentIds(parentsA);
  const familyBParentIds = collectPlaydateNotificationParentIds(parentsB);

  let allowedFamilyAParentIds: string[];
  let allowedFamilyBParentIds: string[];
  const suppressedQuietHours = new Set<string>();
  try {
    const familyAPartition = await partitionNotificationRecipients(db, {
      userIds: familyAParentIds,
      identity: { action: "playdate_started" },
      atMs: Date.now(),
    });
    const familyBPartition = await partitionNotificationRecipients(db, {
      userIds: familyBParentIds,
      identity: { action: "playdate_started" },
      atMs: Date.now(),
    });
    allowedFamilyAParentIds = [...familyAPartition.allowed];
    allowedFamilyBParentIds = [...familyBPartition.allowed];
    for (const userId of familyAPartition.suppressed) suppressedQuietHours.add(userId);
    for (const userId of familyBPartition.suppressed) suppressedQuietHours.add(userId);
  } catch (error) {
    console.error("push-notify playdate-started quiet-hours routing failed:");
    return jsonResponse({ error: "quiet_hours_routing_failed" }, 503);
  }

  if (allowedFamilyAParentIds.length === 0 && allowedFamilyBParentIds.length === 0) {
    return jsonResponse({
      delivered: false,
      sent_count: 0,
      fcm_count: 0,
      webSent: 0,
      fcmSent: 0,
      total: 0,
      suppressedQuietHours: [...suppressedQuietHours].sort(),
    });
  }

  const [tokensA, tokensB] = await Promise.all([
    fetchFcmTokensForUsers(db, allowedFamilyAParentIds),
    fetchFcmTokensForUsers(db, allowedFamilyBParentIds),
  ]);

  const buildPayload = (myChildName: string, friendChildName: string, friendPhones: string[], myTier: string) => ({
    title: "친구놀이 시작",
    body: `${myChildName}가 ${placeName}에서 ${friendChildName}와 놀고 있어요`,
    data: {
      type: "playdate_started",
      action: "playdate_started",
      tier: myTier === "premium" ? "premium" : "free",
      session_id: String(session.id),
      place_name: placeName,
      my_child_name: myChildName,
      friend_child_name: friendChildName,
      friend_family_phones: JSON.stringify(friendPhones),
    } as Record<string, string>,
  });

  const payloadA = buildPayload(childAName, childBName, familyBPhones, tierA);
  const payloadB = buildPayload(childBName, childAName, familyAPhones, tierB);

  const expiredIds: string[] = [];
  let sentCount = 0;
  for (const t of tokensA) {
    const result = await sendFcmNotification(env, t.fcm_token, payloadA.title, payloadA.body, payloadA.data);
    if (result === "sent") sentCount++;
    else if (result === "expired") expiredIds.push(t.id);
  }
  for (const t of tokensB) {
    const result = await sendFcmNotification(env, t.fcm_token, payloadB.title, payloadB.body, payloadB.data);
    if (result === "sent") sentCount++;
    else if (result === "expired") expiredIds.push(t.id);
  }
  await disableFcmTokensByIds(db, expiredIds);

  return jsonResponse({
    delivered: sentCount > 0,
    sent_count: sentCount,
    fcm_count: tokensA.length + tokensB.length,
    webSent: 0,
    fcmSent: sentCount,
    total: allowedFamilyAParentIds.length + allowedFamilyBParentIds.length,
    suppressedQuietHours: [...suppressedQuietHours].sort(),
  });
}

export async function handlePlaydateEnded(env: PushEnv, db: D1Database, body: Record<string, any>, callerUserId: string, callerRole: string): Promise<Response> {
  const sessionId = typeof body.session_id === "string" ? body.session_id : "";
  if (!sessionId) return jsonResponse({ error: "session_id_required" }, 400);

  const session = await db
    .prepare("SELECT id, public_place_id, family_a_id, family_b_id, child_a_id, child_b_id, stopped_at, stop_reason FROM friend_playdate_sessions WHERE id = ? LIMIT 1")
    .bind(sessionId)
    .first<Record<string, any>>();
  if (!session) return jsonResponse({ error: "session_not_found" }, 404);
  if (!session.stopped_at) return jsonResponse({ error: "session_not_stopped" }, 422);

  const isService = callerRole === "service_role";
  if (!isService && callerUserId !== session.child_a_id && callerUserId !== session.child_b_id) {
    return jsonResponse({ error: "forbidden" }, 403);
  }

  const place = await db.prepare("SELECT name FROM public_places WHERE id = ? LIMIT 1").bind(session.public_place_id).first<{ name: string }>();
  const parentsA = await loadPlaydateParentRows(db, String(session.family_a_id));
  const parentsB = await loadPlaydateParentRows(db, String(session.family_b_id));

  const placeName = place?.name ?? "현재 장소";
  const stopReason = (session.stop_reason as string) ?? "child_end";
  const familyAParentIds = collectPlaydateNotificationParentIds(parentsA);
  const familyBParentIds = collectPlaydateNotificationParentIds(parentsB);

  let allowedFamilyAParentIds: string[];
  let allowedFamilyBParentIds: string[];
  const suppressedQuietHours = new Set<string>();
  try {
    const familyAPartition = await partitionNotificationRecipients(db, {
      userIds: familyAParentIds,
      identity: { action: "playdate_ended" },
      atMs: Date.now(),
    });
    const familyBPartition = await partitionNotificationRecipients(db, {
      userIds: familyBParentIds,
      identity: { action: "playdate_ended" },
      atMs: Date.now(),
    });
    allowedFamilyAParentIds = [...familyAPartition.allowed];
    allowedFamilyBParentIds = [...familyBPartition.allowed];
    for (const userId of familyAPartition.suppressed) suppressedQuietHours.add(userId);
    for (const userId of familyBPartition.suppressed) suppressedQuietHours.add(userId);
  } catch (error) {
    console.error("push-notify playdate-ended quiet-hours routing failed:");
    return jsonResponse({ error: "quiet_hours_routing_failed" }, 503);
  }

  if (allowedFamilyAParentIds.length === 0 && allowedFamilyBParentIds.length === 0) {
    return jsonResponse({
      delivered: false,
      sent_count: 0,
      fcm_count: 0,
      webSent: 0,
      fcmSent: 0,
      total: 0,
      suppressedQuietHours: [...suppressedQuietHours].sort(),
    });
  }

  const [tokensA, tokensB] = await Promise.all([
    fetchFcmTokensForUsers(db, allowedFamilyAParentIds),
    fetchFcmTokensForUsers(db, allowedFamilyBParentIds),
  ]);

  const data: Record<string, string> = {
    type: "playdate_ended",
    action: "playdate_ended",
    session_id: String(session.id),
    stop_reason: stopReason,
    place_name: placeName,
  };
  const title = "친구놀이 종료";
  const endBody = `${placeName} 친구놀이가 종료됐어요`;

  const expiredIds: string[] = [];
  let sentCount = 0;
  for (const t of [...tokensA, ...tokensB]) {
    const result = await sendFcmNotification(env, t.fcm_token, title, endBody, data);
    if (result === "sent") sentCount++;
    else if (result === "expired") expiredIds.push(t.id);
  }
  await disableFcmTokensByIds(db, expiredIds);

  return jsonResponse({
    delivered: sentCount > 0,
    sent_count: sentCount,
    fcm_count: tokensA.length + tokensB.length,
    webSent: 0,
    fcmSent: sentCount,
    total: allowedFamilyAParentIds.length + allowedFamilyBParentIds.length,
    suppressedQuietHours: [...suppressedQuietHours].sort(),
  });
}

// ── route ────────────────────────────────────────────────────────────────────
push.options("/memo-display-authorize", () => new Response(null, {
  status: 204,
  headers: {
    "Cache-Control": "no-store",
  },
}));

// 공개 endpoint지만 permit의 HMAC과 짧은 exp가 호출 권한이다. 응답은 관계·차단
// 세부정보를 노출하지 않고 allowed boolean 하나로만 닫는다.
push.post("/memo-display-authorize", async (c) => {
  const secret = c.env.PUSH_INTERNAL_SECRET || "";
  if (!secret) return memoDisplayAuthorizationResponse(false, 503);

  const contentType = (c.req.header("Content-Type") || "").split(";", 1)[0].trim().toLowerCase();
  if (contentType !== "application/json") {
    return memoDisplayAuthorizationResponse(false, 415);
  }
  const declaredLength = (c.req.header("Content-Length") || "").trim();
  if (declaredLength) {
    if (!/^\d{1,10}$/.test(declaredLength)) {
      return memoDisplayAuthorizationResponse(false, 400);
    }
    if (Number(declaredLength) > MEMO_DISPLAY_AUTH_MAX_BODY_BYTES) {
      return memoDisplayAuthorizationResponse(false, 413);
    }
  }

  const boundedBody = await readBoundedMemoAuthorizationBody(c.req.raw);
  if (!boundedBody.ok) return memoDisplayAuthorizationResponse(false, boundedBody.status);
  const raw = boundedBody.text;

  let permit = "";
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return memoDisplayAuthorizationResponse(false, 400);
    }
    const record = parsed as Record<string, unknown>;
    if (Object.keys(record).length !== 1 || typeof record.permit !== "string") {
      return memoDisplayAuthorizationResponse(false, 400);
    }
    permit = record.permit;
  } catch {
    return memoDisplayAuthorizationResponse(false, 400);
  }

  const payload = await verifyMemoDisplayPermit(secret, permit);
  if (!payload) return memoDisplayAuthorizationResponse(false);
  try {
    const allowed = await isMemoDisplayPermitAllowed(c.env.DB, payload);
    return memoDisplayAuthorizationResponse(allowed);
  } catch {
    return memoDisplayAuthorizationResponse(false, 503);
  }
});

push.post("/", async (c) => {
  const env = c.env as PushEnv;
  const db = c.env.DB;

  const authHeader = c.req.header("Authorization") || "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  const internalSecret = (c.req.header("x-internal-secret") || "").trim();
  const headerIdemKey = c.req.header("Idempotency-Key") || null;

  // 인증: 내부 시크릿(service_role) 또는 사용자 JWT(서명검증). 둘 다 아니면 401.
  let callerUserId = "";
  let callerRole = "authenticated";
  if (env.PUSH_INTERNAL_SECRET && timingSafeEqualStr(internalSecret, env.PUSH_INTERNAL_SECRET)) {
    callerRole = "service_role";
  } else if (token) {
    try {
      const claims = await verifyAccessToken(c.env, token);
      callerUserId = claims.sub;
      callerRole = "authenticated"; // 사용자 JWT 는 service_role 로 승격하지 않음(원본 보존).
    } catch {
      return jsonResponse({ error: "invalid jwt" }, 401);
    }
  } else {
    return jsonResponse({ error: "missing auth" }, 401);
  }

  let body: Record<string, any> | null = null;
  try {
    const raw = await c.req.text();
    if (raw && raw.trim()) body = JSON.parse(raw);
  } catch {
    body = null;
  }

  const pushDispatchMutationLeases = await acquirePushDispatchMutationLeases(
    db,
    body,
    callerUserId,
    callerRole,
  );
  if (pushDispatchMutationLeases.status !== "acquired") {
    return jsonResponse(
      { error: pushDispatchMutationLeases.status === "blocked" ? "account_mutation_blocked" : "account_mutation_unavailable" },
      pushDispatchMutationLeases.status === "blocked" ? 409 : 503,
    );
  }

  try {
    if (body?.action === "parent_alert" && callerRole !== "service_role") {
      return await handleVerifiedLegacyParentAlertNotification(env, db, body, callerUserId);
    }
    if (body?.action === "new_memo" && callerRole !== "service_role") {
      return await handleVerifiedLegacyMemoNotification(env, db, body, callerUserId);
    }
    if (
      SERVER_DERIVED_NOTIFICATION_ACTIONS.has(String(body?.action ?? ""))
      && callerRole !== "service_role"
    ) {
      return jsonResponse({ error: "server_derived_notification_only" }, 403);
    }
    if (body?.action === "playdate_started") return await handlePlaydateStarted(env, db, body, callerUserId, callerRole);
    if (body?.action === "playdate_ended") return await handlePlaydateEnded(env, db, body, callerUserId, callerRole);
    if (body?.action === "force_ring") return await handleForceRing(env, db, body, callerUserId);
    if (body?.action === "force_ring_stop") return await handleForceRingStop(env, db, body, callerUserId);
    if (body?.action === "force_ring_reminder") return await handleForceRingReminder(env, db, callerRole);
    if (body?.action === "teacher_batch") return await handleTeacherBatch(env, db, body, callerRole);
    if (body?.action === "teacher_notice") return await handleTeacherNotice(env, db, body, callerUserId, callerRole);
    if (
      body?.action === "new_event" || body?.action === "new_memo" || body?.action === "kkuk" ||
      body?.action === "parent_alert" || body?.action === "child_safety" ||
      body?.action === "remote_listen" || body?.action === "remote_listen_stop" ||
      body?.action === "request_location" || body?.action === "request_device_status" ||
      body?.action === "emergency" || body?.action === "sos"
    ) {
      return await handleInstantNotification(env, db, body, callerUserId, callerRole, headerIdemKey);
    }
    // cron mode는 내부 스케줄러 전용이다. 사용자 JWT의 미인식 action이 전체 cron을
    // 실행하는 우회로가 되지 않도록 닫는다.
    if (callerRole !== "service_role") return jsonResponse({ error: "unsupported_action" }, 400);
    return await handleCronNotification(env, db);
  } catch (err) {
    console.error("push-notify error:");
    return jsonResponse({ error: "internal" }, 500);
  } finally {
    await releaseAccountMutationLeases(db, pushDispatchMutationLeases.leases);
  }
});

export default push;
