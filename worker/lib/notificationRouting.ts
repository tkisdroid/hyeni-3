// ── Push Notification Routing Helpers ─────────────────────────────────────
// supabase/functions/push-notify/notificationRouting.ts 를 그대로 옮긴 순수 모듈.
// Deno 의존성이 전혀 없어 verbatim 복사. push-notify.ts 라우트 + lib/fcm.ts 가 공유한다.
//
// 1. kkuk vs SOS 부모 수신자 분기(kkuk = 주 보호자만 · SOS = 양 부모).
// 2. co-parent(비주보호자) 의 위험 원격제어 action 차단.
// 3. emergency 판정(FCM high priority + Doze bypass).
// 4. cron 일정알림 윈도 수신자(notification_settings + notif_override) 해석.

const CONTROL_ACTIONS = new Set([
  "remote_listen",
  "remote_listen_stop",
  "request_location",
  "request_device_status",
  "force_ring",
  "force_ring_stop",
]);

const COMMAND_NOTIFICATION_TYPES = new Set([
  "remote_listen",
  "remote_listen_stop",
  "request_location",
  "request_device_status",
]);

const EMERGENCY_ALERT_TYPES = new Set([
  "not_arrived",
  "missed_arrival",
  "danger_zone",
  "danger_enter",
  "danger_entry",
  "sos",
  "sos_followup",
]);

export const ARRIVAL_RADIUS_M = 80;
export const NOT_ARRIVED_WINDOW_MINUTES = 5;
export const NOT_ARRIVED_MAX_ACCURACY_M = 150;

type Member = {
  user_id?: string | null;
  role?: string | null;
  is_primary_parent?: boolean;
};

type LocationLike = {
  lat?: unknown;
  lng?: unknown;
  accuracy_m?: unknown;
  user_id?: string | null;
};

export function isCommandNotificationType(type: string): boolean {
  return COMMAND_NOTIFICATION_TYPES.has(type);
}

export function isEmergencyNotificationType(
  type: string,
  data: Record<string, unknown> = {},
): boolean {
  if (type === "kkuk") return false;
  if (type === "sos" || type === "emergency") return true;
  const explicitUrgent = String(data.urgent ?? "").trim().toLowerCase();
  if (explicitUrgent === "true") return true;
  if (explicitUrgent === "false") return false;
  if (type !== "parent_alert") return false;

  const severity = String(data.severity || "").trim().toLowerCase();
  const alertType = String(data.alertType || data.alert_type || "").trim().toLowerCase();
  return severity === "emergency"
    || severity === "critical"
    || severity === "urgent"
    || EMERGENCY_ALERT_TYPES.has(alertType);
}

export type HeadsUpNotificationBlock = {
  channel_id: string;
  notification_priority: string;
  default_sound: boolean;
  default_vibrate_timings: boolean;
  tag?: string;
};

export function resolveFcmHeadsUp(
  type: string,
  data: Record<string, unknown> = {},
): { headsUp: boolean; notification?: HeadsUpNotificationBlock } {
  const isCommand = isCommandNotificationType(type);
  const isFullScreenGrade = type === "kkuk" || isEmergencyNotificationType(type, data);
  const headsUp = !isCommand && !isFullScreenGrade;
  if (!headsUp) return { headsUp: false };

  const pushId = data.pushId == null || data.pushId === "" ? undefined : String(data.pushId);
  return {
    headsUp: true,
    notification: {
      channel_id: "hyeni_schedule_v6",
      notification_priority: "PRIORITY_HIGH",
      default_sound: true,
      default_vibrate_timings: true,
      ...(pushId ? { tag: pushId } : {}),
    },
  };
}

export function selectParentRecipientsForAction(
  action: string,
  members: Member[],
): Set<string> {
  const parents = (members || []).filter((member) => (
    member.role === "parent"
    && typeof member.user_id === "string"
    && member.user_id.length > 0
  ));

  if (action === "sos" || action === "emergency" || action === "parent_alert") {
    return new Set(parents.map((member) => member.user_id as string));
  }

  const primary = parents.find((member) => member.is_primary_parent);
  return new Set(
    primary?.user_id
      ? [primary.user_id]
      : parents.map((member) => member.user_id as string),
  );
}

export function canCallerSendAction(
  action: string,
  caller: { role?: string; isPrimaryParent?: boolean },
): boolean {
  if (CONTROL_ACTIONS.has(action)) {
    return caller.role === "parent" && caller.isPrimaryParent === true;
  }
  return true;
}

function toFiniteNumber(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** 정확도가 없거나 허용 오차를 넘는 좌표는 안전 알림의 도착/미도착 확정 근거로 쓰지 않는다. */
export function isReliableArrivalAccuracy(
  value: unknown,
  maxAccuracyM = NOT_ARRIVED_MAX_ACCURACY_M,
): boolean {
  if (value == null || String(value).trim() === "") return false;
  const accuracyM = Number(value);
  return Number.isFinite(accuracyM) && accuracyM >= 0 && accuracyM <= maxAccuracyM;
}

/** foreground 복구용 부모 pending은 알림의 유효 의미보다 오래 남지 않는다. */
export function parentAlertPendingTtlMs(alertType: string, action = "parent_alert"): number {
  const normalizedAlertType = alertType.trim().toLowerCase();
  const normalizedAction = action.trim().toLowerCase();
  if (["sos", "emergency", "kkuk"].includes(normalizedAction)
    || ["sos", "emergency", "sos_followup"].includes(normalizedAlertType)) {
    return 5 * 60_000;
  }
  if (["danger_zone", "danger_enter", "danger_entry"].includes(normalizedAlertType)) {
    return 15 * 60_000;
  }
  if (normalizedAlertType === "danger_exit") return 2 * 60 * 60_000;
  if (normalizedAlertType === "not_arrived" || normalizedAlertType === "missed_arrival") return 30 * 60_000;
  if (["arrived", "late_arrived", "place_arrived", "place_left"].includes(normalizedAlertType)) {
    return 2 * 60 * 60_000;
  }
  if (normalizedAlertType === "low_battery") return 6 * 60 * 60_000;
  return 24 * 60 * 60_000;
}

function haversineMeters(a: LocationLike, b: LocationLike): number {
  const lat1 = toFiniteNumber(a.lat);
  const lng1 = toFiniteNumber(a.lng);
  const lat2 = toFiniteNumber(b.lat);
  const lng2 = toFiniteNumber(b.lng);
  if (lat1 == null || lng1 == null || lat2 == null || lng2 == null) return Infinity;

  const toRad = (degrees: number) => degrees * Math.PI / 180;
  const earthRadiusM = 6_371_000;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const s1 = Math.sin(dLat / 2);
  const s2 = Math.sin(dLng / 2);
  const q = s1 * s1
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * s2 * s2;
  return 2 * earthRadiusM * Math.atan2(Math.sqrt(q), Math.sqrt(1 - q));
}

export function isNotArrivedAlertWindow(nowMinutes: number, eventMinutes: number): boolean {
  if (!Number.isFinite(nowMinutes) || !Number.isFinite(eventMinutes)) return false;
  return nowMinutes >= eventMinutes
    && nowMinutes <= eventMinutes + NOT_ARRIVED_WINDOW_MINUTES;
}

/** cron은 정각에 먼저 보내고, 실행 누락 시에만 최대 2분까지 늦게 복구한다. 조기 발송은 금지. */
export function isCronReminderDue(nowMinutes: number, targetMinutes: number, graceMinutes = 2): boolean {
  if (!Number.isFinite(nowMinutes) || !Number.isFinite(targetMinutes)) return false;
  const lateBy = nowMinutes - targetMinutes;
  return lateBy >= 0 && lateBy <= Math.max(0, graceMinutes);
}

export function getNotArrivedChildUserIds(
  targetChildUserIds: string[],
  childLocations: LocationLike[],
  eventLocation: LocationLike,
  radiusM = ARRIVAL_RADIUS_M,
): string[] {
  const validTargetIds = [...new Set((targetChildUserIds || []).filter(Boolean))];
  if (validTargetIds.length === 0) return [];
  if (toFiniteNumber(eventLocation?.lat) == null || toFiniteNumber(eventLocation?.lng) == null) return [];

  const locationsByUserId = new Map<string, LocationLike>();
  for (const row of childLocations || []) {
    if (typeof row?.user_id === "string" && row.user_id) {
      locationsByUserId.set(row.user_id, row);
    }
  }

  return validTargetIds.filter((userId) => {
    const location = locationsByUserId.get(userId);
    if (!location) return true;
    return haversineMeters(location, eventLocation) > radiusM;
  });
}

// 위치 신선도 임계 — 이보다 오래된 좌표는 "현재 위치"로 단정하지 않는다.
export const NOT_ARRIVED_STALE_MINUTES = 15;

function locationUpdatedAtMs(location: LocationLike | undefined): number | null {
  const raw = String((location as { updated_at?: unknown } | undefined)?.updated_at ?? "").trim();
  if (!raw) return null;
  // D1 pg 형식("2026-07-09 15:32:18.633+00")을 ISO 로 정규화 후 파싱.
  const iso = raw.replace(" ", "T").replace(/\+00(?::?00)?$/, "Z");
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

export interface ArrivalPartition {
  /** 신선한 위치가 목적지 밖 — "도착하지 않았다"고 단정할 수 있는 아이들. */
  notArrived: string[];
  /** 위치가 없거나 오래됨 — 도착 여부를 단정할 수 없는 아이들(정직한 별도 문구 대상). */
  unknown: string[];
}

/**
 * 미도착 판정을 위치 신선도로 이분한다. 위치가 동결된 상태(어제 실사고: 세션 유실로
 * 하루 종일 옛 좌표)에서 "도착하지 않았어요"라고 단정 발사하는 오탐을 막고,
 * 대신 "도착 여부를 확인하지 못했어요"로 정직하게 알린다(안전 우선 — 알림 자체는 유지).
 */
export function partitionNotArrivedByFreshness(
  targetChildUserIds: string[],
  childLocations: LocationLike[],
  eventLocation: LocationLike,
  radiusM = ARRIVAL_RADIUS_M,
  nowMs = Date.now(),
  staleMinutes = NOT_ARRIVED_STALE_MINUTES,
): ArrivalPartition {
  const locationsByUserId = new Map<string, LocationLike>();
  for (const row of childLocations || []) {
    if (typeof row?.user_id === "string" && row.user_id) {
      locationsByUserId.set(row.user_id, row);
    }
  }

  const staleLimitMs = Math.max(1, staleMinutes) * 60_000;
  const notArrived: string[] = [];
  const unknown: string[] = [];
  const validTargetIds = [...new Set((targetChildUserIds || []).filter(Boolean))];
  const eventLat = toFiniteNumber(eventLocation?.lat);
  const eventLng = toFiniteNumber(eventLocation?.lng);
  if (eventLat == null || eventLng == null) return { notArrived: [], unknown: [] };

  for (const userId of validTargetIds) {
    const location = locationsByUserId.get(userId);
    const updatedMs = locationUpdatedAtMs(location);
    if (!location || updatedMs == null || nowMs - updatedMs > staleLimitMs) {
      unknown.push(userId);
      continue;
    }

    if (!isReliableArrivalAccuracy(location.accuracy_m)) {
      unknown.push(userId);
      continue;
    }
    const accuracyM = Number(location.accuracy_m);

    const distanceM = haversineMeters(location, eventLocation);
    if (!Number.isFinite(distanceM)) {
      unknown.push(userId);
      continue;
    }
    if (distanceM <= radiusM) continue;
    // 좌표의 오차 원이 목적지 반경과 겹치면 실제로 밖이라고 단정할 수 없다.
    if (distanceM <= radiusM + accuracyM) {
      unknown.push(userId);
      continue;
    }
    notArrived.push(userId);
  }
  return { notArrived, unknown };
}

// 생명 안전 알림 타입 — 활성기기 격리(superseded write 차단)에서 예외로 둔다.
// 기기 상태(is_active)와 무관하게 이 타입들은 어떤 자녀 기기에서든 항상 기록 허용.
// (옛 기기에서 눌린 SOS/위험지역도 절대 유실되면 안 됨 — cleanup 옵션 B 와 동일 철학.)
export const SAFETY_ALERT_TYPES: ReadonlySet<string> = new Set([
  "sos",
  "danger_zone",
  "danger_enter",
  "danger_entry",
  "danger_exit",
  "child_unpair_suspected",
]);

// ── 이벤트-소유권(활성 자녀 격리) ────────────────────────────────────────────────
// 현행 클라(hyeni-3 eventScope)와 동일한 규칙:
// 이벤트는 (a) is_family_event=true 이거나 (b) events_children 링크가 대상 자녀의
// family_members.id 를 포함할 때만 그 자녀에게 "속한다".
// 배정 없는 비가족 이벤트는 데이터 누락으로 보고 어떤 자녀에게도 전파하지 않는다.
//
// 핵심: activeChildMembers 는 호출부에서 이미 is_active=1 로 게이팅된 목록이다.
// 따라서 superseded(is_active=0)/삭제된 옛 자녀의 멤버 id "만" 남은 링크는
// linked.size > 0 인데 어떤 활성 멤버와도 매칭되지 않아 여전히 대상에서 빠진다
// (고아 이벤트 누수 차단은 그대로 유지).
export type CronEventOwnership = {
  isFamilyEvent: boolean;
  linkedChildIds: Array<string | null | undefined>;
};

export function selectEventTargetChildren<T extends { id: string }>(
  event: CronEventOwnership,
  activeChildMembers: T[],
): T[] {
  const members = Array.isArray(activeChildMembers) ? activeChildMembers : [];
  // 가족 일정 = 전원 소유(활성 자녀 전체가 대상).
  if (event?.isFamilyEvent) return members;
  const linked = new Set(
    (event?.linkedChildIds || []).map((id) => String(id || "")).filter(Boolean),
  );
  // 배정이 하나도 없는 비가족 이벤트 = 배정 누락. 전원 대상 폴백 금지.
  if (linked.size === 0) return [];
  return members.filter((member) => linked.has(String(member.id)));
}

// 이벤트가 "현재 활성 자녀에게 속하는가" — cron 알림(리마인더 + 미도착) 발생 게이트.
// 가족 일정 또는 활성 자녀 링크가 있을 때만 true.
// 옛 자녀 링크"만" 있는 고아 이벤트는 false → 부모/자녀 어느 쪽에도 알림을 내지 않는다.
export function eventBelongsToActiveChild(
  event: CronEventOwnership,
  activeChildMembers: Array<{ id: string }>,
): boolean {
  if (event?.isFamilyEvent) return true;
  return selectEventTargetChildren(event, activeChildMembers).length > 0;
}

// Server-owned reminder lead times. MUST stay a subset the client skips.
// cron 이 지원하는 리드타임 윈도우(분). 클라가 노출하는 사전알림 옵션(60/30/15/10/5)을 모두 포함.
// 0 = 시작 알림(자녀 전용). 사용자별 minutes_before/이벤트 notif_override 로 어떤 윈도를 켤지 고른다.
export const CRON_REMINDER_WINDOWS = [60, 30, 15, 10, 5, 0] as const;

export type EffectiveNotifSetting = {
  parentEnabled: boolean;
  childEnabled: boolean;
  minutesBefore: number[];
};

type RawNotifSettingRow = {
  user_id?: string | null;
  parent_enabled?: unknown;
  child_enabled?: unknown;
  minutes_before?: unknown;
};

export const DEFAULT_CRON_NOTIF_SETTING: EffectiveNotifSetting = {
  parentEnabled: true,
  childEnabled: true,
  minutesBefore: [15, 5],
};

function asBool(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function normalizeMinutes(value: unknown): number[] | null {
  if (!Array.isArray(value)) return null;
  const seen = new Set<number>();
  const out: number[] = [];
  for (const raw of value) {
    const n = Number(raw);
    if (!Number.isInteger(n) || n <= 0 || seen.has(n)) continue;
    seen.add(n);
    out.push(n);
  }
  return out;
}

export function buildNotifSettingsMap(
  rows: RawNotifSettingRow[] | null | undefined,
): Map<string, EffectiveNotifSetting> {
  const map = new Map<string, EffectiveNotifSetting>();
  for (const row of rows || []) {
    const userId = typeof row?.user_id === "string" ? row.user_id : "";
    if (!userId) continue;
    const minutes = normalizeMinutes(row.minutes_before);
    map.set(userId, {
      parentEnabled: asBool(row.parent_enabled, DEFAULT_CRON_NOTIF_SETTING.parentEnabled),
      childEnabled: asBool(row.child_enabled, DEFAULT_CRON_NOTIF_SETTING.childEnabled),
      minutesBefore: minutes ?? [...DEFAULT_CRON_NOTIF_SETTING.minutesBefore],
    });
  }
  return map;
}

export function applyEventNotifOverride(
  base: EffectiveNotifSetting,
  override: unknown,
): EffectiveNotifSetting {
  if (!override || typeof override !== "object") return base;
  const o = override as Record<string, unknown>;
  const overrideMinutes = normalizeMinutes(o.minutesBefore);
  return {
    parentEnabled: typeof o.parentEnabled === "boolean" ? o.parentEnabled : base.parentEnabled,
    childEnabled: typeof o.childEnabled === "boolean" ? o.childEnabled : base.childEnabled,
    minutesBefore: overrideMinutes ?? base.minutesBefore,
  };
}

export type CronWindowRecipientArgs = {
  minsBefore: number;
  members: Array<{ user_id?: string | null; role?: string | null }>;
  settingsByUser: Map<string, EffectiveNotifSetting>;
  eventOverride?: unknown;
  failSafe?: boolean;
};

export function selectCronWindowRecipients(
  args: CronWindowRecipientArgs,
): { parents: Set<string>; children: Set<string> } {
  const { minsBefore, members, settingsByUser, eventOverride, failSafe } = args;
  const parents = new Set<string>();
  const children = new Set<string>();
  const isStartWindow = minsBefore === 0;

  for (const member of members || []) {
    const userId = typeof member?.user_id === "string" ? member.user_id : "";
    if (!userId) continue;
    const role = member?.role;
    const isParent = role === "parent";
    const isChild = role === "child";
    if (!isParent && !isChild) continue;

    if (isStartWindow && isParent) continue;

    if (failSafe) {
      if (isParent) parents.add(userId);
      else children.add(userId);
      continue;
    }

    const base = settingsByUser.get(userId) ?? DEFAULT_CRON_NOTIF_SETTING;
    const eff = applyEventNotifOverride(base, eventOverride);

    if (isParent && !eff.parentEnabled) continue;
    if (isChild && !eff.childEnabled) continue;

    if (!isStartWindow && !eff.minutesBefore.includes(minsBefore)) continue;

    if (isParent) parents.add(userId);
    else children.add(userId);
  }

  return { parents, children };
}
