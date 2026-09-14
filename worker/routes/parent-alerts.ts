// 부모 알림 read API. get_parent_alerts(p_family_id, p_limit=20) RPC를 D1 SQL로 직역.
// 핵심: read 는 가족 전역 boolean → 사용자별로 (pa.read OR 호출자 ∈ read_by) 계산.
//   레거시 행(read=true)은 "전원 읽음"으로 유지, 신규 행은 호출자 기준.
import { normalizeNotificationCopy, type NotificationCopy } from "../../shared/notificationCopy.ts";
import { resolvePublicParentAlertCopy } from "../lib/notificationCopy.ts";
import { readFamilyTimeZone } from "../lib/timeZone.ts";
import { Hono } from "hono";
import type { Env, Vars } from "../types";
import { requireAuth } from "../middleware/auth";
import { pgNow } from "../lib/time";
import { parseJson, pgArray, toPgArray } from "../lib/serialize";
import { notifyPg } from "../lib/realtime";
import { parentAlertPendingTtlMs } from "../lib/notificationRouting";
import {
  handleInstantNotification,
  insertParentAlertV2,
  sendChildSafetyNotification,
} from "./push-notify";
import type { PushEnv } from "../lib/pushEnv";
import { loadParentAlertRecipients } from "../lib/parentAlertRecipients";
import { eventOccurrenceAlertId } from "../lib/eventOccurrence";
import {
  parentAlertDeliveryKey,
  parentAlertPendingId,
} from "../lib/parentAlertDedupe";
import {
  canReadParentAlerts,
  resolveParentAlertWriteScope,
} from "../lib/parentAlertAuthorization";
import { parentAlertTargetRoute } from "../lib/parentAlertRoute";
import { resolveParentAlertPushType } from "../lib/parentAlertPushPolicy";
import { resolveLegacyChildScheduleAlertEvidence } from "../lib/legacyScheduleAlertEvidence";
import { resolveAiCreditRequestEvidence } from "../lib/aiCreditRequestGate";
import {
  registeredPlacePresenceMetadata,
  resolveRegisteredPlacePresenceDedupe,
} from "../lib/registeredPlacePresenceDedupe";
import {
  recordLocationAlertProvisionToParents,
  resolveLocationAlertConfirmation,
} from "../lib/locationConfirmationAudit";
import { prepareRegisteredPlaceAlertOccurrence } from "../lib/parentAlertOccurrence";

export { resolveParentAlertPushType } from "../lib/parentAlertPushPolicy";

// WS(notifyPg)는 앱이 켜져 있을 때만 도달한다. 일정 도착/미도착·등록장소 출입도
// 부모가 백그라운드일 때 놓치지 않도록 insert 성공 시 FCM을 연쇄하되, SOS와
// 일반 부모 알림의 type/urgent를 분리해 미도착을 SOS 화면으로 잘못 승격하지 않는다.
const SCHEDULE_OCCURRENCE_ALERT_TYPES = new Set([
  "arrived", "late_arrived", "not_arrived", "missed_arrival",
]);

async function queueParentAlertPending(
  db: D1Database,
  args: {
    pushId: string;
    familyId: string;
    parentIds: Set<string>;
    title: string;
    message: string;
    notificationCopy?: NotificationCopy | null;
    alertType: string;
    severity: string;
    sourceEventId: string | null;
    alertId: string;
    childUserId: string | null;
    route: string;
    occurredAt: string | null;
    expiresAt: string | null;
    pushPolicy: {
      type: "sos" | "parent_alert";
      urgent: boolean;
      route: "/sos-receive" | "/notifications" | "/ai-credit" | "/child-digest";
    };
  },
): Promise<void> {
  if (args.parentIds.size === 0) return;
  const now = pgNow();
  const requestedExpiresAtMs = Date.parse(String(args.expiresAt ?? ""));
  const expiresAt = Number.isFinite(requestedExpiresAtMs)
    ? new Date(requestedExpiresAtMs).toISOString().replace("T", " ").replace("Z", "+00")
    : new Date(Date.now() + parentAlertPendingTtlMs(args.alertType))
      .toISOString().replace("T", " ").replace("Z", "+00");
  const stmt = db.prepare(
    `INSERT OR IGNORE INTO pending_notifications
       (id, family_id, title, body, data, delivered, delivery_status, idempotency_key, expires_at, created_at)
     VALUES (?,?,?,?,?,0,?,?,?,?)`,
  );
  await db.batch([...args.parentIds].map((parentUserId) => stmt.bind(
    parentAlertPendingId(args.pushId, parentUserId),
    args.familyId,
    args.title,
    args.message,
    JSON.stringify({
      type: args.pushPolicy.type,
      action: args.pushPolicy.type,
      familyId: args.familyId,
      pushId: args.pushId,
      alertType: args.alertType,
      ...(args.notificationCopy ? { notificationCopy: JSON.stringify(args.notificationCopy) } : {}),
      severity: args.severity,
      urgent: args.pushPolicy.urgent,
      route: args.route,
      alertId: args.alertId,
      ...(args.childUserId ? { childUserId: args.childUserId } : {}),
      targetRole: "parent",
      targetUserId: parentUserId,
      ...(args.occurredAt ? { occurredAt: args.occurredAt } : {}),
      expiresAt,
      ...(args.sourceEventId ? { eventId: args.sourceEventId } : {}),
    }),
    JSON.stringify({ queued: true, targetUserId: parentUserId }),
    parentAlertPendingId(args.pushId, parentUserId),
    expiresAt,
    now,
  )));
}

function parentAlertPushId(alertId: string, alertType: string, eventId: string | null): string {
  return parentAlertDeliveryKey(alertType, eventId ?? alertId);
}

const parentAlerts = new Hono<{ Bindings: Env; Variables: Vars }>();

const DEFAULT_LIMIT = 20;

// GET /api/parent-alerts?family_id=...&limit=N
parentAlerts.get("/", requireAuth, async (c) => {
  const familyId = c.req.query("family_id") ?? "";
  const user = c.get("user");
  // p_limit DEFAULT 20, GREATEST(...,1) — 미지정/0/음수면 20.
  const limitRaw = Number(c.req.query("limit"));
  const limit = Number.isFinite(limitRaw) && limitRaw >= 1 ? Math.floor(limitRaw) : DEFAULT_LIMIT;

  if (!(await canReadParentAlerts(c.env.DB, user.sub, familyId))) {
    return c.json({ error: "forbidden" }, 403);
  }

  // 활성 자녀 격리: superseded/unpair 옛 자녀(is_active=0 또는 삭제됨)에게 귀속된 알림은
  // 부모 목록에서 제외한다. child_user_id IS NULL(가족 단위 알림)과 현재 활성 자녀 귀속
  // 알림은 유지 → 부모 화면에 보이는 페어링 자녀 관련 알림만 남는다.
  const { results } = await c.env.DB.prepare(
    `WITH ranked AS (
       SELECT id, alert_type, title, message, severity, event_id, child_user_id,
              metadata, read, read_by, created_at,
              ROW_NUMBER() OVER (
                PARTITION BY CASE
                  WHEN event_id IS NOT NULL AND event_id <> '' THEN event_id || ':' || alert_type
                  ELSE id
                END
                ORDER BY substr(created_at,1,19) ASC, id ASC
              ) AS rn
         FROM parent_alerts
        WHERE family_id = ?1
          AND (child_user_id IS NULL OR child_user_id = '' OR child_user_id IN (
                SELECT user_id FROM family_members
                 WHERE family_id = ?1 AND role = 'child' AND is_active = 1))
     )
     SELECT id, alert_type, title, message, severity, event_id, child_user_id,
            metadata, read, read_by, created_at
       FROM ranked
      WHERE rn = 1
      ORDER BY created_at DESC
      LIMIT ?2`,
  )
    .bind(familyId, limit)
    .all<Record<string, unknown>>();

  // get_parent_alerts 반환 컬럼: read 를 (전역 read OR 호출자 ∈ read_by)로 계산하고
  // read_by 는 응답에서 노출하지 않는다(원본 RPC TABLE 시그니처와 동일).
  const out = (results ?? []).map((a) => {
    const globalRead = !!a.read && a.read !== "0";
    const readBy = pgArray(a.read_by);
    const { read_by: _omit, ...rest } = a;
    return { ...rest, metadata: parseJson(a.metadata), read: globalRead || readBy.includes(user.sub) };
  });

  return c.json(out);
});

// ── write ─────────────────────────────────────────────────────────────────────

// POST /api/parent-alerts — insert_parent_alert_v2 (멱등: event_id+alert_type dedup).
// 반환: 생성/기존 alert 의 uuid (RPC RETURNS uuid 계약).
// body:{ family_id, alert_type, title, message, severity?, event_id?, child_user_id? }
parentAlerts.post("/", requireAuth, async (c) => {
  const user = c.get("user");
  const b = await c.req.json<Record<string, string | null>>();
  const familyId = String(b.family_id ?? "");
  const requestedAlertType = String(b.alert_type ?? "");
  const requestedChildUserId = b.child_user_id ? String(b.child_user_id) : null;
  const legacyScheduleEvidence = await resolveLegacyChildScheduleAlertEvidence(c.env.DB, {
    callerUserId: user.sub,
    familyId,
    requestedChildUserId,
    requestedAlertType,
    sourceEventId: b.source_event_id ? String(b.source_event_id) : null,
    eventId: b.event_id ? String(b.event_id) : null,
  });
  if (legacyScheduleEvidence?.status === "deferred") {
    return c.json({ accepted: true, server_derived: true }, 202);
  }

  let writeScope = legacyScheduleEvidence?.status === "verified"
    ? legacyScheduleEvidence.writeScope
    : await resolveParentAlertWriteScope(c.env.DB, {
      callerUserId: user.sub,
      familyId,
      alertType: requestedAlertType,
      requestedChildUserId,
    });
  if (!writeScope) return c.json({ error: "forbidden" }, 403);

  const alertType = legacyScheduleEvidence?.status === "verified"
    ? legacyScheduleEvidence.alertType
    : requestedAlertType;
  const severity = legacyScheduleEvidence?.status === "verified"
    ? legacyScheduleEvidence.severity
    // 아이가 보내는 충전 요청은 긴급도를 올릴 수 없다(안전 알림 톤 잠식 방지).
    : alertType === "ai_credit_request"
      ? "info"
      : String(b.severity ?? "info");
  const pushPolicy = resolveParentAlertPushType(alertType, severity);
  let eventId = b.event_id ? String(b.event_id) : null;
  let sourceEventId = b.source_event_id ? String(b.source_event_id) : null;
  if (legacyScheduleEvidence?.status === "verified") {
    eventId = legacyScheduleEvidence.eventId;
    sourceEventId = legacyScheduleEvidence.sourceEventId;
  }
  // 구버전 Android가 원본 event id만 보내도 현재 occurrence(date+revision)로 승격한다.
  // 새 앱은 event_id=occurrence, source_event_id=원본 id를 함께 보내 cleanup 연결을 보존한다.
  if (eventId && SCHEDULE_OCCURRENCE_ALERT_TYPES.has(alertType) && !sourceEventId) {
    const event = await c.env.DB.prepare(
      "SELECT id, date_key, updated_at FROM events WHERE family_id = ? AND id = ? LIMIT 1",
    ).bind(familyId, eventId).first<{ id: string; date_key: string; updated_at: string }>();
    if (event?.id) {
      sourceEventId = event.id;
      eventId = eventOccurrenceAlertId({
        eventId: event.id,
        dateKey: String(event.date_key),
        updatedAt: String(event.updated_at ?? ""),
      });
    }
  }

  let title = legacyScheduleEvidence?.status === "verified"
    ? legacyScheduleEvidence.title
    : String(b.title ?? "");
  let message = legacyScheduleEvidence?.status === "verified"
    ? legacyScheduleEvidence.message
    : String(b.message ?? "");

  // 아이가 보낸 AI 대화 충전 요청은 본문을 신뢰하지 않는다. 오늘 정말 다 썼는지 서버가
  // 다시 판정하고, 부모가 읽을 문구도 소진 원인에 맞춰 서버가 만든다.
  let aiCreditRequestMetadata: Record<string, unknown> | null = null;
  if (alertType === "ai_credit_request") {
    const evidence = await resolveAiCreditRequestEvidence(c.env.DB, {
      familyId,
      childUserId: writeScope.childUserId ?? "",
    });
    if (evidence.status !== "ok") {
      const rejected = evidence.error;
      return c.json({ error: rejected }, rejected === "forbidden" ? 403 : 409);
    }
    // 최근에 이미 부탁했으면 부모 알림을 새로 만들지 않고 성공으로 닫는다(도배 방지).
    if (evidence.evidence.duplicate) {
      return c.json({ accepted: true, duplicate: true, reason: evidence.evidence.reason }, 202);
    }
    title = evidence.evidence.title;
    message = evidence.evidence.message;
    aiCreditRequestMetadata = evidence.evidence.metadata;
  }
  // 등록장소 출입은 자녀 네이티브와 서버 cron 이 같은 방문을 각자 평가한다. episode 시각이
  // 서로 달라 10분 버킷 멱등키가 갈리면 부모에게 같은 알림이 두 번 갔다(2026-07-24 실사고).
  // 장소 단위 쿨다운으로 판정해 두 번째 평가자의 알림은 만들지도 보내지도 않는다.
  // dedup 판정 실패로 안전 알림을 막지 않는다(fail-open) — cron 경로와 같은 계약이다.
  const presenceDedupe = await resolveRegisteredPlacePresenceDedupe(c.env.DB, {
    familyId,
    childUserId: writeScope.childUserId,
    alertType,
    eventId,
    placeKey: b.place_key ? String(b.place_key) : null,
  }).catch((e) => {
    console.error("parent alert presence dedupe check failed:");
    return null;
  });
  if (presenceDedupe?.duplicateAlertId) {
    // 기존 alert id 로 성공 응답 — 호출자(네이티브)는 상태를 진행하고 재시도하지 않는다.
    return c.json(presenceDedupe.duplicateAlertId);
  }
  const notificationAtMs = Date.now();
  const familyTimeZone = await readFamilyTimeZone(c.env.DB, familyId);
  const occurrence = prepareRegisteredPlaceAlertOccurrence({
    timeZone: familyTimeZone,
    alertType,
    message,
    occurredAt: b.occurred_at,
    nowMs: notificationAtMs,
  });
  message = occurrence.message;
  const baseCopy = await resolvePublicParentAlertCopy(c.env.DB, { familyId, childUserId: writeScope.childUserId, alertType, placeKey: presenceDedupe?.placeKey ?? b.place_key, sourceEventId });
  const notificationCopy = baseCopy ? normalizeNotificationCopy({ ...baseCopy, occurredAt: occurrence.occurredAt, timeZone: familyTimeZone }) : null;
  const baseMetadata = aiCreditRequestMetadata
    ?? (presenceDedupe
      ? registeredPlacePresenceMetadata(presenceDedupe.placeKey, presenceDedupe.kind)
      : null);
  const alertMetadata = baseMetadata || occurrence.occurredAt || notificationCopy
    ? {
      ...(baseMetadata ?? {}),
      ...(notificationCopy ? { notificationCopy } : {}),
      ...(occurrence.occurredAt ? { occurredAt: occurrence.occurredAt } : {}),
    }
    : null;
  const alertId = await insertParentAlertV2(c.env as unknown as PushEnv, c.env.DB, {
    familyId,
    alertType,
    title,
    message,
    severity,
    eventId,
    childUserId: writeScope.childUserId,
    metadata: alertMetadata,
  });
  if (!alertId) return c.json({ error: "alert_insert_failed" }, 503);
  if (resolveLocationAlertConfirmation(alertType)) {
    try {
      await recordLocationAlertProvisionToParents(c.env.DB, {
        familyId,
        childUserIds: writeScope.childUserId ? [writeScope.childUserId] : [],
        alertType,
        ...(occurrence.occurredAt ? { occurredAt: occurrence.occurredAt } : {}),
      });
    } catch {
      return c.json({ error: "location_confirmation_unavailable" }, 503);
    }
  }

  if (pushPolicy && !occurrence.expired) {
    const pushId = parentAlertPushId(alertId, alertType, eventId);
    const targetRoute = parentAlertTargetRoute(
      pushPolicy.route,
      alertId,
      writeScope.childUserId,
    );
    try {
      const { allowed, suppressed } = await loadParentAlertRecipients(
        c.env.DB,
        familyId,
        alertType,
        notificationAtMs,
      );
      // 네트워크 발송 전에 부모별 deterministic pending을 보장한다. 공통 발송기도
      // 같은 pending id와 push claim을 사용하므로 native·cron 경합이 한 건으로 합쳐진다.
      await queueParentAlertPending(c.env.DB, {
        pushId,
        familyId,
        parentIds: allowed,
        notificationCopy,
        title,
        message,
        alertType,
        severity,
        pushPolicy,
        sourceEventId,
        alertId,
        childUserId: writeScope.childUserId,
        route: targetRoute,
        occurredAt: occurrence.occurredAt,
        expiresAt: occurrence.expiresAt,
      });
      const delivery = await handleInstantNotification(
        c.env as unknown as PushEnv,
        c.env.DB,
        {
          action: pushPolicy.type,
          familyId,
          senderUserId: user.sub,
          title,
          message,
          alertType,
          severity,
          urgent: pushPolicy.urgent,
          route: targetRoute,
          alertId,
          ...(sourceEventId ? { eventId: sourceEventId } : {}),
          ...(occurrence.occurredAt ? { occurredAt: occurrence.occurredAt } : {}),
          idempotency_key: pushId,
        },
        user.sub,
        writeScope.callerRole,
        null,
        {
          notificationCopy,
          atMs: notificationAtMs,
          quietHoursPartition: { allowed, suppressed },
        },
      );
      if (!delivery.ok) return c.json({ error: "parent_alert_delivery_failed" }, 503);
      const childDeliveryOk = writeScope.childUserId
        ? await sendChildSafetyNotification(
          c.env as unknown as PushEnv,
          c.env.DB,
          {
            familyId,
            childUserId: writeScope.childUserId,
            alertType,
            idempotencyKey: pushId,
          },
        )
        : true;
      if (!childDeliveryOk) return c.json({ error: "child_safety_delivery_failed" }, 503);
    } catch (e) {
      console.error("parent alert pending/delivery failed:");
      return c.json({ error: "pending_queue_failed" }, 503);
    }
  }
  return c.json(alertId);
});

// POST /api/parent-alerts/read-all — 가족의 내 미읽음 전부 읽음(호출자 read_by 일괄 append).
// "모두 읽음"이 알림당 1요청(N회 왕복)이라 느리던 것을 단일 UPDATE 로 대체.
// 조건: 전역 read=1(레거시 전원읽음) 제외 + 이미 내 uid 가 read_by 에 있으면 제외(멱등).
parentAlerts.post("/read-all", requireAuth, async (c) => {
  const user = c.get("user");
  const b = await c.req.json<{ family_id?: string }>().catch(() => ({}) as { family_id?: string });
  const familyId = b.family_id ?? "";
  if (!(await canReadParentAlerts(c.env.DB, user.sub, familyId))) {
    return c.json({ error: "forbidden" }, 403);
  }
  // read_by 는 Postgres 배열 텍스트('{}'/'{uid,uid}') — SQL 문자열 조작으로 일괄 append.
  // uid 는 UUID 라 instr 부분일치 오탐 없음.
  const res = await c.env.DB.prepare(
    `UPDATE parent_alerts
        SET read_by = CASE
          WHEN read_by IS NULL OR read_by = '' OR read_by = '{}' THEN '{' || ?2 || '}'
          ELSE rtrim(read_by, '}') || ',' || ?2 || '}'
        END
      WHERE family_id = ?1
        AND (read IS NULL OR read = 0 OR read = '0')
        AND (read_by IS NULL OR instr(read_by, ?2) = 0)`,
  )
    .bind(familyId, user.sub)
    .run();
  const updated = res.meta?.changes ?? 0;
  if (updated > 0) {
    // 다른 기기 캐시 무효화용 브로드캐스트 1회(개별 행 이벤트 대신).
    await notifyPg(c.env, familyId, "parent_alerts", "UPDATE", { read_all: true, by: user.sub }, null);
  }
  return c.json({ ok: true, updated });
});

// POST /api/parent-alerts/:id/read — mark_alert_read (호출자 read_by 멱등 append)
parentAlerts.post("/:id/read", requireAuth, async (c) => {
  const id = c.req.param("id");
  const user = c.get("user");
  const row = await c.env.DB.prepare(`SELECT family_id, read_by FROM parent_alerts WHERE id = ?`)
    .bind(id).first<{ family_id: string; read_by: string }>();
  if (!row) return c.json({ ok: true });
  if (!(await canReadParentAlerts(c.env.DB, user.sub, row.family_id))) {
    return c.json({ error: "forbidden" }, 403);
  }
  const arr = pgArray(row.read_by);
  if (!arr.includes(user.sub)) {
    arr.push(user.sub);
    await c.env.DB.prepare(`UPDATE parent_alerts SET read_by = ? WHERE id = ?`)
      .bind(toPgArray(arr), id).run();
    await notifyPg(c.env, row.family_id, "parent_alerts", "UPDATE", { id, read: true }, null);
  }
  return c.json({ ok: true });
});

export default parentAlerts;
