import { formatNotificationCopy } from "../../shared/notificationCopy.ts";
/**
 * 부모 알림(ParentAlert) → 알림 센터 뷰모델 매핑(순수).
 * 도메인 데이터(title/message/read/created_at)는 실값,
 * 표현(아이콘·틴트색)은 alert_type + severity 로 파생(신호색 규칙 준수:
 * 민트=안전/도착, 앰버=주의, 레드=SOS/긴급, 파랑=정보, 로즈=메시지).
 * now 를 인자로 받아 상대시간·날짜그룹을 순수 계산(테스트 가능).
 */
import type { ParentAlert } from "@/lib/api/endpoints/notifications";
import type { SupportedLocale } from "../i18n/locale.ts";
import {
  formatDateTime,
  formatCalendarDay,
  formatRelativeTime,
} from "../i18n/format.ts";
import { dateKeyToDateInputValue, dateToDateKeyInTimeZone } from "./dateKey.ts";
import type { IntlShape } from "react-intl";
import { withDefaultIntl } from "../i18n/defaultIntl.ts";

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

export type AlertCategory = "safety" | "location" | "schedule" | "talk";
/** 도착=민트, 출발=라벤더(정상 이동), 미도착·지연=앰버(확인 필요). */
export type ArrivalAlertTone = "arrived" | "left" | "pending";

// 서버가 실제 저장하는 canonical alert_type. 화면마다 별도 집합을 만들지 않는다.
const DANGER_TYPES = new Set([
  "sos",
  "sos_followup",
  "emergency",
  "danger_zone",
  "danger_enter",
  "danger_entry",
]);
const ARRIVAL_SAFE_TYPES = new Set([
  "arrived",
  "place_arrived",
  "event_ended_by_child",
  "event_started_by_child",
]);
const ARRIVAL_PENDING_TYPES = new Set([
  "not_arrived",
  "missed_arrival",
  "late_arrived",
  "place_left",
  "unregistered_stay_left",
]);
/** 출발 계열 — 도착·미도착과 함께 도착 알림 목록에 들어가지만 경고 톤은 아니다. */
const DEPARTURE_TYPES = new Set(["place_left", "unregistered_stay_left"]);
const WARN_TYPES = new Set([
  ...ARRIVAL_PENDING_TYPES,
  "academy_focus",
  "low_battery",
  "battery_low",
  "battery",
]);

export function isDangerAlertType(type: string): boolean {
  return DANGER_TYPES.has(type || "");
}

export function isArrivalAlertType(type: string): boolean {
  const normalized = type || "";
  return ARRIVAL_SAFE_TYPES.has(normalized) || ARRIVAL_PENDING_TYPES.has(normalized);
}

export function arrivalAlertTone(type: string): ArrivalAlertTone {
  const normalized = type || "";
  // 출발은 정상 이동 소식이다. "확인 필요"(앰버)는 미도착·지연처럼 부모가 실제로 확인해야 하는 것만.
  if (DEPARTURE_TYPES.has(normalized)) return "left";
  return ARRIVAL_PENDING_TYPES.has(normalized) ? "pending" : "arrived";
}

/** 위험 화면 표시 판정. danger_exit은 과거 행의 severity가 높아도 긴급으로 되살리지 않는다. */
export function isDangerAlert(alert: ParentAlert): boolean {
  const type = alert.alert_type || "";
  if (isDangerAlertType(type)) return true;
  if (
    type === "danger_exit" ||
    isArrivalAlertType(type) ||
    WARN_TYPES.has(type) ||
    type.startsWith("event") ||
    type.startsWith("memo") ||
    type.startsWith("sticker")
  ) {
    return false;
  }
  return isUrgentSeverity(alert.severity || "");
}

/** 알림 센터 필터 분류. 미지 유형은 위치·기기 상태 알림으로 보수적으로 표시한다. */
export function alertCategory(type: string): AlertCategory {
  const normalized = type || "";
  if (
    isDangerAlertType(normalized) ||
    normalized.startsWith("sos") ||
    normalized.startsWith("danger") ||
    normalized === "low_battery" ||
    normalized === "battery_low" ||
    normalized === "battery" ||
    normalized === "child_setting_request"
  ) {
    return "safety";
  }
  if (normalized.startsWith("event") || normalized === "schedule_suggestion") return "schedule";
  if (
    normalized.startsWith("memo") ||
    normalized.startsWith("sticker") ||
    normalized === "ai_credit_request"
  ) {
    return "talk";
  }
  return "location";
}

/** alert_type → 부모 상세 화면. 모든 알림 목록이 이 매핑만 사용한다. */
export function alertRoute(type: string): string | null {
  const normalized = type || "";
  if (isDangerAlertType(normalized)) return "/danger-alert";
  if (isArrivalAlertType(normalized)) return "/arrival-alerts";
  if (
    normalized === "danger_exit" ||
    normalized === "academy_focus" ||
    normalized === "low_battery" ||
    normalized === "battery_low" ||
    normalized === "battery"
  ) {
    return "/parent/location";
  }
  if (normalized.startsWith("memo") || normalized.startsWith("sticker")) return "/parent/memo";
  // 아이가 AI 대화를 다 써서 부탁한 요청 — 충전·하루 한도를 그 자리에서 바꿀 수 있는 화면으로.
  if (normalized === "ai_credit_request") return "/ai-credit";
  // 하루 대시보드는 알림함에서도 같은 화면으로 간다(푸시로만 열리면 놓친 알림을 못 본다).
  if (normalized === "child_daily_digest") return "/child-digest";
  if (normalized === "schedule_suggestion") return "/event-form";
  if (normalized.startsWith("event")) return "/parent/calendar";
  return null;
}

type Tone = "danger" | "warning" | "safe" | "memo" | "sticker" | "info";

const TONE_SOFT: Record<Tone, string> = {
  danger: "var(--danger-soft)",
  warning: "var(--cream-soft)",
  safe: "var(--mint-soft)",
  memo: "var(--rose-soft)",
  sticker: "var(--cream-soft)",
  info: "var(--blue-soft)",
};

// alert_type → 아이콘(정확 매칭). 접두 매칭(memo_/sticker_)은 iconFor 에서 별도 처리.
const ICON_BY_TYPE: Record<string, string> = {
  sos: "ui/sos-shield.webp",
  sos_followup: "ui/sos-shield.webp",
  emergency: "ui/sos-shield.webp",
  danger_zone: "ui/warning.webp",
  danger_enter: "ui/warning.webp",
  danger_entry: "ui/warning.webp",
  danger_exit: "ui/warning.webp",
  arrived: "ui/pin-heart.webp",
  place_arrived: "ui/pin-heart.webp",
  place_left: "ui/pin.webp",
  unregistered_stay_left: "ui/pin.webp",
  not_arrived: "ui/warning.webp",
  missed_arrival: "ui/warning.webp",
  late_arrived: "ui/warning.webp",
  academy_focus: "ui/place-academy.webp",
  event_started_by_child: "ui/calendar-heart.webp",
  event_ended_by_child: "ui/calendar-heart.webp",
  event_reminder: "ui/calendar-heart.webp",
  ai_credit_request: "ui/crown.webp",
  child_daily_digest: "ui/chart-3d.webp",
  child_setting_request: "ui/shield-heart.webp",
  low_battery: "ui/battery.webp",
  battery_low: "ui/battery.webp", // 과거 저장 행 호환
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
  if (type === "danger_exit") return "safe";
  if (isDangerAlertType(type) || isUrgentSeverity(severity)) return "danger";
  if (type.startsWith("memo")) return "memo";
  if (type.startsWith("sticker")) return "sticker";
  if (ARRIVAL_SAFE_TYPES.has(type)) return "safe";
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
  return alertRoute(alert.alert_type || "");
}

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;

/** created_at → 상대시간(<1분 "방금", <1시간 "N분 전") 또는 시계 라벨. */
export function relativeTime(
  iso: string,
  now: Date,
  locale: SupportedLocale,
  timeZone: string,
  providedIntl?: IntlShape,
): string {
  const intl = withDefaultIntl(providedIntl);
  const ms = Date.parse(iso || "");
  if (!Number.isFinite(ms)) return "";
  const diff = now.getTime() - ms;
  if (diff >= 0 && diff < MINUTE_MS) return intl.formatMessage({ id: "notifications.time.justNow" });
  if (diff >= 0 && diff < HOUR_MS) {
    return formatRelativeTime(-Math.floor(diff / MINUTE_MS), "minute", locale);
  }
  return formatDateTime(ms, { locale, timeZone, timeStyle: "short" });
}

// 절대시각 → 명시한 시간대의 Gregorian 일자 스탬프(표시 그룹 비교 전용).
function dayStamp(date: Date, timeZone: string): string {
  return dateKeyToDateInputValue(dateToDateKeyInTimeZone(date, timeZone));
}

// created_at 날짜 → 그룹 라벨(오늘/어제/M월 D일).
function groupLabel(date: Date, now: Date, locale: SupportedLocale, timeZone: string, intl: IntlShape): string {
  const today = dayStamp(now, timeZone);
  const [year, month, day] = today.split("-").map(Number);
  const yesterday = new Date(Date.UTC(year, month - 1, day - 1)).toISOString().slice(0, 10);
  const key = dayStamp(date, timeZone);
  if (key === today) return intl.formatMessage({ id: "notifications.group.today" });
  if (key === yesterday) return intl.formatMessage({ id: "notifications.group.yesterday" });
  return formatCalendarDay(date, { locale, timeZone });
}

/**
 * 알림 제목 정리 — 서버 카피의 선행 이모지(📍 🚶 ✅ 🕘 …)를 떼어낸다.
 * 목록·상세는 이미 왼쪽에 3D 아이콘 타일을 두므로 제목의 이모지는 같은 뜻을 두 번 말하고,
 * 아이콘 언어(3D webp + lucide)와도 어긋난다. 서버 문구는 그대로 두고 표시 단계에서만 정리한다.
 */
export function cleanAlertTitle(raw: string | null | undefined): string {
  const text = String(raw ?? "").trim();
  if (!text) return "";
  // 이모지·기호(picto/dingbat/변형선택자/제로폭 결합자)로 시작하는 접두부만 제거한다.
  const cleaned = text
    .replace(
      /^(?:[\u{1F000}-\u{1FAFF}\u{2190}-\u{2BFF}\u{FE0F}\u{200D}\u{20E3}\u{E0020}-\u{E007F}]|\u{23F0}|\u{2705}|\u{26A0}|\u{2757})+\s*/u,
      "",
    )
    .trim();
  return cleaned || text;
}

/** 공유 query 원본을 변경하지 않고 현재 화면 언어로만 표시한다. */
export function localizeParentAlert(alert: ParentAlert, locale: SupportedLocale): ParentAlert {
  const translated = formatNotificationCopy(alert.metadata?.notificationCopy, locale);
  return translated ? { ...alert, title: translated.title, message: translated.body } : alert;
}

function toItemView(
  alert: ParentAlert,
  now: Date,
  locale: SupportedLocale,
  timeZone: string,
  intl: IntlShape,
): AlertItemView {
  const translated = formatNotificationCopy(alert.metadata?.notificationCopy, locale);
  const title = translated?.title ?? cleanAlertTitle(alert.title);
  const detail = translated?.body ?? cleanAlertTitle(alert.message);
  return {
    id: alert.id,
    alertType: alert.alert_type || "",
    icon: iconFor(alert),
    soft: TONE_SOFT[toneFor(alert)],
    title: title || detail || intl.formatMessage({ id: "notifications.fallback.title" }),
    detail: detail || title || "",
    time: relativeTime(alert.created_at, now, locale, timeZone, intl),
    unread: !alert.read,
    to: routeFor(alert),
    childUserId: alert.child_user_id ?? null,
    metadata: alert.metadata ?? null,
  };
}

/** 알림 배열 → 날짜별 그룹(최신순, 각 그룹 내부도 최신순). */
export function mapAlertsToGroups(
  alerts: ParentAlert[],
  now: Date,
  locale: SupportedLocale,
  timeZone: string,
  providedIntl?: IntlShape,
): AlertGroupView[] {
  const intl = withDefaultIntl(providedIntl);
  const sorted = [...alerts].sort(
    (a, b) => (Date.parse(b.created_at || "") || 0) - (Date.parse(a.created_at || "") || 0),
  );
  const groups: AlertGroupView[] = [];
  const byLabel = new Map<string, AlertGroupView>();
  for (const alert of sorted) {
    const ms = Date.parse(alert.created_at || "");
    const label = Number.isFinite(ms) ? groupLabel(new Date(ms), now, locale, timeZone, intl) : intl.formatMessage({ id: "notifications.group.earlier" });
    let group = byLabel.get(label);
    if (!group) {
      group = { group: label, items: [] };
      byLabel.set(label, group);
      groups.push(group);
    }
    group.items.push(toItemView(alert, now, locale, timeZone, intl));
  }
  return groups;
}

/** 읽지 않은 알림 개수. */
export function countUnread(alerts: ParentAlert[]): number {
  return alerts.reduce((n, alert) => n + (alert.read ? 0 : 1), 0);
}
