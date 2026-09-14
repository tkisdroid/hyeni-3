/**
 * 알림(parent-alerts) 도메인 엔드포인트.
 * AI·안전 모니터링이 생성한 부모 알림 목록 조회 + 사용자별 읽음 처리.
 * 서버 get_parent_alerts 가 read 를 (전역 read OR 호출자 ∈ read_by) 로 계산하므로
 * co-parent 가족에서 한 부모의 읽음이 다른 부모의 배지를 지우지 않는다.
 */
import { apiGet, apiPost, apiPut } from "../client";
import {
  DEFAULT_NOTIFICATION_QUIET_HOURS,
  isValidNotificationQuietHours,
  type NotificationQuietHours,
  type NotificationQuietHoursDraft,
} from "@/transform/notificationQuietHours";

/** 알림 심각도(신호색 매핑의 1차 기준). 서버는 critical/urgent 도 보낼 수 있어 string 허용. */
export type AlertSeverity = "emergency" | "warning" | "info";

export interface ParentAlert {
  id: string;
  alert_type: string; // sos / danger_zone / arrived / academy_focus / memo_* 등
  title: string;
  message: string;
  severity: AlertSeverity | string;
  event_id: string | null;
  child_user_id: string | null;
  metadata?: Record<string, unknown> | null;
  read: boolean;
  created_at: string; // ISO 8601
}

/**
 * 가족 부모 알림 목록. 서버가 최신순 정렬.
 * @param limit 최대 개수(기본 50).
 */
export async function fetchParentAlerts(familyId: string, limit = 50): Promise<ParentAlert[]> {
  const params = new URLSearchParams({ family_id: familyId, limit: String(limit) });
  const data = await apiGet<ParentAlert[] | null>(`/api/parent-alerts?${params.toString()}`);
  return Array.isArray(data) ? data : [];
}

/**
 * 단일 알림 읽음 처리 — 호출자 uid 를 read_by 에 멱등 append(전역 read 는 미갱신).
 * 성공 응답은 빈 본문(204)일 수 있어 반환값을 소비하지 않는다.
 */
export function markAlertRead(alertId: string): Promise<unknown> {
  return apiPost(`/api/parent-alerts/${encodeURIComponent(alertId)}/read`, {});
}

/**
 * 가족의 내 미읽음 알림 전부 읽음 처리 — 서버 단일 UPDATE(1 요청).
 * 알림당 개별 POST(N회 왕복)로 느리던 "모두 읽음"의 서버측 대체.
 */
export function markAllAlertsRead(familyId: string): Promise<{ ok: boolean; updated: number }> {
  return apiPost<{ ok: boolean; updated: number }>("/api/parent-alerts/read-all", {
    family_id: familyId,
  });
}

/** 네이티브 foreground fallback이 소비하는 서버 pending 알림. */
export interface PendingDeviceNotification {
  id: string;
  title: string;
  body: string;
  data?: Record<string, unknown> | null;
  created_at?: string;
}

/** 현재 기기용 미전달 알림 조회. 서버가 사용자·role·만료를 다시 검증한다. */
export async function fetchDevicePendingNotifications(
  familyId: string,
  userId: string,
  role: "parent" | "child",
): Promise<PendingDeviceNotification[]> {
  const rows = await apiPost<PendingDeviceNotification[] | null>(
    "/rest/v1/rpc/get_pending_notifications_for_device",
    {
      p_family_id: familyId,
      p_user_id: userId,
      p_role: role,
    },
  );
  return Array.isArray(rows) ? rows : [];
}

/** 부모 Android fallback의 기존 호출 계약. */
export function fetchParentPendingNotifications(
  familyId: string,
  userId: string,
): Promise<PendingDeviceNotification[]> {
  return fetchDevicePendingNotifications(familyId, userId, "parent");
}

/** 실제 표시 또는 동일 FCM의 로컬 ACK가 확인된 행만 delivered 처리한다. */
export async function markPendingNotificationsDelivered(ids: string[]): Promise<number> {
  if (ids.length === 0) return 0;
  const updated = await apiPost<number | null>("/rest/v1/rpc/mark_notifications_delivered", {
    p_ids: ids,
  });
  return Number(updated ?? 0);
}

/* ── 알림 설정(notif-settings) ──────────────────────────────────────────────
 * per-user 알림 환경설정(user_id PK). 서버(GET /api/notif-settings)는 boolean·int[]
 * 형태의 snake_case row 또는 null(첫 실행)을 반환한다. 여기서 camelCase 로 정리해
 * 화면이 그대로 소비하고, 저장(POST)은 서버 계약대로 snake_case 로 되돌린다.
 * user_id 는 서버가 토큰 sub 로 고정하므로 조회에 인자가 없다.
 */

/** 알림 설정(정규화된 camelCase). */
export interface NotifSettings {
  /** 아이 기기 일정 알림. */
  childEnabled: boolean;
  /** 부모 일정 사전 알림. */
  parentEnabled: boolean;
  /** 자녀 위치(도착·이탈) 알림. */
  locationEnabled: boolean;
  /** 저장 장소 출입 알림. */
  registeredPlaceEnabled: boolean;
  /** 친구·놀이 약속 알림. */
  playdateEnabled: boolean;
  /** 일정 사전 알림(분) 리스트(내림차순). */
  minutesBefore: number[];
  /** 부모가 관리하는 조용한 시간. 기존 전체 저장 body에는 포함하지 않는다. */
  readonly quietHours: NotificationQuietHours;
}

/** 서버 notif-settings row(snake_case, boolean·int[]). */
interface NotifSettingsRow {
  user_id: string;
  family_id: string | null;
  child_enabled: boolean;
  parent_enabled: boolean;
  location_enabled: boolean;
  registered_place_enabled: boolean;
  playdate_enabled: boolean;
  minutes_before: number[];
  quiet_hours: unknown;
}

/** 미저장(첫 실행) 기본값 — hyeni-1 DEFAULT_NOTIFICATION_SETTINGS 와 동일. */
export const DEFAULT_NOTIF_SETTINGS: NotifSettings = {
  childEnabled: true,
  parentEnabled: true,
  locationEnabled: true,
  registeredPlaceEnabled: true,
  playdateEnabled: true,
  minutesBefore: [15, 5],
  quietHours: { ...DEFAULT_NOTIFICATION_QUIET_HOURS },
};

/** 사전 알림 선택 후보(분) — hyeni-1 NOTIFICATION_MINUTE_OPTIONS. */
export const NOTIF_MINUTE_OPTIONS: readonly number[] = [60, 30, 15, 10, 5];

// minutes_before 정규화: 정수·양수·중복제거·내림차순. 명시적 빈 배열은
// "사전 알림 없음"이므로 보존하고, 필드 자체가 잘못 누락된 경우에만 기본값을 쓴다.
function normalizeMinutes(raw: unknown): number[] {
  if (!Array.isArray(raw)) return [...DEFAULT_NOTIF_SETTINGS.minutesBefore];
  const src = raw;
  const seen = new Set<number>();
  const out: number[] = [];
  for (const v of src) {
    const n = Number(v);
    if (!Number.isInteger(n) || n <= 0 || seen.has(n)) continue;
    seen.add(n);
    out.push(n);
  }
  out.sort((a, b) => b - a);
  return out;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseNotificationQuietHours(value: unknown): NotificationQuietHours {
  if (!isRecord(value)) {
    throw new Error("알림 조용한 시간 응답이 올바르지 않아요");
  }
  if (
    typeof value.enabled !== "boolean"
    || typeof value.start_minute !== "number"
    || !Number.isInteger(value.start_minute)
    || value.start_minute < 0
    || value.start_minute > 1439
    || typeof value.end_minute !== "number"
    || !Number.isInteger(value.end_minute)
    || value.end_minute < 0
    || value.end_minute > 1439
    || value.start_minute === value.end_minute
    || (value.updated_at !== null && typeof value.updated_at !== "string")
    || typeof value.configured !== "boolean"
    || value.configured !== (value.updated_at !== null)
  ) {
    throw new Error("알림 조용한 시간 응답이 올바르지 않아요");
  }
  return {
    ...(typeof value.time_zone === "string" ? { timeZone: value.time_zone } : {}),
    enabled: value.enabled,
    startMinute: value.start_minute,
    endMinute: value.end_minute,
    updatedAt: value.updated_at,
    configured: value.configured,
  };
}

// 서버 row → NotifSettings(누락 필드는 기본값 보정).
function rowToSettings(row: NotifSettingsRow | null): NotifSettings | null {
  if (!row) return null;
  const b = (v: unknown, d: boolean) => (typeof v === "boolean" ? v : d);
  return {
    childEnabled: b(row.child_enabled, DEFAULT_NOTIF_SETTINGS.childEnabled),
    parentEnabled: b(row.parent_enabled, DEFAULT_NOTIF_SETTINGS.parentEnabled),
    locationEnabled: b(row.location_enabled, DEFAULT_NOTIF_SETTINGS.locationEnabled),
    registeredPlaceEnabled: b(row.registered_place_enabled, DEFAULT_NOTIF_SETTINGS.registeredPlaceEnabled),
    playdateEnabled: b(row.playdate_enabled, DEFAULT_NOTIF_SETTINGS.playdateEnabled),
    minutesBefore: normalizeMinutes(row.minutes_before),
    quietHours: parseNotificationQuietHours(row.quiet_hours),
  };
}

/**
 * 호출자 본인 알림 설정 조회. 미저장이면 null(화면이 기본값으로 시작).
 */
export async function fetchNotifSettings(): Promise<NotifSettings | null> {
  const row = await apiGet<NotifSettingsRow | null>("/api/notif-settings");
  return rowToSettings(row);
}

interface ChildNotifSettingsStatusRow {
  user_id: string;
  child_enabled: boolean;
  configured: boolean;
}

export interface ChildNotifSettingsStatus {
  userId: string;
  childEnabled: boolean;
  configured: boolean;
}

/** 부모가 같은 가족의 활성 아이 일정 알림 허용 여부만 최소 범위로 조회한다. */
export async function fetchChildNotifSettingsStatus(
  familyId: string,
  childUserId: string,
): Promise<ChildNotifSettingsStatus> {
  const params = new URLSearchParams({
    family_id: familyId,
    child_user_id: childUserId,
  });
  const row = await apiGet<ChildNotifSettingsStatusRow>(
    `/api/notif-settings/child-status?${params.toString()}`,
  );
  if (
    row.user_id !== childUserId
    || typeof row.child_enabled !== "boolean"
    || typeof row.configured !== "boolean"
  ) {
    throw new Error("아이 알림 설정 응답이 올바르지 않아요");
  }
  return {
    userId: row.user_id,
    childEnabled: row.child_enabled,
    configured: row.configured,
  };
}

/**
 * 호출자 본인 알림 설정 upsert(user_id PK). family_id 는 같은 사용자의 다른 기기로의
 * fan-out 통지에만 쓰인다(없으면 실시간 동기화만 생략, 저장은 정상 동작).
 */
export async function saveNotifSettings(
  familyId: string | null,
  expectedUserId: string,
  settings: NotifSettings,
): Promise<void> {
  await apiPost("/api/notif-settings", {
    family_id: familyId || null,
    expected_user_id: expectedUserId,
    child_enabled: settings.childEnabled,
    parent_enabled: settings.parentEnabled,
    location_enabled: settings.locationEnabled,
    registered_place_enabled: settings.registeredPlaceEnabled,
    playdate_enabled: settings.playdateEnabled,
    minutes_before: normalizeMinutes(settings.minutesBefore),
  });
}

interface FamilyNotificationQuietHoursRecipientRow extends Record<string, unknown> {
  target_user_id: unknown;
  role: unknown;
  enabled: unknown;
  start_minute: unknown;
  end_minute: unknown;
  updated_at: unknown;
  configured: unknown;
}

interface FamilyNotificationQuietHoursRow extends Record<string, unknown> {
  family_id: unknown;
  recipients: unknown;
}

export interface FamilyNotificationQuietHoursRecipient {
  targetUserId: string;
  role: "parent" | "child";
  quietHours: NotificationQuietHours;
}

export interface FamilyNotificationQuietHours {
  familyId: string;
  recipients: FamilyNotificationQuietHoursRecipient[];
}

export interface SavedNotificationQuietHours {
  targetUserId: string;
  quietHours: NotificationQuietHours;
  updatedAt: string;
}

function parseFamilyNotificationQuietHoursRecipient(
  value: unknown,
): FamilyNotificationQuietHoursRecipient {
  if (!isRecord(value)) {
    throw new Error("알림 조용한 시간 응답이 올바르지 않아요");
  }
  const row = value as FamilyNotificationQuietHoursRecipientRow;
  if (
    typeof row.target_user_id !== "string"
    || row.target_user_id.trim().length === 0
    || (row.role !== "parent" && row.role !== "child")
  ) {
    throw new Error("알림 조용한 시간 응답이 올바르지 않아요");
  }
  return {
    targetUserId: row.target_user_id,
    role: row.role,
    quietHours: parseNotificationQuietHours(row),
  };
}

/** 호출 부모 본인과 같은 가족 활성 아이들의 조용한 시간을 조회한다. */
export async function fetchFamilyNotificationQuietHours(
  familyId: string,
  expectedParentUserId: string,
): Promise<FamilyNotificationQuietHours> {
  const params = new URLSearchParams({ family_id: familyId });
  const value = await apiGet<unknown>(`/api/notif-settings/family?${params.toString()}`);
  if (!isRecord(value)) {
    throw new Error("알림 조용한 시간 응답이 올바르지 않아요");
  }
  const row = value as FamilyNotificationQuietHoursRow;
  if (
    typeof row.family_id !== "string"
    || row.family_id !== familyId
    || !Array.isArray(row.recipients)
  ) {
    throw new Error("알림 조용한 시간 응답이 올바르지 않아요");
  }

  const seenTargetUserIds = new Set<string>();
  let selfParentCount = 0;
  const recipients = row.recipients.map((recipientValue) => {
    const recipient = parseFamilyNotificationQuietHoursRecipient(recipientValue);
    if (seenTargetUserIds.has(recipient.targetUserId)) {
      throw new Error("알림 조용한 시간 응답이 올바르지 않아요");
    }
    seenTargetUserIds.add(recipient.targetUserId);
    if (recipient.role === "parent") {
      if (recipient.targetUserId !== expectedParentUserId) {
        throw new Error("알림 조용한 시간 응답이 올바르지 않아요");
      }
      selfParentCount += 1;
    }
    return recipient;
  });
  if (selfParentCount !== 1) {
    throw new Error("알림 조용한 시간 응답이 올바르지 않아요");
  }
  return { familyId: row.family_id, recipients };
}

/** 부모 본인 또는 같은 가족 활성 아이 한 명의 조용한 시간만 부분 저장한다. */
export async function saveNotificationQuietHours(
  familyId: string,
  expectedParentUserId: string,
  targetUserId: string,
  quietHours: NotificationQuietHoursDraft,
): Promise<SavedNotificationQuietHours> {
  if (!familyId || !expectedParentUserId || !targetUserId || !isValidNotificationQuietHours(quietHours)) {
    throw new Error("저장할 알림 조용한 시간이 올바르지 않아요");
  }
  const value = await apiPut<unknown>("/api/notif-settings/quiet-hours", {
    family_id: familyId,
    target_user_id: targetUserId,
    expected_parent_user_id: expectedParentUserId,
    enabled: quietHours.enabled,
    start_minute: quietHours.startMinute,
    end_minute: quietHours.endMinute,
    ...(quietHours.timeZone ? { time_zone: quietHours.timeZone } : {}),
  });
  const saved = parseFamilyNotificationQuietHoursRecipient(value);
  const expectedRole = targetUserId === expectedParentUserId ? "parent" : "child";
  if (saved.targetUserId !== targetUserId || saved.role !== expectedRole) {
    throw new Error("저장 대상이 달라져 알림 조용한 시간을 반영하지 않았어요");
  }
  if (!saved.quietHours.configured || saved.quietHours.updatedAt === null) {
    throw new Error("알림 조용한 시간 응답이 올바르지 않아요");
  }
  return {
    targetUserId: saved.targetUserId,
    quietHours: saved.quietHours,
    updatedAt: saved.quietHours.updatedAt,
  };
}
