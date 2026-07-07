/**
 * 알림(parent-alerts) 도메인 엔드포인트.
 * AI·안전 모니터링이 생성한 부모 알림 목록 조회 + 사용자별 읽음 처리.
 * 서버 get_parent_alerts 가 read 를 (전역 read OR 호출자 ∈ read_by) 로 계산하므로
 * co-parent 가족에서 한 부모의 읽음이 다른 부모의 배지를 지우지 않는다.
 */
import { apiGet, apiPost } from "../client";

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
}

/** 미저장(첫 실행) 기본값 — hyeni-1 DEFAULT_NOTIFICATION_SETTINGS 와 동일. */
export const DEFAULT_NOTIF_SETTINGS: NotifSettings = {
  childEnabled: true,
  parentEnabled: true,
  locationEnabled: true,
  registeredPlaceEnabled: true,
  playdateEnabled: true,
  minutesBefore: [15, 5],
};

/** 사전 알림 선택 후보(분) — hyeni-1 NOTIFICATION_MINUTE_OPTIONS. */
export const NOTIF_MINUTE_OPTIONS: readonly number[] = [30, 15, 10, 5];

// minutes_before 정규화: 정수·양수·중복제거·내림차순. 빈 값이면 기본값(서버 semantics 미러).
function normalizeMinutes(raw: unknown): number[] {
  const src = Array.isArray(raw) ? raw : [];
  const seen = new Set<number>();
  const out: number[] = [];
  for (const v of src) {
    const n = Number(v);
    if (!Number.isInteger(n) || n <= 0 || seen.has(n)) continue;
    seen.add(n);
    out.push(n);
  }
  out.sort((a, b) => b - a);
  return out.length ? out : [...DEFAULT_NOTIF_SETTINGS.minutesBefore];
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
  };
}

/**
 * 호출자 본인 알림 설정 조회. 미저장이면 null(화면이 기본값으로 시작).
 */
export async function fetchNotifSettings(): Promise<NotifSettings | null> {
  const row = await apiGet<NotifSettingsRow | null>("/api/notif-settings");
  return rowToSettings(row);
}

/**
 * 호출자 본인 알림 설정 upsert(user_id PK). family_id 는 같은 사용자의 다른 기기로의
 * fan-out 통지에만 쓰인다(없으면 실시간 동기화만 생략, 저장은 정상 동작).
 */
export async function saveNotifSettings(
  familyId: string | null,
  settings: NotifSettings,
): Promise<void> {
  await apiPost("/api/notif-settings", {
    family_id: familyId || null,
    child_enabled: settings.childEnabled,
    parent_enabled: settings.parentEnabled,
    location_enabled: settings.locationEnabled,
    registered_place_enabled: settings.registeredPlaceEnabled,
    playdate_enabled: settings.playdateEnabled,
    minutes_before: normalizeMinutes(settings.minutesBefore),
  });
}
