// Cron 공용 푸시 발송 헬퍼 — 원본 cron 들의 deliverAlert(fetch(push-notify) +
// insert_parent_alert_v2) 를 Worker 내부 호출로 직역한다. push-notify 라우트의
// 검증된 발송 핸들러(handleInstantNotification)를 그대로 호출 → FCM·Web Push·
// pending_notifications·멱등성(push_idempotency) 전부 원본 push-notify 경로와 동일.
// self-fetch(dev 불안정) 대신 함수 직접 호출. parent_alert 기록은 insert_parent_alert_v2.
//
// FCM 키 미설정(현 dev) → 발송은 graceful 실패(handleInstantNotification 은 200 반환,
// sent=0). 그래도 insert_parent_alert_v2 는 수행 → 알림 행은 DB 에 남아 검증 가능.
import type { PushEnv } from "../lib/pushEnv";
import { parentAlertDeliveryKey } from "../lib/parentAlertDedupe";
import { parentAlertTargetRoute } from "../lib/parentAlertRoute";
import { resolveParentAlertPushType } from "../lib/parentAlertPushPolicy";
import {
  handleInstantNotification,
  insertParentAlertV2,
  sendChildSafetyNotification,
} from "../routes/push-notify";
import {
  registeredPlacePresenceMetadata,
  resolveRegisteredPlacePresenceDedupe,
} from "../lib/registeredPlacePresenceDedupe";
import {
  resolveUnregisteredStayDedupe,
  unregisteredStayMetadata,
} from "../lib/unregisteredStayPresenceDedupe";
import { recordLocationAlertProvisionToParents } from "../lib/locationConfirmationAudit";
import { prepareRegisteredPlaceAlertOccurrence } from "../lib/parentAlertOccurrence";

export interface AlertCopy {
  alertType: string;
  severity: string;
  title: string;
  message: string;
  metadata?: Record<string, unknown> | null;
}

// 불변식(활성기기 격리): 모든 caller 는 childUserId 로 반드시 is_active=1 인 현재 페어링
// 자녀만 전달해야 한다(각 cron 의 자녀 로더가 AND is_active=1 로 게이팅함). 여기서는
// 재검증하지 않는다 — hot path 이고 caller 가 보장한다.
// 부모 알림 발송 — parent_alerts 멱등 기록을 먼저 확보한 뒤 push를 보낸다.
// DB 기록 실패 뒤 push만 도착하는 고아 알림을 막고, 같은 event_id+alert_type 재시도는
// insertParentAlertV2가 기존 id를 반환하므로 상태머신이 안전하게 이어진다.
// 각 cron 은 원본 반환 규약대로 매핑:
//   geofence  : delivered = pushOk && alertId!=null
//   danger/stay: delivered = pushOk (rpc 실패는 로그만)
//   staleness : alert 는 push 실패해도 항상 기록, state 는 전이(다음 첫 알림에 안 멈춤)
export async function deliverParentAlert(
  env: PushEnv,
  db: D1Database,
  args: {
    familyId: string;
    childUserId: string; // senderUserId = 자녀 본인 기기 수신 제외, 부모 수신
    alert: AlertCopy;
    idempotencyKey: string;
    sourceEventId?: string | null;
    metadata?: Record<string, unknown> | null;
    occurredAtMs?: number;
    // 등록장소 출입 알림이면 평가한 장소 키 — 장소 단위 쿨다운 dedup 스코프.
    presencePlaceKey?: string | null;
    // 미등록 체류 알림이면 평가한 grid_key — 거친 지역 단위 쿨다운 dedup 스코프.
    stayGridKey?: string | null;
  },
): Promise<{ pushOk: boolean; alertId: string | null; suppressedQuietHours: string[] }> {
  const { familyId, childUserId, alert, idempotencyKey } = args;

  // 자녀 네이티브가 같은 방문을 이미 알렸으면(episode 시각 차이로 멱등키가 갈려도)
  // 여기서 멈춘다. pushOk=true 로 돌려줘 cron 상태머신은 정상 진행시킨다 — 전이 자체는
  // 실제로 일어났고 부모는 이미 알림을 받았기 때문이다(2026-07-24 중복 실사고).
  let presenceMetadata: Record<string, unknown> | null = null;
  try {
    const presenceDedupe = await resolveRegisteredPlacePresenceDedupe(db, {
      familyId,
      childUserId,
      alertType: alert.alertType,
      eventId: idempotencyKey,
      placeKey: args.presencePlaceKey ?? null,
    });
    if (presenceDedupe?.duplicateAlertId) {
      return { pushOk: true, alertId: presenceDedupe.duplicateAlertId, suppressedQuietHours: [] };
    }
    if (presenceDedupe) {
      presenceMetadata = registeredPlacePresenceMetadata(presenceDedupe.placeKey, presenceDedupe.kind);
    }
  } catch (e) {
    // dedup 판정 실패로 안전 알림을 막지 않는다(fail-open) — 최악이라도 기존 버킷 dedup 은 남는다.
    console.error("[cron deliver] presence dedupe check failed");
  }

  // 미등록 체류는 11m grid 가 지터로 갈려 같은 체류가 여러 알림이 됐다(2026-07-30 실사고).
  // 거친 지역키(≈110m) 쿨다운으로 두 번째부터는 만들지 않는다.
  let stayMetadata: Record<string, unknown> | null = null;
  try {
    const stayDedupe = await resolveUnregisteredStayDedupe(db, {
      familyId,
      childUserId,
      alertType: alert.alertType,
      gridKey: args.stayGridKey ?? null,
      title: alert.title,
    });
    if (stayDedupe?.duplicateAlertId) {
      return { pushOk: true, alertId: stayDedupe.duplicateAlertId, suppressedQuietHours: [] };
    }
    if (stayDedupe) {
      stayMetadata = unregisteredStayMetadata(stayDedupe.areaKey, stayDedupe.kind);
    }
  } catch (e) {
    console.error("[cron deliver] stay dedupe check failed");
  }

  // ── 기록 절반: insert_parent_alert_v2 (event_id+alert_type 멱등) ──
  const baseMetadata = args.metadata ?? alert.metadata ?? null;
  const scopeMetadata = presenceMetadata ?? stayMetadata ?? null;
  const occurrence = prepareRegisteredPlaceAlertOccurrence({
    alertType: alert.alertType,
    message: alert.message,
    occurredAt: args.occurredAtMs,
    nowMs: Date.now(),
  });
  const mergedMetadata = baseMetadata || scopeMetadata || occurrence.occurredAt
    ? {
      ...(baseMetadata ?? {}),
      ...(scopeMetadata ?? {}),
      ...(occurrence.occurredAt ? { occurredAt: occurrence.occurredAt } : {}),
    }
    : null;
  let alertId: string | null = null;
  try {
    alertId = await insertParentAlertV2(env, db, {
      familyId,
      alertType: alert.alertType,
      title: alert.title,
      message: occurrence.message,
      severity: alert.severity,
      eventId: idempotencyKey,
      childUserId,
      metadata: mergedMetadata,
    });
  } catch (e) {
    console.error("[cron deliver] parent_alert insert failed");
  }
  if (!alertId) return { pushOk: false, alertId: null, suppressedQuietHours: [] };
  try {
    await recordLocationAlertProvisionToParents(db, {
      familyId,
      childUserIds: [childUserId],
      alertType: alert.alertType,
      ...(occurrence.occurredAt ? { occurredAt: occurrence.occurredAt } : {}),
    });
  } catch (e) {
    console.error("[cron deliver] location confirmation failed");
    return { pushOk: false, alertId, suppressedQuietHours: [] };
  }

  // 오래된 episode는 알림 이력에는 남기되 새 pending/FCM/Web Push로 재생하지 않는다.
  if (occurrence.expired) {
    return { pushOk: true, alertId, suppressedQuietHours: [] };
  }

  // ── push 절반: 기록 확보 뒤 검증된 parent_alert/child_safety 경로 재사용 ──
  let pushOk = false;
  let suppressedQuietHours: string[] = [];
  try {
    const deliveryKey = parentAlertDeliveryKey(alert.alertType, idempotencyKey);
    const pushPolicy = resolveParentAlertPushType(alert.alertType, alert.severity);
    const targetRoute = parentAlertTargetRoute(
      pushPolicy?.route ?? "/notifications",
      alertId,
      childUserId,
    );
    const res = await handleInstantNotification(
      env,
      db,
      {
        action: pushPolicy?.type ?? "parent_alert",
        familyId,
        senderUserId: childUserId, // service_role → 이 값이 sender(자녀 제외)
        severity: alert.severity,
        alertType: alert.alertType,
        title: alert.title,
        message: occurrence.message,
        urgent: pushPolicy?.urgent ?? false,
        route: targetRoute,
        alertId,
        ...(args.sourceEventId ? { eventId: args.sourceEventId } : {}),
        ...(occurrence.occurredAt ? { occurredAt: occurrence.occurredAt } : {}),
        idempotency_key: deliveryKey,
      },
      "", // callerUserId (service_role 이라 미사용)
      "service_role",
      null,
    );
    const childPushOk = await sendChildSafetyNotification(env, db, {
      familyId,
      childUserId,
      alertType: alert.alertType,
      idempotencyKey: deliveryKey,
    });
    if (res.ok) {
      const result = await res.clone().json<Record<string, unknown>>().catch(() => null);
      suppressedQuietHours = Array.isArray(result?.suppressedQuietHours)
        ? result.suppressedQuietHours.filter((value): value is string => typeof value === "string")
        : [];
    }
    pushOk = res.ok && childPushOk; // 부모·아이 양쪽이 모두 큐에 들어간 경우만 완료
  } catch (e) {
    console.error("[cron deliver] push send failed");
    pushOk = false;
  }

  return { pushOk, alertId, suppressedQuietHours };
}

// 자동 웨이크 — 끊김(stale) 자녀 기기에 request_location FCM(매 tick 새 requestId →
// push_idempotency dedup 우회). 원본 deliverWake 가 POST 하던 본문 그대로,
// handleInstantNotification 의 request_location(child native command) 라우팅 재사용:
// child 멤버 ∩ targetUserId 만 수신, senderUserId 비움 → 자녀가 제외되지 않는다.
export async function deliverWake(
  env: PushEnv,
  db: D1Database,
  child: { familyId: string; childUserId: string },
): Promise<boolean> {
  try {
    const requestId = crypto.randomUUID();
    const res = await handleInstantNotification(
      env,
      db,
      {
        action: "request_location",
        familyId: child.familyId,
        targetUserId: child.childUserId,
        senderUserId: "",
        reason: "staleness_auto_wake",
        requestId,
        requestedAt: new Date().toISOString(),
        idempotency_key: requestId,
      },
      "",
      "service_role",
      null,
    );
    return res.ok;
  } catch (e) {
    console.error("[cron deliver] wake failed");
    return false;
  }
}
