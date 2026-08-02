import { recordLocationConfirmation } from "./locationConfirmationAudit";

const LEGACY_SCHEDULE_ALERT_TYPES = new Set([
  "arrived",
  "late_arrived",
  "not_arrived",
  "missed_arrival",
]);
const ARRIVAL_RADIUS_M = 80;
const ARRIVAL_STALE_MS = 15 * 60_000;
const ARRIVAL_MAX_ACCURACY_M = 150;
const ARRIVAL_EARLY_MS = 15 * 60_000;
const ARRIVAL_LATE_MS = 60 * 60_000;
const KST_OFFSET_MS = 9 * 60 * 60_000;
const EARTH_RADIUS_M = 6_371_000;

export type LegacyChildScheduleAlertEvidence =
  | { status: "deferred" }
  | {
      status: "verified";
      writeScope: { callerRole: "child"; childUserId: string };
      alertType: "arrived" | "late_arrived";
      title: string;
      message: string;
      severity: "info";
      eventId: string;
      sourceEventId: string;
    };

function parseServerTimestamp(value: unknown): number | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const normalized = value.trim()
    .replace(" ", "T")
    .replace(/\+00(?::?00)?$/, "Z");
  const time = Date.parse(normalized);
  return Number.isFinite(time) ? time : null;
}

function parseEventLocation(value: unknown): { lat: number; lng: number } | null {
  let parsed = value;
  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed) as unknown;
    } catch {
      return null;
    }
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const point = parsed as { lat?: unknown; lng?: unknown };
  const lat = Number(point.lat);
  const lng = Number(point.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
}

function eventStartAtMs(dateKey: string, time: string): number | null {
  const dateMatch = /^(\d{4,})-(\d{1,2})-(\d{1,2})$/.exec(dateKey);
  const timeMatch = /^(\d{1,2}):(\d{2})$/.exec(time);
  if (!dateMatch || !timeMatch) return null;
  const year = Number(dateMatch[1]);
  const month = Number(dateMatch[2]);
  const day = Number(dateMatch[3]);
  const hour = Number(timeMatch[1]);
  const minute = Number(timeMatch[2]);
  if (month < 0 || month > 11 || day < 1 || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    return null;
  }
  const value = Date.UTC(year, month, day, hour - 9, minute);
  const roundTrip = new Date(value + KST_OFFSET_MS);
  if (
    roundTrip.getUTCFullYear() !== year
    || roundTrip.getUTCMonth() !== month
    || roundTrip.getUTCDate() !== day
    || roundTrip.getUTCHours() !== hour
    || roundTrip.getUTCMinutes() !== minute
  ) return null;
  return value;
}

function distanceM(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const toRad = (degrees: number) => degrees * Math.PI / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function occurrenceId(event: { id: string; date_key: string; updated_at: string | null }): string {
  const revision = String(event.updated_at || "").replace(/[^0-9A-Za-z]/g, "").slice(0, 32) || "legacy";
  return `${event.id}:${event.date_key}:${revision}`;
}

export async function resolveLegacyChildScheduleAlertEvidence(
  db: D1Database,
  input: {
    callerUserId: string;
    familyId: string;
    requestedChildUserId: string | null;
    requestedAlertType: string;
    sourceEventId: string | null;
    eventId: string | null;
    nowMs?: number;
  },
): Promise<LegacyChildScheduleAlertEvidence | null> {
  if (!LEGACY_SCHEDULE_ALERT_TYPES.has(input.requestedAlertType)) return null;
  if (
    !input.callerUserId
    || !input.familyId
    || (input.requestedChildUserId && input.requestedChildUserId !== input.callerUserId)
  ) return null;

  const child = await db
    .prepare(
      `SELECT id, name FROM family_members
        WHERE family_id = ? AND user_id = ? AND role = 'child' AND is_active = 1
        LIMIT 1`,
    )
    .bind(input.familyId, input.callerUserId)
    .first<{ id: string; name: string | null }>();
  if (!child?.id) return null;

  // 미도착은 부모 안전에 직접 영향을 주므로 클라이언트 판정을 절대 저장하지 않는다.
  // 기존 Android에는 성공으로 응답해 반복 전송만 멈추고, 정본 Worker cron이 판정한다.
  if (input.requestedAlertType === "not_arrived" || input.requestedAlertType === "missed_arrival") {
    return { status: "deferred" };
  }

  const sourceEventId = (input.sourceEventId || input.eventId || "").trim();
  if (!sourceEventId) return { status: "deferred" };
  const event = await db
    .prepare(
      `SELECT e.id, e.date_key, e.title, e.time, e.location, e.updated_at
         FROM events e
        WHERE e.id = ?1 AND e.family_id = ?2
          AND (
            e.is_family_event = 1
            OR EXISTS (
              SELECT 1 FROM events_children ec
               WHERE ec.event_id = e.id AND ec.child_id = ?3
            )
          )
        LIMIT 1`,
    )
    .bind(sourceEventId, input.familyId, child.id)
    .first<{
      id: string;
      date_key: string;
      title: string;
      time: string;
      location: unknown;
      updated_at: string | null;
    }>();
  if (!event?.id) return { status: "deferred" };

  const eventLocation = parseEventLocation(event.location);
  const startAtMs = eventStartAtMs(String(event.date_key), String(event.time));
  if (!eventLocation || startAtMs == null) return { status: "deferred" };

  await recordLocationConfirmation(db, {
    familyId: input.familyId,
    subjectUserId: input.callerUserId,
    action: "use",
    requesterKind: "subject",
    requesterUserId: input.callerUserId,
    recipientKind: "none",
    recipientUserId: null,
    collectionMethod: "not_applicable",
    acquisitionPath: "current_location_store",
    serviceCode: "schedule_arrival_monitor",
    deliveryMethod: "worker_internal",
    purposeCode: "schedule_arrival_alert",
  });

  const location = await db
    .prepare(
      `SELECT lat, lng, accuracy_m, updated_at FROM child_locations
        WHERE family_id = ? AND user_id = ? LIMIT 1`,
    )
    .bind(input.familyId, input.callerUserId)
    .first<{ lat: number; lng: number; accuracy_m: number | null; updated_at: string }>();
  const fixAtMs = parseServerTimestamp(location?.updated_at);
  const nowMs = Number.isFinite(input.nowMs) ? Number(input.nowMs) : Date.now();
  if (
    !location
    || fixAtMs == null
    || fixAtMs > nowMs
    || nowMs - fixAtMs > ARRIVAL_STALE_MS
    || location.accuracy_m == null
    || !Number.isFinite(Number(location.accuracy_m))
    || Number(location.accuracy_m) < 0
    || Number(location.accuracy_m) > ARRIVAL_MAX_ACCURACY_M
  ) return { status: "deferred" };

  const locationPoint = { lat: Number(location.lat), lng: Number(location.lng) };
  if (
    !Number.isFinite(locationPoint.lat)
    || !Number.isFinite(locationPoint.lng)
    || fixAtMs - startAtMs < -ARRIVAL_EARLY_MS
    || fixAtMs - startAtMs > ARRIVAL_LATE_MS
    || distanceM(locationPoint, eventLocation) > ARRIVAL_RADIUS_M
  ) return { status: "deferred" };

  const canonicalOccurrenceId = occurrenceId(event);
  const priorMiss = await db
    .prepare(
      `SELECT 1 AS ok FROM parent_alerts
        WHERE family_id = ? AND event_id = ?
          AND alert_type IN ('not_arrived','missed_arrival')
        LIMIT 1`,
    )
    .bind(input.familyId, canonicalOccurrenceId)
    .first<{ ok: number }>();
  const childName = child.name?.trim() || "아이";
  const alertType = priorMiss ? "late_arrived" : "arrived";
  const lateMinutes = Math.max(0, Math.floor((fixAtMs - startAtMs) / 60_000));
  return {
    status: "verified",
    writeScope: { callerRole: "child", childUserId: input.callerUserId },
    alertType,
    title: priorMiss ? "✅ 지각 도착" : `✅ ${event.title.trim() || "일정"} 도착`,
    message: priorMiss
      ? `${childName}님이 ${event.title} 장소에 ${lateMinutes}분 늦게 도착했어요.`
      : `${childName}님이 ${event.title.trim() || "일정"} 장소에 도착했어요.`,
    severity: "info",
    eventId: canonicalOccurrenceId,
    sourceEventId: event.id,
  };
}
