/**
 * 부모 알림(ParentAlert) → 알림 센터 뷰모델 매핑(순수).
 * 도메인 데이터(title/message/read/created_at)는 실값,
 * 표현(아이콘·틴트색)은 alert_type + severity 로 파생(신호색 규칙 준수:
 * 민트=안전/도착, 앰버=주의, 레드=SOS/긴급, 파랑=정보, 로즈=메시지).
 * now 를 인자로 받아 상대시간·날짜그룹을 순수 계산(테스트 가능).
 */
import type { ParentAlert } from "@/lib/api/endpoints/notifications";

export interface AlertItemView {
  id: string;
  alertType: string;
  icon: string; // assets 경로("ui/....webp")
  soft: string; // 아이콘 타일 배경(신호색 틴트)
  title: string;
  detail: string;
  time: string; // 상대시간 또는 시계 라벨
  unread: boolean;
  to: string | null; // 탭 시 이동 경로(없으면 토스트)
  childUserId: string | null; // 이 알림이 지목한 아이(auth user_id). 위치/SOS 이동 시 대상 특정용.
  metadata: Record<string, unknown> | null;
}

export interface AlertGroupView {
  group: string; // "오늘" · "어제" · "M월 D일"
  items: AlertItemView[];
}

// SOS·위험구역 계열은 severity 와 무관하게 긴급(레드)로 취급.
const URGENT_TYPES = new Set(["sos", "sos_followup", "danger_zone", "danger_exit"]);
// 도착·귀가 계열은 안전(민트).
const SAFE_TYPES = new Set(["arrived", "place_arrived", "event_ended_by_child"]);
// 주의(앰버) 계열.
const WARN_TYPES = new Set(["not_arrived", "place_left", "academy_focus", "battery_low", "battery"]);

type Tone = "danger" | "warning" | "safe" | "memo" | "sticker" | "info";

const TONE_SOFT: Record<Tone, string> = {
  danger: "#FFECEE", // 레드 틴트
  warning: "#FDF0DA", // 앰버 틴트
  safe: "#E7F8F0", // 민트 틴트
  memo: "#FDE7F1", // 로즈 틴트
  sticker: "#FFF3D6", // 골드 틴트
  info: "#E6F2FB", // 파랑(정보) 틴트
};

// alert_type → 아이콘(정확 매칭). 접두 매칭(memo_/sticker_)은 iconFor 에서 별도 처리.
const ICON_BY_TYPE: Record<string, string> = {
  sos: "ui/sos-shield.webp",
  sos_followup: "ui/sos-shield.webp",
  danger_zone: "ui/warning.webp",
  danger_exit: "ui/warning.webp",
  arrived: "ui/pin-heart.webp",
  place_arrived: "ui/pin-heart.webp",
  place_left: "ui/pin.webp",
  not_arrived: "ui/warning.webp",
  academy_focus: "ui/place-academy.webp",
  event_started_by_child: "ui/calendar-heart.webp",
  event_ended_by_child: "ui/calendar-heart.webp",
  event_reminder: "ui/calendar-heart.webp",
  ai_credit_request: "ui/crown.webp",
  child_setting_request: "ui/shield-heart.webp",
  battery_low: "ui/battery.webp",
  battery: "ui/battery.webp",
  schedule_suggestion: "ui/calendar-heart.webp",
};

function isUrgentSeverity(severity: string): boolean {
  return severity === "emergency" || severity === "critical" || severity === "urgent";
}

// alert_type + severity → 신호색 톤.
function toneFor(alert: ParentAlert): Tone {
  const type = alert.alert_type || "";
  const severity = alert.severity || "";
  if (URGENT_TYPES.has(type) || isUrgentSeverity(severity)) return "danger";
  if (type.startsWith("memo")) return "memo";
  if (type.startsWith("sticker")) return "sticker";
  if (SAFE_TYPES.has(type)) return "safe";
  if (WARN_TYPES.has(type) || severity === "warning") return "warning";
  return "info";
}

// alert_type → 아이콘 경로(미매칭 시 톤 기반 폴백).
function iconFor(alert: ParentAlert): string {
  const type = alert.alert_type || "";
  if (ICON_BY_TYPE[type]) return ICON_BY_TYPE[type];
  if (type.startsWith("memo")) return "ui/chat-heart.webp";
  if (type.startsWith("sticker")) return "ui/star-medal.webp";
  return toneFor(alert) === "danger" ? "ui/sos-shield.webp" : "ui/bell.webp";
}

// alert_type → 탭 시 이동 경로. 애매하면 null(화면에서 토스트).
function routeFor(alert: ParentAlert): string | null {
  const type = alert.alert_type || "";
  if (URGENT_TYPES.has(type) || type.startsWith("arriv") || type.startsWith("place") || type === "not_arrived") {
    return "/parent/location";
  }
  if (type.startsWith("memo") || type.startsWith("sticker")) return "/parent/memo";
  if (type === "schedule_suggestion") return "/event-form";
  if (type.startsWith("event")) return "/parent/calendar";
  return null;
}

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;

// Date → "오전 8:42" 형식 시계 라벨.
function clockLabel(date: Date): string {
  const h = date.getHours();
  const m = date.getMinutes();
  const ampm = h < 12 ? "오전" : "오후";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${ampm} ${h12}:${String(m).padStart(2, "0")}`;
}

/** created_at → 상대시간(<1분 "방금", <1시간 "N분 전") 또는 시계 라벨. */
export function relativeTime(iso: string, now: Date): string {
  const ms = Date.parse(iso || "");
  if (!Number.isFinite(ms)) return "";
  const diff = now.getTime() - ms;
  if (diff >= 0 && diff < MINUTE_MS) return "방금";
  if (diff >= 0 && diff < HOUR_MS) return `${Math.floor(diff / MINUTE_MS)}분 전`;
  return clockLabel(new Date(ms));
}

// 로컬 연-월-일 키(월 0-base, 비교 전용).
function dayKey(date: Date): string {
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

// created_at 날짜 → 그룹 라벨(오늘/어제/M월 D일).
function groupLabel(date: Date, now: Date): string {
  const today = dayKey(now);
  const yesterday = dayKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1));
  const key = dayKey(date);
  if (key === today) return "오늘";
  if (key === yesterday) return "어제";
  return `${date.getMonth() + 1}월 ${date.getDate()}일`;
}

function toItemView(alert: ParentAlert, now: Date): AlertItemView {
  return {
    id: alert.id,
    alertType: alert.alert_type || "",
    icon: iconFor(alert),
    soft: TONE_SOFT[toneFor(alert)],
    title: alert.title || alert.message || "알림",
    detail: alert.message || alert.title || "",
    time: relativeTime(alert.created_at, now),
    unread: !alert.read,
    to: routeFor(alert),
    childUserId: alert.child_user_id ?? null,
    metadata: alert.metadata ?? null,
  };
}

/** 알림 배열 → 날짜별 그룹(최신순, 각 그룹 내부도 최신순). */
export function mapAlertsToGroups(alerts: ParentAlert[], now: Date): AlertGroupView[] {
  const sorted = [...alerts].sort(
    (a, b) => (Date.parse(b.created_at || "") || 0) - (Date.parse(a.created_at || "") || 0),
  );
  const groups: AlertGroupView[] = [];
  const byLabel = new Map<string, AlertGroupView>();
  for (const alert of sorted) {
    const ms = Date.parse(alert.created_at || "");
    const label = Number.isFinite(ms) ? groupLabel(new Date(ms), now) : "이전";
    let group = byLabel.get(label);
    if (!group) {
      group = { group: label, items: [] };
      byLabel.set(label, group);
      groups.push(group);
    }
    group.items.push(toItemView(alert, now));
  }
  return groups;
}

/** 읽지 않은 알림 개수. */
export function countUnread(alerts: ParentAlert[]): number {
  return alerts.reduce((n, alert) => n + (alert.read ? 0 : 1), 0);
}
